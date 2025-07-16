#!/bin/bash
# Deploy the me-token-tracker Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RELEASE_NAME="${RELEASE_NAME:-me-token-tracker}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
NAMESPACE="${NAMESPACE:-lilnas-apps}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENV    Environment to deploy (prod) [default: prod]"
    echo "  -n, --namespace NS       Namespace to install chart in [default: lilnas-apps]"
    echo "  -r, --release NAME       Release name [default: me-token-tracker]"
    echo "  -d, --dry-run           Perform a dry run"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Secret Options (required for Discord bot functionality):"
    echo "  --api-token TOKEN        Discord bot API token"
    echo "  --application-id ID      Discord application ID"
    echo "  --client-id ID           Discord client ID"
    echo "  --client-secret SECRET   Discord client secret"
    echo "  --dev-guild-id ID        Discord development guild ID"
    echo "  --public-key KEY         Discord public key"
    echo ""
    echo "Examples:"
    echo "  $0                      # Deploy with prod values to lilnas-apps namespace"
    echo "  $0 --dry-run            # Dry run with prod values"
    echo "  $0 -n lilnas-prod       # Deploy to specific namespace"
    echo ""
    echo "  # Production deployment with secrets:"
    echo "  $0 \\"
    echo "    --api-token 'your-discord-token' \\"
    echo "    --client-id 'your-client-id' \\"
    echo "    --client-secret 'your-client-secret' \\"
    echo "    --application-id 'your-application-id'"
    echo ""
    echo "  # Using environment variables for secrets:"
    echo "  export ME_TOKEN_TRACKER_API_TOKEN='your-discord-token'"
    echo "  export ME_TOKEN_TRACKER_CLIENT_ID='your-client-id'"
    echo "  export ME_TOKEN_TRACKER_CLIENT_SECRET='your-client-secret'"
    echo "  export ME_TOKEN_TRACKER_APPLICATION_ID='your-application-id'"
    echo "  $0"
}

DRY_RUN=""
API_TOKEN=""
APPLICATION_ID=""
CLIENT_ID=""
CLIENT_SECRET=""
DEV_GUILD_ID=""
PUBLIC_KEY=""

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
        --api-token)
            API_TOKEN="$2"
            shift 2
            ;;
        --application-id)
            APPLICATION_ID="$2"
            shift 2
            ;;
        --client-id)
            CLIENT_ID="$2"
            shift 2
            ;;
        --client-secret)
            CLIENT_SECRET="$2"
            shift 2
            ;;
        --dev-guild-id)
            DEV_GUILD_ID="$2"
            shift 2
            ;;
        --public-key)
            PUBLIC_KEY="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Validate environment
if [[ "$ENVIRONMENT" != "prod" ]]; then
    echo "Error: Invalid environment '$ENVIRONMENT'. Must be 'prod'."
    exit 1
fi


# Validate required secrets for production
if [[ -z "$DRY_RUN" ]]; then
    MISSING_SECRETS=""
    if [[ -z "$API_TOKEN" ]]; then
        MISSING_SECRETS="${MISSING_SECRETS}--api-token "
    fi
    if [[ -z "$CLIENT_ID" ]]; then
        MISSING_SECRETS="${MISSING_SECRETS}--client-id "
    fi
    if [[ -z "$APPLICATION_ID" ]]; then
        MISSING_SECRETS="${MISSING_SECRETS}--application-id "
    fi
    
    if [[ -n "$MISSING_SECRETS" ]]; then
        echo "Error: Production deployment requires the following secrets:"
        echo "  $MISSING_SECRETS"
        echo ""
        echo "You can also set these via environment variables:"
        echo "  export ME_TOKEN_TRACKER_API_TOKEN='your-discord-token'"
        echo "  export ME_TOKEN_TRACKER_CLIENT_ID='your-client-id'"
        echo "  export ME_TOKEN_TRACKER_APPLICATION_ID='your-application-id'"
        exit 1
    fi
fi

# Allow environment variables as fallback for secrets
API_TOKEN="${API_TOKEN:-${ME_TOKEN_TRACKER_API_TOKEN:-}}"
APPLICATION_ID="${APPLICATION_ID:-${ME_TOKEN_TRACKER_APPLICATION_ID:-}}"
CLIENT_ID="${CLIENT_ID:-${ME_TOKEN_TRACKER_CLIENT_ID:-}}"
CLIENT_SECRET="${CLIENT_SECRET:-${ME_TOKEN_TRACKER_CLIENT_SECRET:-}}"
DEV_GUILD_ID="${DEV_GUILD_ID:-${ME_TOKEN_TRACKER_DEV_GUILD_ID:-}}"
PUBLIC_KEY="${PUBLIC_KEY:-${ME_TOKEN_TRACKER_PUBLIC_KEY:-}}"

# Set values file based on environment
VALUES_FILE="values-${ENVIRONMENT}.yaml"

echo "Deploying me-token-tracker Helm chart..."
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

# Add secret values if provided
if [[ -n "$API_TOKEN" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.API_TOKEN='$API_TOKEN'"
fi
if [[ -n "$APPLICATION_ID" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.APPLICATION_ID='$APPLICATION_ID'"
fi
if [[ -n "$CLIENT_ID" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.CLIENT_ID='$CLIENT_ID'"
fi
if [[ -n "$CLIENT_SECRET" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.CLIENT_SECRET='$CLIENT_SECRET'"
fi
if [[ -n "$DEV_GUILD_ID" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.DEV_GUILD_ID='$DEV_GUILD_ID'"
fi
if [[ -n "$PUBLIC_KEY" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.PUBLIC_KEY='$PUBLIC_KEY'"
fi

# Deploy the chart
if [[ -z "$DRY_RUN" ]] && helm list -n "$NAMESPACE" | grep -q "^${RELEASE_NAME}\s"; then
    echo "Upgrading existing release..."
    eval helm upgrade "$RELEASE_NAME" . \
        -n "$NAMESPACE" \
        $HELM_VALUES_ARGS \
        --wait \
        $DRY_RUN
else
    echo "Installing new release..."
    eval helm install "$RELEASE_NAME" . \
        -n "$NAMESPACE" \
        $HELM_VALUES_ARGS \
        --wait \
        $DRY_RUN
fi

if [[ -z "$DRY_RUN" ]]; then
    echo ""
    echo "Deployment complete! Verifying me-token-tracker service components..."
    echo ""
    
    echo "=== Deployment Status ==="
    kubectl get deployment -n "$NAMESPACE" -l app.kubernetes.io/name=me-token-tracker
    echo ""
    
    echo "=== Service Status ==="
    kubectl get service -n "$NAMESPACE" -l app.kubernetes.io/name=me-token-tracker
    echo ""
    
    echo "=== Pod Status ==="
    kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=me-token-tracker
    echo ""
    
    echo "=== Secret Status ==="
    kubectl get secret -n "$NAMESPACE" -l app.kubernetes.io/name=me-token-tracker
    echo ""
    
    echo "=== ME Token Tracker Information ==="
    echo "Discord Bot Features:"
    echo "• Cryptocurrency token tracking"
    echo "• CoinGecko API integration"
    echo "• Discord slash commands"
    echo "• Real-time price updates"
    echo ""
    echo "To view bot logs:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=me-token-tracker -f"
    echo ""
    echo "To check bot health:"
    echo "  kubectl exec -n $NAMESPACE deployment/$RELEASE_NAME -- curl http://localhost:8080/"
    echo ""
    echo "To verify Discord connection:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=me-token-tracker | grep -i discord"
    echo ""
    echo "To check CoinGecko integration:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=me-token-tracker | grep -i coingecko"
    echo ""
    echo "Security notes:"
    echo "• The bot runs with restricted permissions and read-only root filesystem"
    echo "• All secrets are stored in Kubernetes secrets"
    echo "• Network policies can be enabled for additional security"
fi