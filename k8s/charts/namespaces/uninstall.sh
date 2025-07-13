#!/bin/bash
# Uninstall the namespaces Helm chart

set -euo pipefail

RELEASE_NAME="${RELEASE_NAME:-namespaces}"
NAMESPACE="${NAMESPACE:-default}"

echo "=== WARNING ==="
echo "This will uninstall the namespaces Helm chart."
echo "Note: Namespaces will NOT be deleted to prevent data loss."
echo "You must manually delete namespaces if needed."
echo ""
echo "Release: $RELEASE_NAME"
echo "Namespace: $NAMESPACE"
echo ""

read -p "Are you sure you want to continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
fi

echo ""
echo "Uninstalling Helm release..."
helm uninstall "$RELEASE_NAME" -n "$NAMESPACE"

echo ""
echo "Helm release uninstalled."
echo ""
echo "Existing namespaces are still present:"
kubectl get namespaces -l project=lilnas

echo ""
echo "To delete namespaces manually, run:"
echo "  kubectl delete namespace <namespace-name>"
echo ""
echo "To delete all lilnas namespaces (DANGEROUS!):"
echo "  kubectl delete namespaces -l project=lilnas"