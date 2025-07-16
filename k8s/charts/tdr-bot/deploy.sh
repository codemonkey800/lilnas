#!/bin/bash
# Deploy the tdr-bot Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RELEASE_NAME="${RELEASE_NAME:-tdr-bot}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
NAMESPACE="${NAMESPACE:-lilnas-apps}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENV    Environment to deploy (dev|prod) [default: dev]"
    echo "  -n, --namespace NS       Namespace to install chart in [default: lilnas-apps]"
    echo "  -r, --release NAME       Release name [default: tdr-bot]"
    echo "  -d, --dry-run           Perform a dry run"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Secret Options (required for Discord bot functionality):"
    echo "  --discord-token TOKEN        Discord bot API token"
    echo "  --discord-client-id ID       Discord bot client ID"
    echo "  --discord-guild-id ID        Discord development guild ID"
    echo "  --openai-api-key KEY        OpenAI API key for AI features"
    echo "  --tavily-api-key KEY        Tavily API key for search"
    echo "  --huggingface-token TOKEN   Hugging Face token for AI models"
    echo "  --serp-api-key KEY          SERP API key for search"
    echo "  --ombi-api-key KEY          Ombi API key for media requests"
    echo "  --equations-api-key KEY     Equations service API key"
    echo "  --minio-access-key KEY      MinIO access key"
    echo "  --minio-secret-key KEY      MinIO secret key"
    echo ""
    echo "Examples:"
    echo "  $0                      # Deploy with dev values to lilnas-apps namespace"
    echo "  $0 -e dev --dry-run     # Dry run with dev values"
    echo "  $0 -n lilnas-dev        # Deploy to specific namespace"
    echo ""
    echo "  # Production deployment with secrets:"
    echo "  $0 -e prod \\"
    echo "    --discord-token 'your-discord-token' \\"
    echo "    --discord-client-id 'your-client-id' \\"
    echo "    --openai-api-key 'your-openai-key' \\"
    echo "    --minio-access-key 'your-minio-access-key' \\"
    echo "    --minio-secret-key 'your-minio-secret-key'"
    echo ""
    echo "  # Using environment variables for secrets:"
    echo "  export TDR_BOT_DISCORD_TOKEN='your-discord-token'"
    echo "  export TDR_BOT_DISCORD_CLIENT_ID='your-client-id'"
    echo "  export TDR_BOT_OPENAI_API_KEY='your-openai-key'"
    echo "  export TDR_BOT_MINIO_ACCESS_KEY='your-minio-access-key'"
    echo "  export TDR_BOT_MINIO_SECRET_KEY='your-minio-secret-key'"
    echo "  $0 -e prod"
}

DRY_RUN=""
DISCORD_TOKEN=""
DISCORD_CLIENT_ID=""
DISCORD_GUILD_ID=""
OPENAI_API_KEY=""
TAVILY_API_KEY=""
HUGGINGFACE_TOKEN=""
SERP_API_KEY=""
OMBI_API_KEY=""
EQUATIONS_API_KEY=""
MINIO_ACCESS_KEY=""
MINIO_SECRET_KEY=""

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
        --discord-token)
            DISCORD_TOKEN="$2"
            shift 2
            ;;
        --discord-client-id)
            DISCORD_CLIENT_ID="$2"
            shift 2
            ;;
        --discord-guild-id)
            DISCORD_GUILD_ID="$2"
            shift 2
            ;;
        --openai-api-key)
            OPENAI_API_KEY="$2"
            shift 2
            ;;
        --tavily-api-key)
            TAVILY_API_KEY="$2"
            shift 2
            ;;
        --huggingface-token)
            HUGGINGFACE_TOKEN="$2"
            shift 2
            ;;
        --serp-api-key)
            SERP_API_KEY="$2"
            shift 2
            ;;
        --ombi-api-key)
            OMBI_API_KEY="$2"
            shift 2
            ;;
        --equations-api-key)
            EQUATIONS_API_KEY="$2"
            shift 2
            ;;
        --minio-access-key)
            MINIO_ACCESS_KEY="$2"
            shift 2
            ;;
        --minio-secret-key)
            MINIO_SECRET_KEY="$2"
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
if [[ "$ENVIRONMENT" != "dev" && "$ENVIRONMENT" != "prod" ]]; then
    echo "Error: Invalid environment '$ENVIRONMENT'. Must be 'dev' or 'prod'."
    exit 1
fi

# Check if 1password CLI is available
if command -v op &> /dev/null && [[ -z "$DISCORD_TOKEN" || -z "$DISCORD_CLIENT_ID" || -z "$OPENAI_API_KEY" || -z "$MINIO_ACCESS_KEY" || -z "$MINIO_SECRET_KEY" ]]; then
    echo "Fetching secrets from 1password..."
    
    # Check if user is signed in to 1password
    if ! op account list &> /dev/null; then
        echo "Please sign in to 1password first: eval \$(op signin)"
        exit 1
    fi
    
    # Set OP_ACCOUNT if multiple accounts exist
    export OP_ACCOUNT=${OP_ACCOUNT:-AYHWYYW3CBB3ZEJVIFODSATT7Y}
    
    # Fetch secrets from 1password TDR Bot item
    if [[ -z "$DISCORD_TOKEN" ]]; then
        DISCORD_TOKEN=$(op item get "TDR Bot" --fields "discord token" 2>/dev/null || echo "")
    fi
    if [[ -z "$DISCORD_CLIENT_ID" ]]; then
        DISCORD_CLIENT_ID=$(op item get "TDR Bot" --fields "discord client id" 2>/dev/null || echo "")
    fi
    if [[ -z "$DISCORD_GUILD_ID" ]]; then
        DISCORD_GUILD_ID=$(op item get "TDR Bot" --fields "discord guild id" 2>/dev/null || echo "")
    fi
    if [[ -z "$OPENAI_API_KEY" ]]; then
        OPENAI_API_KEY=$(op item get "TDR Bot" --fields "openai api key" 2>/dev/null || echo "")
    fi
    if [[ -z "$TAVILY_API_KEY" ]]; then
        TAVILY_API_KEY=$(op item get "TDR Bot" --fields "tavily api key" 2>/dev/null || echo "")
    fi
    if [[ -z "$HUGGINGFACE_TOKEN" ]]; then
        HUGGINGFACE_TOKEN=$(op item get "TDR Bot" --fields "huggingface token" 2>/dev/null || echo "")
    fi
    if [[ -z "$SERP_API_KEY" ]]; then
        SERP_API_KEY=$(op item get "TDR Bot" --fields "serp api key" 2>/dev/null || echo "")
    fi
    if [[ -z "$OMBI_API_KEY" ]]; then
        OMBI_API_KEY=$(op item get "TDR Bot" --fields "ombi api key" 2>/dev/null || echo "")
    fi
    if [[ -z "$EQUATIONS_API_KEY" ]]; then
        EQUATIONS_API_KEY=$(op item get "TDR Bot" --fields "equations api key" 2>/dev/null || echo "")
    fi
    
    # Fetch MinIO credentials from MinIO item if not found in TDR Bot item
    if [[ -z "$MINIO_ACCESS_KEY" || -z "$MINIO_SECRET_KEY" ]]; then
        echo "Trying MinIO item in 1password..."
        if [[ -z "$MINIO_ACCESS_KEY" ]]; then
            MINIO_ACCESS_KEY=$(op item get "MinIO" --fields "access key" 2>/dev/null || echo "")
        fi
        if [[ -z "$MINIO_SECRET_KEY" ]]; then
            MINIO_SECRET_KEY=$(op item get "MinIO" --fields "secret key" 2>/dev/null || echo "")
        fi
    fi
    
    # Check TDR Bot item for MinIO credentials if still not found
    if [[ -z "$MINIO_ACCESS_KEY" ]]; then
        MINIO_ACCESS_KEY=$(op item get "TDR Bot" --fields "minio access key" 2>/dev/null || echo "")
    fi
    if [[ -z "$MINIO_SECRET_KEY" ]]; then
        MINIO_SECRET_KEY=$(op item get "TDR Bot" --fields "minio secret key" 2>/dev/null || echo "")
    fi
    
    if [[ -n "$DISCORD_TOKEN" && -n "$DISCORD_CLIENT_ID" && -n "$OPENAI_API_KEY" && -n "$MINIO_ACCESS_KEY" && -n "$MINIO_SECRET_KEY" ]]; then
        echo "Successfully fetched core secrets from 1password"
    else
        echo "Warning: Failed to fetch some core secrets from 1password"
    fi
fi

# Validate required secrets for production
if [[ "$ENVIRONMENT" == "prod" && -z "$DRY_RUN" ]]; then
    MISSING_SECRETS=""
    if [[ -z "$DISCORD_TOKEN" ]]; then
        MISSING_SECRETS="${MISSING_SECRETS}--discord-token "
    fi
    if [[ -z "$DISCORD_CLIENT_ID" ]]; then
        MISSING_SECRETS="${MISSING_SECRETS}--discord-client-id "
    fi
    if [[ -z "$OPENAI_API_KEY" ]]; then
        MISSING_SECRETS="${MISSING_SECRETS}--openai-api-key "
    fi
    if [[ -z "$MINIO_ACCESS_KEY" ]]; then
        MISSING_SECRETS="${MISSING_SECRETS}--minio-access-key "
    fi
    if [[ -z "$MINIO_SECRET_KEY" ]]; then
        MISSING_SECRETS="${MISSING_SECRETS}--minio-secret-key "
    fi
    
    if [[ -n "$MISSING_SECRETS" ]]; then
        echo "Error: Production deployment requires the following secrets:"
        echo "  $MISSING_SECRETS"
        echo ""
        echo "You can also set these via environment variables:"
        echo "  export TDR_BOT_DISCORD_TOKEN='your-discord-token'"
        echo "  export TDR_BOT_DISCORD_CLIENT_ID='your-client-id'"
        echo "  export TDR_BOT_OPENAI_API_KEY='your-openai-key'"
        echo "  export TDR_BOT_MINIO_ACCESS_KEY='your-minio-access-key'"
        echo "  export TDR_BOT_MINIO_SECRET_KEY='your-minio-secret-key'"
        echo ""
        echo "Or store them in 1password under the 'TDR Bot' item"
        exit 1
    fi
fi

# Allow environment variables as fallback for secrets
DISCORD_TOKEN="${DISCORD_TOKEN:-${TDR_BOT_DISCORD_TOKEN:-}}"
DISCORD_CLIENT_ID="${DISCORD_CLIENT_ID:-${TDR_BOT_DISCORD_CLIENT_ID:-}}"
DISCORD_GUILD_ID="${DISCORD_GUILD_ID:-${TDR_BOT_DISCORD_GUILD_ID:-}}"
OPENAI_API_KEY="${OPENAI_API_KEY:-${TDR_BOT_OPENAI_API_KEY:-}}"
TAVILY_API_KEY="${TAVILY_API_KEY:-${TDR_BOT_TAVILY_API_KEY:-}}"
HUGGINGFACE_TOKEN="${HUGGINGFACE_TOKEN:-${TDR_BOT_HUGGINGFACE_TOKEN:-}}"
SERP_API_KEY="${SERP_API_KEY:-${TDR_BOT_SERP_API_KEY:-}}"
OMBI_API_KEY="${OMBI_API_KEY:-${TDR_BOT_OMBI_API_KEY:-}}"
EQUATIONS_API_KEY="${EQUATIONS_API_KEY:-${TDR_BOT_EQUATIONS_API_KEY:-}}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-${TDR_BOT_MINIO_ACCESS_KEY:-}}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-${TDR_BOT_MINIO_SECRET_KEY:-}}"

# Set values file based on environment
VALUES_FILE="values-${ENVIRONMENT}.yaml"

echo "Deploying tdr-bot Helm chart..."
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
if [[ -n "$DISCORD_TOKEN" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.DISCORD_API_TOKEN='$DISCORD_TOKEN'"
fi
if [[ -n "$DISCORD_CLIENT_ID" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.DISCORD_CLIENT_ID='$DISCORD_CLIENT_ID'"
fi
if [[ -n "$DISCORD_GUILD_ID" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.DISCORD_DEV_GUILD_ID='$DISCORD_GUILD_ID'"
fi
if [[ -n "$OPENAI_API_KEY" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.OPENAI_API_KEY='$OPENAI_API_KEY'"
fi
if [[ -n "$TAVILY_API_KEY" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.TAVILY_API_KEY='$TAVILY_API_KEY'"
fi
if [[ -n "$HUGGINGFACE_TOKEN" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.HUGGING_FACE_TOKEN='$HUGGINGFACE_TOKEN'"
fi
if [[ -n "$SERP_API_KEY" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.SERP_API_KEY='$SERP_API_KEY'"
fi
if [[ -n "$OMBI_API_KEY" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.OMBI_API_KEY='$OMBI_API_KEY'"
fi
if [[ -n "$EQUATIONS_API_KEY" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.EQUATIONS_API_KEY='$EQUATIONS_API_KEY'"
fi
if [[ -n "$MINIO_ACCESS_KEY" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.MINIO_ACCESS_KEY='$MINIO_ACCESS_KEY'"
fi
if [[ -n "$MINIO_SECRET_KEY" ]]; then
    HELM_VALUES_ARGS="$HELM_VALUES_ARGS --set secrets.MINIO_SECRET_KEY='$MINIO_SECRET_KEY'"
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
    echo "Deployment complete! Verifying tdr-bot service components..."
    echo ""
    
    echo "=== Deployment Status ==="
    kubectl get deployment -n "$NAMESPACE" -l app.kubernetes.io/name=tdr-bot
    echo ""
    
    echo "=== Service Status ==="
    kubectl get service -n "$NAMESPACE" -l app.kubernetes.io/name=tdr-bot
    echo ""
    
    echo "=== Ingress Status ==="
    kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=tdr-bot
    echo ""
    
    echo "=== Pod Status ==="
    kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=tdr-bot
    echo ""
    
    echo "=== Secret Status ==="
    kubectl get secret -n "$NAMESPACE" -l app.kubernetes.io/name=tdr-bot
    echo ""
    
    # Get the ingress host for helpful information
    INGRESS_HOST=$(kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name=tdr-bot -o jsonpath='{.items[0].spec.rules[0].host}' 2>/dev/null || echo "N/A")
    
    echo "=== TDR Bot Information ==="
    echo "Admin Interface: https://${INGRESS_HOST}"
    echo "Health Check: https://${INGRESS_HOST}/health"
    echo ""
    echo "Features:"
    echo "• Discord bot with AI-powered conversation"
    echo "• OpenAI integration for natural language processing"
    echo "• LangChain workflows for complex tasks"
    echo "• Tavily search integration"
    echo "• Media request integration with Ombi"
    echo "• LaTeX equation rendering via equations service"
    echo "• MinIO integration for file storage"
    echo "• Web-based admin interface"
    echo ""
    echo "To view bot logs:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=tdr-bot -f"
    echo ""
    echo "To check bot health:"
    echo "  kubectl exec -n $NAMESPACE deployment/$RELEASE_NAME -- curl http://localhost:8080/health"
    echo ""
    echo "To verify Discord connection:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=tdr-bot | grep -i discord"
    echo ""
    echo "To check AI processing:"
    echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=tdr-bot | grep -i openai"
    echo ""
    echo "Security notes:"
    echo "• The bot runs with restricted permissions and read-only root filesystem"
    echo "• All secrets are stored in Kubernetes secrets"
    echo "• Network policies can be enabled for additional security"
    echo "• Docker socket access is disabled by default for security"
fi