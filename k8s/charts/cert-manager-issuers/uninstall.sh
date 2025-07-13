#!/bin/bash
# Uninstall the cert-manager-issuers Helm chart

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RELEASE_NAME="${RELEASE_NAME:-cert-manager-issuers}"
NAMESPACE="${NAMESPACE:-cert-manager}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -n, --namespace NS       Namespace where chart is installed [default: cert-manager]"
    echo "  -r, --release NAME       Release name [default: cert-manager-issuers]"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Uninstall with default values"
    echo "  $0 -n custom-ns         # Uninstall from custom namespace"
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
echo "This will uninstall the cert-manager-issuers Helm chart."
echo "ClusterIssuers will be removed, but existing certificates will remain valid."
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

# Check if release exists
if helm list -n "$NAMESPACE" | grep -q "^${RELEASE_NAME}\s"; then
    helm uninstall "$RELEASE_NAME" --namespace "$NAMESPACE"
    echo "Successfully uninstalled $RELEASE_NAME"
else
    echo "Release $RELEASE_NAME not found in namespace $NAMESPACE"
fi

echo ""
echo "Helm release uninstalled."
echo ""
echo "Remaining ClusterIssuers (if any):"
kubectl get clusterissuers 2>/dev/null || echo "No ClusterIssuers found"

echo ""
echo "Note: Existing certificates are not affected by this uninstall."
echo "To manually recreate issuers, you can apply the original configuration:"
echo "  kubectl apply -f k8s/cert-manager/letsencrypt-issuers.yaml"