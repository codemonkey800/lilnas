#!/bin/bash
# Deploy the turbo-cache Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RELEASE_NAME="${RELEASE_NAME:-turbo-cache}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
NAMESPACE="${NAMESPACE:-lilnas-core}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENV    Environment to deploy (dev|prod) [default: dev]"
    echo "  -n, --namespace NS       Namespace to install chart in [default: lilnas-core]"
    echo "  -r, --release NAME       Release name [default: turbo-cache]"
    echo "  -d, --dry-run           Perform a dry run"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Deploy with dev values to lilnas-core namespace"
    echo "  $0 -e prod              # Deploy with prod values"
    echo "  $0 -e dev --dry-run     # Dry run with dev values"
    echo "  $0 -n lilnas-dev        # Deploy to specific namespace"
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

echo "Deploying turbo-cache Helm chart..."
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

# Deploy the chart
if [[ -z "$DRY_RUN" ]] && helm list -n "$NAMESPACE" | grep -q "^${RELEASE_NAME}\s"; then
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
    echo "Deployment complete! Verifying turbo-cache components..."
    echo ""
    
    echo "=== Deployment Status ==="
    kubectl get deployment -n "$NAMESPACE" -l app.kubernetes.io/name=turbo-cache
    echo ""
    
    echo "=== Service Status ==="
    kubectl get service -n "$NAMESPACE" -l app.kubernetes.io/name=turbo-cache
    echo ""
    
    echo "=== Ingress Status ==="
    kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=turbo-cache
    echo ""
    
    echo "=== Pod Status ==="
    kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=turbo-cache
    echo ""
    
    # Get the ingress host for helpful information
    INGRESS_HOST=$(kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=turbo-cache -o jsonpath='{.items[0].spec.rules[0].host}' 2>/dev/null || echo "N/A")
    
    echo "=== Turbo Cache Information ==="
    echo "API Endpoint: https://${INGRESS_HOST}"
    echo "Health Check: https://${INGRESS_HOST}/v8/artifacts/status"
    echo ""
    echo "To use this remote cache in your Turbo projects:"
    echo "1. Set the TURBO_API environment variable:"
    echo "   export TURBO_API=\"https://${INGRESS_HOST}\""
    echo ""
    echo "2. Set your team's token (get from your turbo-cache secret):"
    echo "   export TURBO_TOKEN=\"your-turbo-token\""
    echo ""
    echo "3. Or add to your turbo.json:"
    echo "   {"
    echo "     \"remoteCache\": {"
    echo "       \"apiUrl\": \"https://${INGRESS_HOST}\""
    echo "     }"
    echo "   }"
    echo ""
    echo "To check the turbo token from the secret:"
    echo "  kubectl get secret -n $NAMESPACE ${RELEASE_NAME}-auth -o jsonpath='{.data.TURBO_TOKEN}' | base64 -d"
    echo ""
    echo "To view logs:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=turbo-cache -f"
fi