#!/bin/bash
# Uninstall the sabnzbd Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RELEASE_NAME="${RELEASE_NAME:-sabnzbd}"
NAMESPACE="${NAMESPACE:-lilnas-apps}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -n, --namespace NS       Namespace where chart is installed [default: lilnas-apps]"
    echo "  -r, --release NAME       Release name [default: sabnzbd]"
    echo "  -f, --force             Skip confirmation prompt"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Uninstall with default settings"
    echo "  $0 -n lilnas-dev        # Uninstall from specific namespace"
    echo "  $0 -f                   # Force uninstall without confirmation"
}

FORCE=false

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
echo "This will uninstall the sabnzbd Helm chart and remove all associated resources."
echo ""
echo "The following will be removed:"
echo "  - Deployment: ${RELEASE_NAME}"
echo "  - Service: ${RELEASE_NAME}"
echo "  - Ingress: ${RELEASE_NAME}"
echo "  - ServiceAccount: ${RELEASE_NAME}"
echo "  - ConfigMap: ${RELEASE_NAME}-config (if exists)"
echo "  - PodDisruptionBudget: ${RELEASE_NAME}"
echo "  - PersistentVolumeClaim: ${RELEASE_NAME} (contains SABnzbd data)"
echo ""
echo "IMPORTANT: Your SABnzbd configuration and download data will be preserved"
echo "on the host filesystem at /mnt/hdd1/data/media/sabnzbd/"
echo ""
echo "Release: $RELEASE_NAME"
echo "Namespace: $NAMESPACE"
echo ""

# Check if the release exists
if ! helm list -n "$NAMESPACE" | grep -q "^${RELEASE_NAME}\s"; then
    echo "Error: Helm release '$RELEASE_NAME' not found in namespace '$NAMESPACE'."
    echo ""
    echo "Available releases in namespace '$NAMESPACE':"
    helm list -n "$NAMESPACE"
    exit 1
fi

# Show what will be removed
echo "Current resources that will be removed:"
echo ""
echo "=== Deployments ==="
kubectl get deployment -n "$NAMESPACE" -l app.kubernetes.io/instance="$RELEASE_NAME" 2>/dev/null || echo "None found"
echo ""
echo "=== Services ==="
kubectl get service -n "$NAMESPACE" -l app.kubernetes.io/instance="$RELEASE_NAME" 2>/dev/null || echo "None found"
echo ""
echo "=== Ingresses ==="
kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/instance="$RELEASE_NAME" 2>/dev/null || echo "None found"
echo ""
echo "=== ConfigMaps ==="
kubectl get configmap -n "$NAMESPACE" -l app.kubernetes.io/instance="$RELEASE_NAME" 2>/dev/null || echo "None found"
echo ""
echo "=== PersistentVolumeClaims ==="
kubectl get pvc -n "$NAMESPACE" -l app.kubernetes.io/instance="$RELEASE_NAME" 2>/dev/null || echo "None found"
echo ""

# Confirmation prompt
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
echo "Helm release '$RELEASE_NAME' has been uninstalled from namespace '$NAMESPACE'."
echo ""

# Check for any remaining resources
echo "Checking for any remaining resources..."
REMAINING_RESOURCES=false

if kubectl get deployment -n "$NAMESPACE" -l app.kubernetes.io/instance="$RELEASE_NAME" 2>/dev/null | grep -q "$RELEASE_NAME"; then
    echo "Warning: Some deployments still exist"
    REMAINING_RESOURCES=true
fi

if kubectl get service -n "$NAMESPACE" -l app.kubernetes.io/instance="$RELEASE_NAME" 2>/dev/null | grep -q "$RELEASE_NAME"; then
    echo "Warning: Some services still exist"
    REMAINING_RESOURCES=true
fi

if kubectl get configmap -n "$NAMESPACE" -l app.kubernetes.io/instance="$RELEASE_NAME" 2>/dev/null | grep -q "$RELEASE_NAME"; then
    echo "Warning: Some configmaps still exist"
    REMAINING_RESOURCES=true
fi

if kubectl get pvc -n "$NAMESPACE" -l app.kubernetes.io/instance="$RELEASE_NAME" 2>/dev/null | grep -q "$RELEASE_NAME"; then
    echo "Warning: Some persistent volume claims still exist"
    REMAINING_RESOURCES=true
fi

if [[ "$REMAINING_RESOURCES" == "true" ]]; then
    echo ""
    echo "If you need to manually clean up remaining resources, use:"
    echo "  kubectl delete all -n $NAMESPACE -l app.kubernetes.io/instance=$RELEASE_NAME"
    echo "  kubectl delete configmap -n $NAMESPACE -l app.kubernetes.io/instance=$RELEASE_NAME"
    echo "  kubectl delete ingress -n $NAMESPACE -l app.kubernetes.io/instance=$RELEASE_NAME"
    echo "  kubectl delete pvc -n $NAMESPACE -l app.kubernetes.io/instance=$RELEASE_NAME"
else
    echo "All resources have been successfully removed."
fi

echo ""
echo "=== Post-Uninstall Information ==="
echo ""
echo "Important Notes:"
echo "• SABnzbd configuration data is preserved at /mnt/hdd1/data/media/sabnzbd/"
echo "• Download history and settings will be available when redeploying"
echo "• Any incomplete downloads were interrupted and may need to be restarted"
echo "• TLS certificates may be retained for reuse if the same hostname is used again"
echo ""
echo "Your data location on the host:"
echo "  /mnt/hdd1/data/media/sabnzbd/"
echo "  ├── sabnzbd.ini          (main configuration)"
echo "  ├── admin/               (database files)"
echo "  ├── logs/                (application logs)"
echo "  └── Downloads/           (download directories)"
echo ""
echo "To check existing data:"
echo "  ls -la /mnt/hdd1/data/media/sabnzbd/"
echo ""
echo "To redeploy sabnzbd service:"
echo "  ./deploy.sh"
echo ""
echo "To check other Helm releases in this namespace:"
echo "  helm list -n $NAMESPACE"
echo ""
echo "Integration notes:"
echo "• If using with Sonarr/Radarr, update their SABnzbd configuration"
echo "• Download client integrations may need to be reconfigured"