#!/bin/bash
# Deploy the MinIO Helm chart

set -euo pipefail

# Get script directory for relative path resolution
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RELEASE_NAME="${RELEASE_NAME:-minio}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
NAMESPACE="${NAMESPACE:-lilnas-core}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENV    Environment to deploy (dev|prod) [default: dev]"
    echo "  -n, --namespace NS       Namespace to install chart in [default: lilnas-core]"
    echo "  -r, --release NAME       Release name [default: minio]"
    echo "  -d, --dry-run           Perform a dry run"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Deploy with dev values"
    echo "  $0 -e prod              # Deploy with prod values"
    echo "  $0 -e dev --dry-run     # Dry run with dev values"
    echo "  $0 -n lilnas-storage    # Deploy to custom namespace"
}

DRY_RUN=""

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

# Set values file based on environment
VALUES_FILE="values-${ENVIRONMENT}.yaml"

echo "Deploying MinIO Helm chart..."
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
    echo "Error: Namespace '$NAMESPACE' does not exist."
    echo "Please create the namespace first or deploy the namespaces chart:"
    echo "  kubectl create namespace $NAMESPACE"
    echo "  # OR"
    echo "  cd ../namespaces && ./deploy.sh -e $ENVIRONMENT"
    exit 1
fi

# Deploy the chart
if helm list -n "$NAMESPACE" | grep -q "^${RELEASE_NAME}\s"; then
    echo "Upgrading existing release..."
    helm upgrade "$RELEASE_NAME" . \
        -n "$NAMESPACE" \
        -f "$VALUES_FILE" \
        --wait \
        $DRY_RUN
else
    echo "Installing new release..."
    helm install "$RELEASE_NAME" . \
        -n "$NAMESPACE" \
        -f "$VALUES_FILE" \
        --wait \
        $DRY_RUN
fi

if [[ -z "$DRY_RUN" ]]; then
    echo ""
    echo "Deployment complete! Verifying MinIO deployment..."
    echo ""
    
    # Show deployed resources
    echo "=== StatefulSet Status ==="
    kubectl get statefulset -n "$NAMESPACE" -l app.kubernetes.io/name=minio -o wide
    echo ""
    
    echo "=== Service Status ==="
    kubectl get service -n "$NAMESPACE" -l app.kubernetes.io/name=minio -o wide
    echo ""
    
    echo "=== Ingress Status ==="
    kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=minio -o wide
    echo ""
    
    echo "=== Pod Status ==="
    kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=minio -o wide
    echo ""
    
    echo "=== Persistent Volume Claims ==="
    kubectl get pvc -n "$NAMESPACE" -l app.kubernetes.io/name=minio
    echo ""
    
    # Show access information
    echo "=== MinIO Access Information ==="
    if [[ "$ENVIRONMENT" == "dev" ]]; then
        echo "MinIO Console: http://minio.localhost"
        echo "MinIO API:     http://minio-api.localhost"
    else
        echo "MinIO Console: https://minio.lilnas.io"
        echo "MinIO API:     https://minio-api.lilnas.io"
    fi
    echo ""
    echo "Default credentials (change in production!):"
    echo "  Username: minioadmin"
    echo "  Password: minioadmin"
    echo ""
    echo "To get the admin credentials:"
    echo "  kubectl get secret minio-credentials -n $NAMESPACE -o jsonpath='{.data.username}' | base64 -d"
    echo "  kubectl get secret minio-credentials -n $NAMESPACE -o jsonpath='{.data.password}' | base64 -d"
    echo ""
    echo "To check MinIO logs:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=minio -f"
fi