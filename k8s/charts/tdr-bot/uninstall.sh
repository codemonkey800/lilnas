#!/bin/bash
# Uninstall the tdr-bot Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RELEASE_NAME="${RELEASE_NAME:-tdr-bot}"
NAMESPACE="${NAMESPACE:-lilnas-apps}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -n, --namespace NS       Namespace where chart is installed [default: lilnas-apps]"
    echo "  -r, --release NAME       Release name [default: tdr-bot]"
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
echo "This will uninstall the tdr-bot Helm chart and remove all associated resources."
echo ""
echo "The following will be removed:"
echo "  - Deployment: ${RELEASE_NAME}"
echo "  - Service: ${RELEASE_NAME}"
echo "  - Ingress: ${RELEASE_NAME}"
echo "  - ServiceAccount: ${RELEASE_NAME}"
echo "  - Secret: ${RELEASE_NAME}-secrets (contains Discord/AI API keys)"
echo "  - ConfigMap: ${RELEASE_NAME}-config"
echo "  - PodDisruptionBudget: ${RELEASE_NAME}"
echo "  - PersistentVolumeClaim: ${RELEASE_NAME}-data (if exists)"
echo ""
echo "IMPORTANT: This will stop the Discord bot completely!"
echo "Users will no longer be able to interact with the bot until it's redeployed."
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

# Show current bot activity
echo "=== Bot Activity Status ==="
BOT_PODS=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/instance="$RELEASE_NAME" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$BOT_PODS" ]]; then
    echo "Active bot pods: $BOT_PODS"
    echo ""
    echo "Recent bot activity:"
    kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/instance="$RELEASE_NAME" --tail=5 --since=1h 2>/dev/null || echo "No recent logs available"
else
    echo "No active bot pods found"
fi
echo ""

# Confirmation prompt
if [[ "$FORCE" != "true" ]]; then
    echo "⚠️  Discord bot will be completely offline after this operation!"
    echo ""
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
echo "• The Discord bot is now completely offline"
echo "• Discord users will receive no response from the bot"
echo "• Bot conversation history and AI context are lost"
echo "• Files stored in MinIO will remain unless manually deleted"
echo "• Bot credentials remain in 1password for redeployment"
echo "• TLS certificates may be retained for reuse if the same hostname is used again"
echo ""
echo "Data that persists after uninstall:"
echo "• MinIO file storage contents"
echo "• Discord bot application registration (Discord Developer Portal)"
echo "• 1password secret items"
echo "• Kubernetes namespace (if other services are running)"
echo ""
echo "To check MinIO bot data:"
echo "  kubectl port-forward -n lilnas-core service/minio 9001:9001"
echo "  # Then visit http://localhost:9001 and check bot-related buckets"
echo ""
echo "To clean up MinIO bot data (if desired):"
echo "  # Connect to MinIO console and delete bot-related buckets/files"
echo "  # Or use mc (MinIO Client) to remove bot data:"
echo "  # mc rm --recursive minio/bot-data/"
echo ""
echo "Discord Bot Status:"
echo "• Bot application still exists in Discord Developer Portal"
echo "• Bot token is still valid but inactive"
echo "• Bot permissions and slash commands remain registered"
echo "• Bot will appear offline in Discord servers"
echo ""
echo "To redeploy tdr-bot:"
echo "  ./deploy.sh"
echo ""
echo "To redeploy with specific environment:"
echo "  ./deploy.sh -e prod"
echo ""
echo "To check other Helm releases in this namespace:"
echo "  helm list -n $NAMESPACE"
echo ""
echo "AI/ML Service Dependencies:"
echo "• OpenAI API access: Still available (key stored in 1password)"
echo "• Tavily search API: Still available (key stored in 1password)"
echo "• Hugging Face models: Still available (token stored in 1password)"
echo "• Equations service: Still running (if deployed separately)"
echo ""
echo "If you need to completely remove the bot from Discord:"
echo "1. Visit https://discord.com/developers/applications"
echo "2. Delete the bot application"
echo "3. Remove bot from Discord servers manually"
echo "4. Revoke API keys if no longer needed"