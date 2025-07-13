#!/bin/bash
# Deploy the forward-auth Helm chart

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RELEASE_NAME="${RELEASE_NAME:-forward-auth}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
NAMESPACE="${NAMESPACE:-lilnas-core}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENV    Environment to deploy (dev|prod) [default: dev]"
    echo "  -n, --namespace NS       Namespace to install chart in [default: lilnas-core]"
    echo "  -r, --release NAME       Release name [default: forward-auth]"
    echo "  -d, --dry-run           Perform a dry run"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Deploy with dev values"
    echo "  $0 -e prod              # Deploy with prod values"
    echo "  $0 -e dev --dry-run     # Dry run with dev values"
    echo "  $0 -n lilnas-core -e prod  # Deploy to specific namespace"
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

echo "Deploying forward-auth Helm chart..."
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
    echo "Please create the namespace first or ensure the namespaces chart is deployed."
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
    echo "Deployment complete! Verifying forward-auth resources..."
    echo ""
    
    echo "=== Deployment Status ==="
    kubectl get deployment -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth
    echo ""
    
    echo "=== Service Status ==="
    kubectl get service -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth
    echo ""
    
    echo "=== Ingress Status ==="
    kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth
    echo ""
    
    echo "=== Middleware Status ==="
    kubectl get middleware -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth
    echo ""
    
    echo "=== Pods Status ==="
    kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth
    echo ""
    
    echo "Forward-auth authentication service is ready!"
    echo ""
    echo "To check logs:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=forward-auth -f"
    echo ""
    echo "To check the release:"
    echo "  helm status $RELEASE_NAME -n $NAMESPACE"
fi