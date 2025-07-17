#!/bin/bash
# Deploy the equations Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RELEASE_NAME="${RELEASE_NAME:-equations}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
NAMESPACE="${NAMESPACE:-lilnas-core}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENV    Environment to deploy (dev|prod) [default: dev]"
    echo "  -n, --namespace NS       Namespace to install chart in [default: lilnas-core]"
    echo "  -r, --release NAME       Release name [default: equations]"
    echo "  -d, --dry-run           Perform a dry run"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Secret Options (required for production):"
    echo "  --api-token TOKEN       API authentication token"
    echo "  --s3-access-key KEY     S3/MinIO access key"
    echo "  --s3-secret-key KEY     S3/MinIO secret key"
    echo ""
    echo "Examples:"
    echo "  $0                      # Deploy with dev values to lilnas-core namespace"
    echo "  $0 -e dev --dry-run     # Dry run with dev values"
    echo "  $0 -n lilnas-dev        # Deploy to specific namespace"
    echo ""
    echo "  # Production deployment with secrets:"
    echo "  $0 -e prod \\"
    echo "    --api-token 'your-api-token' \\"
    echo "    --s3-access-key 'your-access-key' \\"
    echo "    --s3-secret-key 'your-secret-key'"
}

DRY_RUN=""
API_TOKEN=""
S3_ACCESS_KEY=""
S3_SECRET_KEY=""

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
        --api-token)
            API_TOKEN="$2"
            shift 2
            ;;
        --s3-access-key)
            S3_ACCESS_KEY="$2"
            shift 2
            ;;
        --s3-secret-key)
            S3_SECRET_KEY="$2"
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
if command -v op &> /dev/null && [[ -z "$API_TOKEN" || -z "$S3_ACCESS_KEY" || -z "$S3_SECRET_KEY" ]]; then
    echo "Fetching secrets from 1password..."
    
    # Check if user is signed in to 1password
    if ! op account list &> /dev/null; then
        echo "Please sign in to 1password first: eval \$(op signin)"
        exit 1
    fi
    
    # Set OP_ACCOUNT if multiple accounts exist
    export OP_ACCOUNT=${OP_ACCOUNT:-AYHWYYW3CBB3ZEJVIFODSATT7Y}
    
    # Fetch secrets from 1password Equations item
    if [[ -z "$API_TOKEN" ]]; then
        API_TOKEN=$(op item get "Equations" --fields "token" 2>/dev/null || echo "")
    fi
    if [[ -z "$S3_ACCESS_KEY" ]]; then
        S3_ACCESS_KEY=$(op item get "Equations" --fields "minio access key" 2>/dev/null || echo "")
    fi
    if [[ -z "$S3_SECRET_KEY" ]]; then
        S3_SECRET_KEY=$(op item get "Equations" --fields "minio secret key" 2>/dev/null || echo "")
    fi
    
    if [[ -n "$API_TOKEN" && -n "$S3_ACCESS_KEY" && -n "$S3_SECRET_KEY" ]]; then
        echo "Successfully fetched secrets from 1password"
    else
        echo "Warning: Failed to fetch some secrets from 1password"
    fi
fi

# Validate secrets for production
if [[ "$ENVIRONMENT" == "prod" && -z "$DRY_RUN" ]]; then
    if [[ -z "$API_TOKEN" || -z "$S3_ACCESS_KEY" || -z "$S3_SECRET_KEY" ]]; then
        echo "Error: Production deployment requires all secrets to be provided."
        echo "Please provide --api-token, --s3-access-key, and --s3-secret-key"
        echo ""
        echo "You can also set these via environment variables:"
        echo "  export EQUATIONS_API_TOKEN='your-token'"
        echo "  export EQUATIONS_S3_ACCESS_KEY='your-access-key'"
        echo "  export EQUATIONS_S3_SECRET_KEY='your-secret-key'"
        echo ""
        echo "Or store them in 1password under the 'Equations' item"
        exit 1
    fi
fi

# Allow environment variables as fallback for secrets
API_TOKEN="${API_TOKEN:-${EQUATIONS_API_TOKEN:-}}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-${EQUATIONS_S3_ACCESS_KEY:-}}"
S3_SECRET_KEY="${S3_SECRET_KEY:-${EQUATIONS_S3_SECRET_KEY:-}}"

# Set values file based on environment
VALUES_FILE="values-${ENVIRONMENT}.yaml"

echo "Deploying equations Helm chart..."
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
if [[ -n "$API_TOKEN" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.API_TOKEN='$API_TOKEN'"
fi
if [[ -n "$S3_ACCESS_KEY" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.MINIO_ACCESS_KEY='$S3_ACCESS_KEY'"
fi
if [[ -n "$S3_SECRET_KEY" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.MINIO_SECRET_KEY='$S3_SECRET_KEY'"
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
    echo "Deployment complete! Verifying equations components..."
    echo ""
    
    echo "=== Deployment Status ==="
    kubectl get deployment -n "$NAMESPACE" -l app.kubernetes.io/name=equations
    echo ""
    
    echo "=== Service Status ==="
    kubectl get service -n "$NAMESPACE" -l app.kubernetes.io/name=equations
    echo ""
    
    echo "=== Ingress Status ==="
    kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=equations
    echo ""
    
    echo "=== Pod Status ==="
    kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=equations
    echo ""
    
    # Get the ingress host for helpful information
    INGRESS_HOST=$(kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=equations -o jsonpath='{.items[0].spec.rules[0].host}' 2>/dev/null || echo "N/A")
    
    echo "=== Equations Service Information ==="
    echo "API Endpoint: https://${INGRESS_HOST}"
    echo "Health Check: https://${INGRESS_HOST}/health"
    echo "API Documentation: https://${INGRESS_HOST}/api"
    echo ""
    echo "To test the equations service:"
    echo "1. Health check:"
    echo "   curl https://${INGRESS_HOST}/health"
    echo ""
    echo "2. Render a LaTeX equation:"
    echo "   curl -X POST https://${INGRESS_HOST}/equation \\
         -H 'Content-Type: application/json' \\
         -d '{\"equation\": \"E = mc^2\", \"format\": \"png\"}'"
    echo ""
    echo "3. Check available formats:"
    echo "   curl https://${INGRESS_HOST}/equation/formats"
    echo ""
    echo "To view service logs:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=equations -f"
    echo ""
    echo "To check environment variables:"
    echo "  kubectl get configmap -n $NAMESPACE ${RELEASE_NAME}-config -o yaml"
    echo ""
    echo "Security note: The equations service runs LaTeX compilation in a sandboxed"
    echo "environment with input validation and rate limiting for security."
fi