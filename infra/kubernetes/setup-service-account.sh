#!/bin/bash

# GitHub Actions Kubernetes Service Account Setup Script
# This script helps set up the service account and extract the necessary information
# for configuring GitHub secrets.

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SERVICE_ACCOUNT_NAME="github-actions"
NAMESPACE="default"
TOKEN_DURATION="8760h"  # 1 year

echo -e "${BLUE}🔧 GitHub Actions Kubernetes Service Account Setup${NC}"
echo "================================================="
echo

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}❌ kubectl not found. Please install kubectl first.${NC}"
    exit 1
fi

# Check if we can connect to the cluster
if ! kubectl cluster-info &> /dev/null; then
    echo -e "${RED}❌ Unable to connect to Kubernetes cluster.${NC}"
    echo "Please ensure kubectl is configured and you have cluster access."
    exit 1
fi

echo -e "${GREEN}✅ kubectl is available and connected to cluster${NC}"
echo

# Function to apply RBAC manifests
apply_rbac() {
    echo -e "${BLUE}📋 Applying RBAC manifests...${NC}"
    
    # Check if the script is run from the correct directory
    if [[ ! -f "github-actions-rbac.yml" ]]; then
        echo -e "${RED}❌ github-actions-rbac.yml not found in current directory.${NC}"
        echo "Please run this script from the infra/kubernetes directory."
        exit 1
    fi
    
    kubectl apply -f github-actions-rbac.yml
    
    echo -e "${GREEN}✅ RBAC manifests applied successfully${NC}"
    echo
}

# Function to generate service account token
generate_token() {
    echo -e "${BLUE}🔑 Generating service account token...${NC}"
    
    # Wait for service account to be ready
    echo "Waiting for service account to be ready..."
    kubectl wait --for=condition=ready serviceaccount/$SERVICE_ACCOUNT_NAME -n $NAMESPACE --timeout=60s
    
    # Generate token
    TOKEN=$(kubectl create token $SERVICE_ACCOUNT_NAME --duration=$TOKEN_DURATION --namespace=$NAMESPACE)
    
    if [[ -z "$TOKEN" ]]; then
        echo -e "${RED}❌ Failed to generate token${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Token generated successfully${NC}"
    echo
    
    return 0
}

# Function to extract cluster information
extract_cluster_info() {
    echo -e "${BLUE}🔍 Extracting cluster information...${NC}"
    
    # Get current context
    CURRENT_CONTEXT=$(kubectl config current-context)
    echo "Current context: $CURRENT_CONTEXT"
    
    # Get server URL
    SERVER=$(kubectl config view --raw --minify --flatten -o jsonpath='{.clusters[0].cluster.server}')
    
    # Get CA certificate
    CA_CERT=$(kubectl config view --raw --minify --flatten -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')
    
    echo -e "${GREEN}✅ Cluster information extracted${NC}"
    echo
    
    return 0
}

# Function to display GitHub secrets
display_secrets() {
    echo -e "${YELLOW}📝 GitHub Secrets Configuration${NC}"
    echo "=================================="
    echo
    echo "Add these secrets to your GitHub repository:"
    echo "Settings > Secrets and variables > Actions"
    echo
    
    echo -e "${BLUE}Secret Name:${NC} KUBE_TOKEN"
    echo -e "${BLUE}Value:${NC}"
    echo "$TOKEN"
    echo
    
    echo -e "${BLUE}Secret Name:${NC} KUBE_SERVER"
    echo -e "${BLUE}Value:${NC}"
    echo "$SERVER"
    echo
    
    echo -e "${BLUE}Secret Name:${NC} KUBE_CA_CERT"
    echo -e "${BLUE}Value:${NC}"
    echo "$CA_CERT"
    echo
    
    echo -e "${BLUE}Secret Name:${NC} KUBE_NAMESPACE (optional)"
    echo -e "${BLUE}Value:${NC}"
    echo "$NAMESPACE"
    echo
}

# Function to verify permissions
verify_permissions() {
    echo -e "${BLUE}🔐 Verifying service account permissions...${NC}"
    
    # Test some common permissions
    PERMISSIONS_TO_TEST=(
        "get pods"
        "list pods"
        "get deployments"
        "list deployments"
        "get services"
        "list services"
    )
    
    for perm in "${PERMISSIONS_TO_TEST[@]}"; do
        if kubectl auth can-i $perm --as=system:serviceaccount:$NAMESPACE:$SERVICE_ACCOUNT_NAME &> /dev/null; then
            echo -e "${GREEN}✅ Can $perm${NC}"
        else
            echo -e "${RED}❌ Cannot $perm${NC}"
        fi
    done
    
    echo
}

# Function to test token
test_token() {
    echo -e "${BLUE}🧪 Testing generated token...${NC}"
    
    # Test the token by trying to get pods
    if kubectl --token="$TOKEN" --server="$SERVER" --certificate-authority=<(echo "$CA_CERT" | base64 -d) get pods &> /dev/null; then
        echo -e "${GREEN}✅ Token test successful${NC}"
    else
        echo -e "${YELLOW}⚠️  Token test failed - this might be normal if no pods exist${NC}"
    fi
    
    echo
}

# Main execution
main() {
    echo "This script will:"
    echo "1. Apply RBAC manifests"
    echo "2. Generate a service account token"
    echo "3. Extract cluster information"
    echo "4. Display GitHub secrets configuration"
    echo "5. Verify permissions"
    echo
    
    read -p "Continue? (y/N): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
    
    # Execute steps
    apply_rbac
    generate_token
    extract_cluster_info
    display_secrets
    verify_permissions
    test_token
    
    echo -e "${GREEN}🎉 Setup complete!${NC}"
    echo
    echo "Next steps:"
    echo "1. Copy the secrets above to your GitHub repository"
    echo "2. Test the integration by mentioning @claude in an issue or PR"
    echo "3. Check the GitHub Actions workflow logs for kubectl commands"
    echo
    echo "For extended permissions (write access), run:"
    echo "kubectl apply -f github-actions-rbac-extended.yml"
    echo
}

# Script options
case "${1:-}" in
    --help|-h)
        echo "GitHub Actions Kubernetes Service Account Setup Script"
        echo
        echo "Usage: $0 [OPTIONS]"
        echo
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  --token-only   Only generate and display a new token"
        echo "  --verify       Only verify current permissions"
        echo
        exit 0
        ;;
    --token-only)
        generate_token
        echo -e "${BLUE}New Token:${NC}"
        echo "$TOKEN"
        echo
        echo "Update the KUBE_TOKEN secret in your GitHub repository."
        ;;
    --verify)
        verify_permissions
        ;;
    *)
        main
        ;;
esac