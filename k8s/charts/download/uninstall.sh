#!/bin/bash
# Uninstall the download Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RELEASE_NAME="${RELEASE_NAME:-download}"
NAMESPACE="${NAMESPACE:-lilnas-apps}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -n, --namespace NS       Namespace where chart is installed [default: lilnas-apps]"
    echo "  -r, --release NAME       Release name [default: download]"
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
echo "This will uninstall the download Helm chart and remove all associated resources."
echo ""
echo "The following will be removed:"
echo "  - Deployment: ${RELEASE_NAME}"
echo "  - Service: ${RELEASE_NAME}"
echo "  - Ingress: ${RELEASE_NAME}"
echo "  - ServiceAccount: ${RELEASE_NAME}"
echo "  - Secret: ${RELEASE_NAME}-auth (contains MinIO credentials)"
echo "  - ConfigMap: ${RELEASE_NAME}-config"
echo "  - PodDisruptionBudget: ${RELEASE_NAME}"
echo "  - PersistentVolumeClaim: ${RELEASE_NAME}-downloads (if exists)"
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
echo "=== Secrets ==="
kubectl get secret -n "$NAMESPACE" -l app.kubernetes.io/instance="$RELEASE_NAME" 2>/dev/null || echo "None found"
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

if kubectl get secret -n "$NAMESPACE" -l app.kubernetes.io/instance="$RELEASE_NAME" 2>/dev/null | grep -q "$RELEASE_NAME"; then
    echo "Warning: Some secrets still exist"
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
    echo "  kubectl delete secret -n $NAMESPACE -l app.kubernetes.io/instance=$RELEASE_NAME"
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
echo "• Downloaded videos stored in MinIO will remain unless manually deleted"
echo "• Any active downloads at the time of uninstall were interrupted"
echo "• Download history and metadata in MinIO will persist"
echo "• TLS certificates may be retained for reuse if the same hostname is used again"
echo ""
echo "To check MinIO download data:"
echo "  kubectl port-forward -n lilnas-core service/minio 9001:9001"
echo "  # Then visit http://localhost:9001 and check the 'downloads' bucket"
echo ""
echo "To clean up MinIO download data (if desired):"
echo "  # Connect to MinIO console and delete contents of 'downloads' bucket"
echo "  # Or use mc (MinIO Client) to remove download data:"
echo "  # mc rm --recursive minio/downloads/"
echo ""
echo "To redeploy download service:"
echo "  ./deploy.sh"
echo ""
echo "To check other Helm releases in this namespace:"
echo "  helm list -n $NAMESPACE"