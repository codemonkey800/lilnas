#!/bin/bash
# Uninstall the forward-auth Helm chart

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RELEASE_NAME="${RELEASE_NAME:-forward-auth}"
NAMESPACE="${NAMESPACE:-lilnas-core}"
FORCE=false

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -n, --namespace NS       Namespace where chart is installed [default: lilnas-core]"
    echo "  -r, --release NAME       Release name [default: forward-auth]"
    echo "  -f, --force             Skip confirmation prompt"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Interactive uninstall"
    echo "  $0 --force              # Uninstall without confirmation"
    echo "  $0 -n custom-ns -r auth # Uninstall from custom namespace"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -r|--release)
            RELEASE_NAME="$2"
            shift 2
            ;;
        -f|--force)
            FORCE=true
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

echo "=== WARNING ==="
echo "This will uninstall the forward-auth Helm chart and remove:"
echo "  - OAuth authentication service"
echo "  - Traefik middleware for authentication"
echo "  - Service and ingress resources"
echo "  - ConfigMap and ServiceAccount"
echo ""
echo "This will affect access to protected services using forward authentication!"
echo ""
echo "Release: $RELEASE_NAME"
echo "Namespace: $NAMESPACE"
echo ""

# Check if release exists
if ! helm list -n "$NAMESPACE" | grep -q "^${RELEASE_NAME}\s"; then
    echo "Error: Helm release '$RELEASE_NAME' not found in namespace '$NAMESPACE'."
    echo ""
    echo "Available releases in namespace '$NAMESPACE':"
    helm list -n "$NAMESPACE"
    exit 1
fi

echo "Resources to be removed:"
echo ""

echo "=== Current Deployment ==="
kubectl get deployment -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth 2>/dev/null || echo "No deployment found"

echo ""
echo "=== Current Service ==="
kubectl get service -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth 2>/dev/null || echo "No service found"

echo ""
echo "=== Current Ingress ==="
kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth 2>/dev/null || echo "No ingress found"

echo ""
echo "=== Current Middleware ==="
kubectl get middleware -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth 2>/dev/null || echo "No middleware found"

echo ""
echo "=== Current Pods ==="
kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth 2>/dev/null || echo "No pods found"

echo ""

if [[ "$FORCE" != "true" ]]; then
    read -p "Are you sure you want to continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Uninstall cancelled."
        exit 0
    fi
fi

echo ""
echo "Uninstalling Helm release..."
helm uninstall "$RELEASE_NAME" -n "$NAMESPACE"

echo ""
echo "Helm release uninstalled successfully."
echo ""

# Wait a moment for resources to be cleaned up
echo "Waiting for resources to be cleaned up..."
sleep 5

echo ""
echo "=== Post-uninstall Status ==="
echo ""

echo "Checking remaining resources (should be empty):"
echo ""

echo "Deployments:"
kubectl get deployment -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth 2>/dev/null || echo "  None found (expected)"

echo ""
echo "Services:"
kubectl get service -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth 2>/dev/null || echo "  None found (expected)"

echo ""
echo "Ingresses:"
kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth 2>/dev/null || echo "  None found (expected)"

echo ""
echo "Middlewares:"
kubectl get middleware -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth 2>/dev/null || echo "  None found (expected)"

echo ""
echo "Pods:"
kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=forward-auth 2>/dev/null || echo "  None found (expected)"

echo ""
echo "=== Important Notes ==="
echo ""
echo "1. The OAuth secret 'forward-auth-secrets' was NOT removed (if it exists)"
echo "   To remove it manually:"
echo "     kubectl delete secret forward-auth-secrets -n $NAMESPACE"
echo ""
echo "2. Services that depend on forward authentication will no longer be protected"
echo "   Review your ingresses and remove authentication middleware if needed"
echo ""
echo "3. To reinstall forward-auth:"
echo "     ./deploy.sh -n $NAMESPACE"
echo ""
echo "4. To check for any remaining resources:"
echo "     kubectl get all,middleware,configmap,secret -n $NAMESPACE -l app.kubernetes.io/name=forward-auth"