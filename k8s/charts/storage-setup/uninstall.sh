#!/bin/bash
# Uninstall the storage-setup Helm chart

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Default values
NAMESPACE="default"
RELEASE_NAME="storage-setup"

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
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -n, --namespace NS       Namespace where chart is installed [default: default]"
            echo "  -r, --release NAME       Release name [default: storage-setup]"
            echo "  -h, --help              Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                      # Uninstall with default values"
            echo "  $0 -n custom-ns         # Uninstall from custom namespace"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [OPTIONS]"
            exit 1
            ;;
    esac
done

echo "=== WARNING ==="
echo "This will uninstall the storage-setup Helm chart."
echo "Note: Persistent Volumes will be retained due to the 'Retain' reclaim policy."
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
    helm uninstall "$RELEASE_NAME" -n "$NAMESPACE"
    echo "Successfully uninstalled $RELEASE_NAME"
else
    echo "Release $RELEASE_NAME not found in namespace $NAMESPACE"
fi

echo ""
echo "Helm release uninstalled."
echo ""
echo "Note: Persistent Volumes have been retained and must be manually deleted if needed:"
echo "Storage Classes:"
kubectl get storageclass | grep -E "(ssd-storage|hdd-storage|shared-storage)" || echo "  No lilnas storage classes found"
echo ""
echo "Persistent Volumes:"
kubectl get pv | grep -E "(app-configs|build-cache|game-servers|google-photos|immich|media-services|minio|movies|postgres|redis|tv)" || echo "  No lilnas PVs found"
echo ""
echo "To delete a specific resource (WARNING: This will delete the data!):"
echo "  kubectl delete pv <pv-name>"
echo "  kubectl delete storageclass <sc-name>"