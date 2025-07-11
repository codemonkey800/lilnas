#!/bin/bash
# Deploy GHCR secret to all namespaces
# This script creates GitHub Container Registry secrets for pulling private images

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
GITHUB_USERNAME="codemonkey800"
GITHUB_EMAIL="jeremyasuncion808@gmail.com"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_FILE="$SCRIPT_DIR/ghcr-secret-template.yaml"

# Namespaces to deploy to
NAMESPACES=("default" "lilnas-apps" "lilnas-core" "lilnas-dev" "lilnas-media" "lilnas-monitoring")

echo -e "${GREEN}🔐 GHCR Secret Deployment Script${NC}"
echo "================================="

# Check if GitHub token is provided
if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${RED}❌ Error: GITHUB_TOKEN environment variable is not set${NC}"
    echo "Please set your GitHub Personal Access Token:"
    echo "export GITHUB_TOKEN=ghp_your_token_here"
    exit 1
fi

# Validate GitHub token format
if [[ ! "$GITHUB_TOKEN" =~ ^ghp_[a-zA-Z0-9]{36}$ ]]; then
    echo -e "${YELLOW}⚠️  Warning: GitHub token format seems invalid${NC}"
    echo "Expected format: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if template file exists
if [ ! -f "$TEMPLATE_FILE" ]; then
    echo -e "${RED}❌ Error: Template file not found: $TEMPLATE_FILE${NC}"
    exit 1
fi

# Create Docker config JSON
create_docker_config() {
    local auth_string=$(echo -n "$GITHUB_USERNAME:$GITHUB_TOKEN" | base64 -w 0)
    local docker_config=$(cat <<EOF
{
  "auths": {
    "https://ghcr.io": {
      "username": "$GITHUB_USERNAME",
      "password": "$GITHUB_TOKEN",
      "email": "$GITHUB_EMAIL",
      "auth": "$auth_string"
    }
  }
}
EOF
)
    echo -n "$docker_config" | base64 -w 0
}

# Generate Docker config JSON
echo "📦 Generating Docker config JSON..."
DOCKER_CONFIG_JSON=$(create_docker_config)

# Deploy to each namespace
for namespace in "${NAMESPACES[@]}"; do
    echo -e "\n🚀 Deploying to namespace: ${GREEN}$namespace${NC}"
    
    # Check if namespace exists
    if ! kubectl get namespace "$namespace" &> /dev/null; then
        echo -e "${YELLOW}⚠️  Namespace $namespace does not exist, creating...${NC}"
        kubectl create namespace "$namespace"
    fi
    
    # Deploy the secret
    export NAMESPACE="$namespace"
    export DOCKER_CONFIG_JSON="$DOCKER_CONFIG_JSON"
    
    if envsubst < "$TEMPLATE_FILE" | kubectl apply -f -; then
        echo -e "${GREEN}✅ Secret deployed successfully to $namespace${NC}"
    else
        echo -e "${RED}❌ Failed to deploy secret to $namespace${NC}"
        exit 1
    fi
    
    # Verify the secret was created
    if kubectl get secret ghcr-secret -n "$namespace" &> /dev/null; then
        echo -e "${GREEN}✅ Secret verified in $namespace${NC}"
    else
        echo -e "${RED}❌ Secret verification failed in $namespace${NC}"
        exit 1
    fi
done

echo -e "\n${GREEN}🎉 All secrets deployed successfully!${NC}"
echo
echo "To verify all secrets:"
echo "kubectl get secrets --all-namespaces | grep ghcr-secret"
echo
echo "To test pulling an image:"
echo "kubectl run test-pull --image=ghcr.io/codemonkey800/test-image:latest --restart=Never"