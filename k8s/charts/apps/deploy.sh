#!/bin/bash
# Deploy the apps Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Source common functions
source "$(dirname "$0")/../../scripts/lib/common.sh"

RELEASE_NAME="${RELEASE_NAME:-apps}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
NAMESPACE="${NAMESPACE:-lilnas-apps}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENV    Environment to deploy (dev|prod) [default: dev]"
    echo "  -n, --namespace NS       Namespace to install chart in [default: lilnas-apps]"
    echo "  -r, --release NAME       Release name [default: apps]"
    echo "  -d, --dry-run           Perform a dry run"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Deploy with dev values to lilnas-apps namespace"
    echo "  $0 -e prod              # Deploy with production values"
    echo "  $0 -e dev --dry-run     # Dry run with dev values"
    echo "  $0 -n lilnas-dev        # Deploy to specific namespace"
    echo ""
    echo "Notes:"
    echo "  - The apps service requires minimal configuration"
    echo "  - OAuth is configured via forward-auth middleware"
    echo "  - SSL certificates are automatically provisioned by cert-manager"
    echo "  - Health checks are available at /api/health"
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

echo "Deploying apps Helm chart..."
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

# Validate kubectl connection
check_kubectl

# Build helm values args
HELM_VALUES_ARGS="-f $VALUES_FILE"

# Deploy the chart
if [[ -z "$DRY_RUN" ]] && helm list -n "$NAMESPACE" | grep -q "^${RELEASE_NAME}\s"; then
    echo "Upgrading existing release..."
    helm upgrade "$RELEASE_NAME" . \
        -n "$NAMESPACE" \
        $HELM_VALUES_ARGS \
        --wait \
        $DRY_RUN
else
    echo "Installing new release..."
    helm install "$RELEASE_NAME" . \
        -n "$NAMESPACE" \
        $HELM_VALUES_ARGS \
        --wait \
        $DRY_RUN
fi

if [[ -z "$DRY_RUN" ]]; then
    echo ""
    echo "Deployment complete! Verifying apps service components..."
    echo ""
    
    echo "=== Deployment Status ==="
    kubectl get deployment -n "$NAMESPACE" -l app.kubernetes.io/name=apps
    echo ""
    
    echo "=== Service Status ==="
    kubectl get service -n "$NAMESPACE" -l app.kubernetes.io/name=apps
    echo ""
    
    echo "=== Ingress Status ==="
    kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=apps
    echo ""
    
    echo "=== Pod Status ==="
    kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=apps
    echo ""
    
    # Get the ingress host for helpful information
    INGRESS_HOST=$(kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=apps -o jsonpath='{.items[0].spec.rules[0].host}' 2>/dev/null || echo "N/A")
    
    echo "=== Apps Service Information ==="
    echo "Application URL: https://${INGRESS_HOST}"
    echo "Health Check: https://${INGRESS_HOST}/api/health"
    echo ""
    echo "Features:"
    echo "• Next.js application dashboard"
    echo "• OAuth protection via forward-auth middleware"
    echo "• SSL certificates via cert-manager"
    echo "• Health monitoring endpoint"
    echo "• Responsive web interface"
    echo ""
    echo "To view application logs:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=apps -f"
    echo ""
    echo "To check application health:"
    echo "  kubectl exec -n $NAMESPACE deployment/$RELEASE_NAME -- curl http://localhost:8080/api/health"
    echo ""
    echo "To verify OAuth protection:"
    echo "  curl -I https://${INGRESS_HOST} # Should redirect to OAuth provider"
    echo ""
    echo "To check SSL certificate:"
    echo "  kubectl get certificate -n $NAMESPACE"
    echo ""
    echo "Security notes:"
    echo "• OAuth protection enabled via forward-auth middleware"
    echo "• SSL certificates automatically provisioned by cert-manager"
    echo "• Application runs with restricted permissions and read-only root filesystem"
    echo "• Non-root user execution for enhanced security"
fi