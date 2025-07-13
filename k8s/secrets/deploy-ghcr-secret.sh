#!/usr/bin/env bash
#
# Deploy GHCR secret to all namespaces
# This script creates GitHub Container Registry secrets for pulling private images
#
# Usage: deploy-ghcr-secret.sh [options]
#
# Options:
#   -h, --help        Show this help message
#   -v, --verbose     Enable verbose output
#   -d, --dry-run     Show what would be done without executing
#   -f, --force       Skip confirmation prompts
#
# Environment Variables:
#   GITHUB_TOKEN      GitHub Personal Access Token (required)
#   GITHUB_USERNAME   GitHub username (default: codemonkey800)
#   GITHUB_EMAIL      GitHub email (default: jeremyasuncion808@gmail.com)
#

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_FILE="$SCRIPT_DIR/ghcr-secret-template.yaml"

# Source common functions
source "${SCRIPT_DIR}/../scripts/lib/common.sh"

# Default values
GITHUB_USERNAME="${GITHUB_USERNAME:-codemonkey800}"
GITHUB_EMAIL="${GITHUB_EMAIL:-jeremyasuncion808@gmail.com}"

# Namespaces to deploy to
NAMESPACES=("default" "lilnas-apps" "lilnas-core" "lilnas-dev" "lilnas-media" "lilnas-monitoring")

# Show usage
show_usage() {
    cat << EOF
Usage: $(basename "$0") [options]

Deploy GHCR (GitHub Container Registry) secrets to all namespaces for pulling
private container images.

Options:
  -h, --help        Show this help message
  -v, --verbose     Enable verbose output
  -d, --dry-run     Show what would be done without executing
  -f, --force       Skip confirmation prompts

Environment Variables:
  GITHUB_TOKEN      GitHub Personal Access Token (required)
  GITHUB_USERNAME   GitHub username (default: $GITHUB_USERNAME)
  GITHUB_EMAIL      GitHub email (default: $GITHUB_EMAIL)

Examples:
  # Deploy secrets to all namespaces
  export GITHUB_TOKEN=ghp_your_token_here
  $(basename "$0")
  
  # Deploy with dry-run to see what would be done
  GITHUB_TOKEN=ghp_your_token_here $(basename "$0") --dry-run
  
  # Deploy with verbose output
  GITHUB_TOKEN=ghp_your_token_here $(basename "$0") -v

EOF
    show_common_flags_help
}

# Parse arguments
parse_args() {
    local remaining_args
    remaining_args=$(parse_common_flags "$@") || { show_usage; exit 0; }
    set -- $remaining_args
    
    if [[ $# -gt 0 ]]; then
        error "Unknown arguments: $*"
        show_usage
        exit 1
    fi
}

echo -e "${COLOR_GREEN}🔐 GHCR Secret Deployment Script${COLOR_RESET}"
echo "================================="

# Check prerequisites
check_prerequisites() {
    check_kubectl
    check_command envsubst
    
    # Check if GitHub token is provided
    if [ -z "${GITHUB_TOKEN:-}" ]; then
        die "GITHUB_TOKEN environment variable is not set\nPlease set your GitHub Personal Access Token:\nexport GITHUB_TOKEN=ghp_your_token_here"
    fi
    
    # Check if template file exists
    if [ ! -f "$TEMPLATE_FILE" ]; then
        die "Template file not found: $TEMPLATE_FILE"
    fi
}

# Validate GitHub token format
validate_token() {
    if [[ ! "$GITHUB_TOKEN" =~ ^ghp_[a-zA-Z0-9]{36}$ ]]; then
        warn "GitHub token format seems invalid"
        info "Expected format: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        if ! confirm "Continue anyway?"; then
            exit 1
        fi
    fi
}

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
deploy_secrets() {
    local docker_config_json="$1"
    
    for namespace in "${NAMESPACES[@]}"; do
        info "\n🚀 Deploying to namespace: $namespace"
        
        # Check if namespace exists
        if ! check_namespace "$namespace" 2>/dev/null; then
            warn "Namespace $namespace does not exist"
            if [[ "${DRY_RUN}" == "true" ]]; then
                info "[DRY-RUN] Would create namespace: $namespace"
            else
                info "Creating namespace: $namespace"
                kubectl create namespace "$namespace"
            fi
        fi
        
        # Deploy the secret
        export NAMESPACE="$namespace"
        export DOCKER_CONFIG_JSON="$docker_config_json"
        
        if [[ "${DRY_RUN}" == "true" ]]; then
            info "[DRY-RUN] Would deploy secret to $namespace"
            envsubst < "$TEMPLATE_FILE" | kubectl apply --dry-run=client -f -
        else
            if envsubst < "$TEMPLATE_FILE" | kubectl apply -f -; then
                success "Secret deployed successfully to $namespace"
            else
                die "Failed to deploy secret to $namespace"
            fi
            
            # Verify the secret was created
            if resource_exists secret ghcr-secret "$namespace"; then
                success "Secret verified in $namespace"
            else
                die "Secret verification failed in $namespace"
            fi
        fi
    done
}

# Main execution
main() {
    parse_args "$@"
    
    check_prerequisites
    validate_token
    
    # Generate Docker config JSON
    info "📦 Generating Docker config JSON..."
    DOCKER_CONFIG_JSON=$(create_docker_config)
    debug "Docker config JSON generated successfully"
    
    # Deploy to all namespaces
    deploy_secrets "$DOCKER_CONFIG_JSON"
    
    if [[ "${DRY_RUN}" != "true" ]]; then
        echo
        success "🎉 All secrets deployed successfully!"
        echo
        info "To verify all secrets:"
        echo "  kubectl get secrets --all-namespaces | grep ghcr-secret"
        echo
        info "To test pulling an image:"
        echo "  kubectl run test-pull --image=ghcr.io/$GITHUB_USERNAME/test-image:latest --restart=Never"
    fi
}

# Run main function
main "$@"