#!/bin/bash
# Deploy the download Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RELEASE_NAME="${RELEASE_NAME:-download}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
NAMESPACE="${NAMESPACE:-lilnas-apps}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENV    Environment to deploy (dev|prod) [default: dev]"
    echo "  -n, --namespace NS       Namespace to install chart in [default: lilnas-apps]"
    echo "  -r, --release NAME       Release name [default: download]"
    echo "  -d, --dry-run           Perform a dry run"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Secret Options (required for MinIO access):"
    echo "  --minio-access-key KEY  MinIO access key"
    echo "  --minio-secret-key KEY  MinIO secret key"
    echo ""
    echo "Examples:"
    echo "  $0                      # Deploy with dev values to lilnas-apps namespace"
    echo "  $0 -e dev --dry-run     # Dry run with dev values"
    echo "  $0 -n lilnas-dev        # Deploy to specific namespace"
    echo ""
    echo "  # Production deployment with secrets:"
    echo "  $0 -e prod \\"
    echo "    --minio-access-key 'your-access-key' \\"
    echo "    --minio-secret-key 'your-secret-key'"
    echo ""
    echo "  # Using environment variables for secrets:"
    echo "  export DOWNLOAD_MINIO_ACCESS_KEY='your-access-key'"
    echo "  export DOWNLOAD_MINIO_SECRET_KEY='your-secret-key'"
    echo "  $0 -e prod"
}

DRY_RUN=""
MINIO_ACCESS_KEY=""
MINIO_SECRET_KEY=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -r|--release)
            RELEASE_NAME="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN="--dry-run"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        --minio-access-key)
            MINIO_ACCESS_KEY="$2"
            shift 2
            ;;
        --minio-secret-key)
            MINIO_SECRET_KEY="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Validate environment
if [[ "$ENVIRONMENT" != "dev" && "$ENVIRONMENT" != "prod" ]]; then
    echo "Error: Invalid environment '$ENVIRONMENT'. Must be 'dev' or 'prod'."
    exit 1
fi

# Check if 1password CLI is available
if command -v op &> /dev/null && [[ -z "$MINIO_ACCESS_KEY" || -z "$MINIO_SECRET_KEY" ]]; then
    echo "Fetching secrets from 1password..."
    
    # Check if user is signed in to 1password
    if ! op account list &> /dev/null; then
        echo "Please sign in to 1password first: eval \$(op signin)"
        exit 1
    fi
    
    # Set OP_ACCOUNT if multiple accounts exist
    export OP_ACCOUNT=${OP_ACCOUNT:-AYHWYYW3CBB3ZEJVIFODSATT7Y}
    
    # Fetch secrets from 1password Download item
    if [[ -z "$MINIO_ACCESS_KEY" ]]; then
        MINIO_ACCESS_KEY=$(op item get "Download" --fields "minio access key" 2>/dev/null || echo "")
    fi
    if [[ -z "$MINIO_SECRET_KEY" ]]; then
        MINIO_SECRET_KEY=$(op item get "Download" --fields "minio secret key" 2>/dev/null || echo "")
    fi
    
    # If not found in Download item, try MinIO item
    if [[ -z "$MINIO_ACCESS_KEY" || -z "$MINIO_SECRET_KEY" ]]; then
        echo "Trying MinIO item in 1password..."
        if [[ -z "$MINIO_ACCESS_KEY" ]]; then
            MINIO_ACCESS_KEY=$(op item get "MinIO" --fields "access key" 2>/dev/null || echo "")
        fi
        if [[ -z "$MINIO_SECRET_KEY" ]]; then
            MINIO_SECRET_KEY=$(op item get "MinIO" --fields "secret key" 2>/dev/null || echo "")
        fi
    fi
    
    if [[ -n "$MINIO_ACCESS_KEY" && -n "$MINIO_SECRET_KEY" ]]; then
        echo "Successfully fetched secrets from 1password"
    else
        echo "Warning: Failed to fetch some secrets from 1password"
    fi
fi

# Validate secrets for production
if [[ "$ENVIRONMENT" == "prod" && -z "$DRY_RUN" ]]; then
    if [[ -z "$MINIO_ACCESS_KEY" || -z "$MINIO_SECRET_KEY" ]]; then
        echo "Error: Production deployment requires MinIO credentials."
        echo "Please provide --minio-access-key and --minio-secret-key"
        echo ""
        echo "You can also set these via environment variables:"
        echo "  export DOWNLOAD_MINIO_ACCESS_KEY='your-access-key'"
        echo "  export DOWNLOAD_MINIO_SECRET_KEY='your-secret-key'"
        echo ""
        echo "Or store them in 1password under the 'Download' or 'MinIO' item"
        exit 1
    fi
fi

# Allow environment variables as fallback for secrets
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-${DOWNLOAD_MINIO_ACCESS_KEY:-}}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-${DOWNLOAD_MINIO_SECRET_KEY:-}}"

# Set values file based on environment
VALUES_FILE="values-${ENVIRONMENT}.yaml"

echo "Deploying download Helm chart..."
echo "  Release: $RELEASE_NAME"
echo "  Namespace: $NAMESPACE"
echo "  Environment: $ENVIRONMENT"
echo "  Values file: $VALUES_FILE"
if [[ -n "$DRY_RUN" ]]; then
    echo "  Mode: DRY RUN"
fi
echo ""

# Check if values file exists
if [[ ! -f "$VALUES_FILE" ]]; then
    echo "Error: Values file '$VALUES_FILE' not found!"
    exit 1
fi

# Check if namespace exists
if [[ -z "$DRY_RUN" ]] && ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
    echo "Warning: Namespace '$NAMESPACE' does not exist."
    echo "Please ensure the namespace exists before deploying."
    echo "You can create it with: kubectl create namespace $NAMESPACE"
    exit 1
fi

# Build helm values args
HELM_VALUES_ARGS="-f $VALUES_FILE"

# Add secret values if provided
if [[ -n "$MINIO_ACCESS_KEY" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set auth.minioAccessKey='$MINIO_ACCESS_KEY'"
fi
if [[ -n "$MINIO_SECRET_KEY" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set auth.minioSecretKey='$MINIO_SECRET_KEY'"
fi

# Deploy the chart
if [[ -z "$DRY_RUN" ]] && helm list -n "$NAMESPACE" | grep -q "^${RELEASE_NAME}\s"; then
    echo "Upgrading existing release..."
    eval helm upgrade "$RELEASE_NAME" . \
        -n "$NAMESPACE" \
        $HELM_VALUES_ARGS \
        --wait \
        $DRY_RUN
else
    echo "Installing new release..."
    eval helm install "$RELEASE_NAME" . \
        -n "$NAMESPACE" \
        $HELM_VALUES_ARGS \
        --wait \
        $DRY_RUN
fi

if [[ -z "$DRY_RUN" ]]; then
    echo ""
    echo "Deployment complete! Verifying download service components..."
    echo ""
    
    echo "=== Deployment Status ==="
    kubectl get deployment -n "$NAMESPACE" -l app.kubernetes.io/name=download
    echo ""
    
    echo "=== Service Status ==="
    kubectl get service -n "$NAMESPACE" -l app.kubernetes.io/name=download
    echo ""
    
    echo "=== Ingress Status ==="
    kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=download
    echo ""
    
    echo "=== Pod Status ==="
    kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=download
    echo ""
    
    echo "=== Persistent Volume Claims ==="
    kubectl get pvc -n "$NAMESPACE" -l app.kubernetes.io/name=download
    echo ""
    
    # Get the ingress host for helpful information
    INGRESS_HOST=$(kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=download -o jsonpath='{.items[0].spec.rules[0].host}' 2>/dev/null || echo "N/A")
    
    echo "=== Download Service Information ==="
    echo "Web Interface: https://${INGRESS_HOST}"
    echo "Health Check: https://${INGRESS_HOST}/api/health"
    echo ""
    echo "Features:"
    echo "• Video downloading with yt-dlp"
    echo "• Audio extraction and format conversion"
    echo "• Download queue management"
    echo "• MinIO integration for storage"
    echo "• Web-based user interface"
    echo ""
    echo "To view service logs:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=download -f"
    echo ""
    echo "To check download queue:"
    echo "  kubectl exec -n $NAMESPACE deployment/$RELEASE_NAME -- curl http://localhost:8081/api/queue"
    echo ""
    echo "To verify MinIO connection:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=download | grep -i minio"
    echo ""
    echo "Security note: The download service runs in a sandboxed environment with"
    echo "restricted permissions and resource limits for security."
fi