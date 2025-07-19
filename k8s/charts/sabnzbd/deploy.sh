#!/bin/bash
# Deploy the sabnzbd Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RELEASE_NAME="${RELEASE_NAME:-sabnzbd}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
NAMESPACE="${NAMESPACE:-lilnas-apps}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENV    Environment to deploy (dev|prod) [default: dev]"
    echo "  -n, --namespace NS       Namespace to install chart in [default: lilnas-apps]"
    echo "  -r, --release NAME       Release name [default: sabnzbd]"
    echo "  -d, --dry-run           Perform a dry run"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Deploy with dev values to lilnas-apps namespace"
    echo "  $0 -e dev --dry-run     # Dry run with dev values"
    echo "  $0 -e prod -n lilnas-apps # Production deployment"
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

# Set values file based on environment - fallback to values.yaml if environment-specific doesn't exist
VALUES_FILE="values.yaml"
if [[ -f "values-${ENVIRONMENT}.yaml" ]]; then
    VALUES_FILE="values-${ENVIRONMENT}.yaml"
fi

echo "Deploying sabnzbd Helm chart..."
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
    echo "Deployment complete! Verifying sabnzbd service components..."
    echo ""
    
    echo "=== Deployment Status ==="
    kubectl get deployment -n "$NAMESPACE" -l app.kubernetes.io/name=sabnzbd
    echo ""
    
    echo "=== Service Status ==="
    kubectl get service -n "$NAMESPACE" -l app.kubernetes.io/name=sabnzbd
    echo ""
    
    echo "=== Ingress Status ==="
    kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=sabnzbd
    echo ""
    
    echo "=== Pod Status ==="
    kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=sabnzbd
    echo ""
    
    echo "=== Persistent Volume Claims ==="
    kubectl get pvc -n "$NAMESPACE" -l app.kubernetes.io/name=sabnzbd
    echo ""
    
    # Get the ingress host for helpful information
    INGRESS_HOST=$(kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=sabnzbd -o jsonpath='{.items[0].spec.rules[0].host}' 2>/dev/null || echo "N/A")
    
    echo "=== SABnzbd Service Information ==="
    echo "Web Interface: https://${INGRESS_HOST}"
    echo ""
    echo "Features:"
    echo "• Usenet binary newsreader"
    echo "• NZB file processing"
    echo "• Download queue management"
    echo "• Integration with Sonarr/Radarr"
    echo "• Web-based configuration interface"
    echo ""
    echo "Configuration:"
    echo "• Data stored on HDD storage: /mnt/hdd1"
    echo "• Web interface accessible without forward-auth"
    echo "• Uses LinuxServer.io SABnzbd image"
    echo ""
    echo "To view service logs:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=sabnzbd -f"
    echo ""
    echo "To access the configuration:"
    echo "  kubectl exec -n $NAMESPACE deployment/$RELEASE_NAME -- ls -la /config"
    echo ""
    echo "To check download status:"
    echo "  kubectl exec -n $NAMESPACE deployment/$RELEASE_NAME -- ls -la /config/Downloads/"
    echo ""
    echo "Note: Existing SABnzbd data at /mnt/hdd1/data/media/sabnzbd/"
    echo "may need to be moved to the new PVC mount point after first deployment."
fi