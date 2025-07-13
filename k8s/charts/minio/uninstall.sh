#!/bin/bash
# Uninstall script for MinIO Helm chart

set -euo pipefail

# Get script directory for relative path resolution
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Default values
NAMESPACE="${NAMESPACE:-lilnas-core}"
RELEASE_NAME="${RELEASE_NAME:-minio}"
FORCE_DELETE=""
KEEP_DATA=""

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -n, --namespace NS       Namespace where MinIO is installed [default: lilnas-core]"
    echo "  -r, --release NAME       Release name [default: minio]"
    echo "  -f, --force             Skip confirmation prompts"
    echo "  -k, --keep-data         Keep persistent volumes (don't show deletion commands)"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Uninstall with confirmation prompts"
    echo "  $0 --force              # Uninstall without prompts"
    echo "  $0 --keep-data          # Uninstall but emphasize data preservation"
    echo "  $0 -n custom-ns -r my-minio  # Uninstall from custom namespace/release"
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
            FORCE_DELETE="true"
            shift
            ;;
        -k|--keep-data)
            KEEP_DATA="true"
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

echo "==========================================="
echo "        MinIO Uninstall Warning"
echo "==========================================="
echo ""
echo "This will uninstall the MinIO Helm release:"
echo "  Release: $RELEASE_NAME"
echo "  Namespace: $NAMESPACE"
echo ""

# Check if release exists
if ! helm list -n "$NAMESPACE" | grep -q "^${RELEASE_NAME}\s"; then
    echo "Release '$RELEASE_NAME' not found in namespace '$NAMESPACE'"
    echo "Available releases in namespace '$NAMESPACE':"
    helm list -n "$NAMESPACE"
    exit 1
fi

# Show what will be removed
echo "=== Resources that will be removed ==="
echo "StatefulSet:"
kubectl get statefulset -n "$NAMESPACE" -l app.kubernetes.io/name=minio 2>/dev/null || echo "  None found"
echo ""
echo "Services:"
kubectl get service -n "$NAMESPACE" -l app.kubernetes.io/name=minio 2>/dev/null || echo "  None found"
echo ""
echo "Ingress:"
kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=minio 2>/dev/null || echo "  None found"
echo ""
echo "Secrets:"
kubectl get secret -n "$NAMESPACE" -l app.kubernetes.io/name=minio 2>/dev/null || echo "  None found"
echo ""

# Show persistent volumes information
echo "=== Data Storage Information ==="
echo "Persistent Volume Claims (PVCs):"
if kubectl get pvc -n "$NAMESPACE" -l app.kubernetes.io/name=minio 2>/dev/null; then
    echo ""
    echo "Persistent Volumes (PVs) bound to these PVCs:"
    PVC_NAMES=$(kubectl get pvc -n "$NAMESPACE" -l app.kubernetes.io/name=minio -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$PVC_NAMES" ]]; then
        for pvc in $PVC_NAMES; do
            PV_NAME=$(kubectl get pvc "$pvc" -n "$NAMESPACE" -o jsonpath='{.spec.volumeName}' 2>/dev/null || echo "")
            if [[ -n "$PV_NAME" ]]; then
                echo "  PVC: $pvc -> PV: $PV_NAME"
                kubectl get pv "$PV_NAME" -o wide 2>/dev/null || echo "    PV details not available"
            fi
        done
    fi
else
    echo "  None found"
fi
echo ""

echo "==========================================="
echo "          IMPORTANT DATA WARNING"
echo "==========================================="
echo ""
echo "🚨 MinIO contains your object storage data!"
echo ""
echo "What happens to your data:"
echo "  ✅ Persistent Volumes (PVs) will be RETAINED"
echo "  ✅ Your MinIO data will NOT be lost"
echo "  ⚠️  You'll need to reinstall MinIO to access the data"
echo "  ⚠️  PVs will remain and consume cluster storage"
echo ""

if [[ -z "$KEEP_DATA" ]]; then
    echo "To permanently delete data (DANGER!):"
    echo "  1. First uninstall MinIO (this script)"
    echo "  2. Delete PVCs: kubectl delete pvc -n $NAMESPACE -l app.kubernetes.io/name=minio"
    echo "  3. Delete PVs: kubectl delete pv <pv-name>  # Use PV names shown above"
    echo ""
    echo "To restore MinIO later with existing data:"
    echo "  1. Reinstall MinIO: ./deploy.sh -e <environment> -n $NAMESPACE"
    echo "  2. Ensure same storage class and PV names are used"
    echo ""
fi

if [[ "$FORCE_DELETE" != "true" ]]; then
    echo "Do you want to proceed with uninstalling MinIO?"
    echo "Your data will be preserved in persistent volumes."
    echo ""
    read -p "Type 'yes' to continue: " -r
    echo ""
    
    if [[ ! "$REPLY" == "yes" ]]; then
        echo "Uninstall cancelled."
        exit 0
    fi
fi

echo "Uninstalling MinIO..."
echo ""

# Perform the uninstall
helm uninstall "$RELEASE_NAME" --namespace "$NAMESPACE"

echo ""
echo "========================================="
echo "        Uninstall Complete"
echo "========================================="
echo ""
echo "✅ MinIO Helm release '$RELEASE_NAME' has been uninstalled"
echo "✅ Persistent volumes have been retained"
echo ""

# Show remaining resources
echo "=== Remaining storage resources ==="
echo "Persistent Volume Claims:"
kubectl get pvc -n "$NAMESPACE" -l app.kubernetes.io/name=minio 2>/dev/null || echo "  All PVCs removed"
echo ""
echo "Persistent Volumes:"
if [[ -n "${PVC_NAMES:-}" ]]; then
    for pvc in $PVC_NAMES; do
        PV_NAME=$(kubectl get pvc "$pvc" -n "$NAMESPACE" -o jsonpath='{.spec.volumeName}' 2>/dev/null || echo "")
        if [[ -n "$PV_NAME" ]] && kubectl get pv "$PV_NAME" >/dev/null 2>&1; then
            echo "  PV: $PV_NAME (retained)"
        fi
    done
else
    echo "  No PVs to check"
fi
echo ""

echo "=== Next Steps ==="
echo ""
echo "To reinstall MinIO with your existing data:"
echo "  ./deploy.sh -e dev -n $NAMESPACE    # For development"
echo "  ./deploy.sh -e prod -n $NAMESPACE   # For production"
echo ""

if [[ -z "$KEEP_DATA" ]]; then
    echo "To completely remove all MinIO data (PERMANENT):"
    echo "  kubectl delete pvc -n $NAMESPACE -l app.kubernetes.io/name=minio"
    if [[ -n "${PVC_NAMES:-}" ]]; then
        for pvc in $PVC_NAMES; do
            PV_NAME=$(kubectl get pvc "$pvc" -n "$NAMESPACE" -o jsonpath='{.spec.volumeName}' 2>/dev/null || echo "")
            if [[ -n "$PV_NAME" ]]; then
                echo "  kubectl delete pv $PV_NAME"
            fi
        done
    fi
    echo ""
    echo "⚠️  WARNING: The above commands will permanently delete all your MinIO data!"
fi