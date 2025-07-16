#!/bin/bash
# Uninstall the me-token-tracker Helm chart

set -euo pipefail

RELEASE_NAME="${RELEASE_NAME:-me-token-tracker}"
NAMESPACE="${NAMESPACE:-lilnas-apps}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -n, --namespace NS       Namespace to uninstall from [default: lilnas-apps]"
    echo "  -r, --release NAME       Release name [default: me-token-tracker]"
    echo "  -f, --force             Force removal without confirmation"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Uninstall from lilnas-apps namespace"
    echo "  $0 -n lilnas-prod       # Uninstall from specific namespace"
    echo "  $0 -f                   # Force uninstall without confirmation"
}

FORCE=""

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
            FORCE="true"
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

echo "Uninstalling me-token-tracker Helm chart..."
echo "  Release: $RELEASE_NAME"
echo "  Namespace: $NAMESPACE"
echo ""

# Check if release exists
if ! helm list -n "$NAMESPACE" | grep -q "^${RELEASE_NAME}\s"; then
    echo "Release '$RELEASE_NAME' not found in namespace '$NAMESPACE'"
    exit 1
fi

# Show current status
echo "=== Current Release Status ==="
helm status "$RELEASE_NAME" -n "$NAMESPACE"
echo ""

# Confirm uninstallation unless forced
if [[ -z "$FORCE" ]]; then
    echo "Are you sure you want to uninstall the me-token-tracker release?"
    echo "This will remove the Discord bot and all associated resources."
    echo ""
    read -p "Type 'yes' to confirm: " -r
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        echo "Uninstallation cancelled."
        exit 0
    fi
fi

# Uninstall the release
echo "Uninstalling release '$RELEASE_NAME'..."
helm uninstall "$RELEASE_NAME" -n "$NAMESPACE"

echo ""
echo "=== Verifying Removal ==="
echo "Checking for remaining resources..."

# Check for remaining pods
REMAINING_PODS=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=me-token-tracker --no-headers 2>/dev/null | wc -l)
if [[ $REMAINING_PODS -gt 0 ]]; then
    echo "Warning: Found $REMAINING_PODS remaining pods"
    kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=me-token-tracker
else
    echo "✓ No remaining pods found"
fi

# Check for remaining services
REMAINING_SERVICES=$(kubectl get services -n "$NAMESPACE" -l app.kubernetes.io/name=me-token-tracker --no-headers 2>/dev/null | wc -l)
if [[ $REMAINING_SERVICES -gt 0 ]]; then
    echo "Warning: Found $REMAINING_SERVICES remaining services"
    kubectl get services -n "$NAMESPACE" -l app.kubernetes.io/name=me-token-tracker
else
    echo "✓ No remaining services found"
fi

# Check for remaining secrets
REMAINING_SECRETS=$(kubectl get secrets -n "$NAMESPACE" -l app.kubernetes.io/name=me-token-tracker --no-headers 2>/dev/null | wc -l)
if [[ $REMAINING_SECRETS -gt 0 ]]; then
    echo "Warning: Found $REMAINING_SECRETS remaining secrets"
    kubectl get secrets -n "$NAMESPACE" -l app.kubernetes.io/name=me-token-tracker
else
    echo "✓ No remaining secrets found"
fi

echo ""
echo "me-token-tracker uninstallation completed!"