#!/usr/bin/env bash
#
# Deploy Turbo Cache to Kubernetes
#
# Usage: deploy.sh [options]
#
# Options:
#   -h, --help        Show this help message
#   -v, --verbose     Enable verbose output
#   -d, --dry-run     Show what would be done without executing
#   -e, --env <env>   Environment to deploy (dev/prod, default: prod)
#

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(dirname "$SCRIPT_DIR")"

# Source common functions
source "${SCRIPT_DIR}/../../scripts/lib/common.sh"

# Default values
ENVIRONMENT="prod"

# Show usage
show_usage() {
    cat << EOF
Usage: $(basename "$0") [options]

Deploy Turbo Cache to Kubernetes.

Options:
  -h, --help        Show this help message
  -v, --verbose     Enable verbose output
  -d, --dry-run     Show what would be done without executing
  -e, --env <env>   Environment to deploy (dev/prod, default: prod)

Examples:
  # Deploy to production
  $(basename "$0")
  
  # Deploy to development
  $(basename "$0") --env dev
  
  # Dry-run deployment
  $(basename "$0") --dry-run

EOF
    show_common_flags_help
}

# Parse arguments
parse_args() {
    local remaining_args
    remaining_args=$(parse_common_flags "$@") || { show_usage; exit 0; }
    set -- $remaining_args
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            -e|--env)
                ENVIRONMENT="$2"
                shift 2
                ;;
            *)
                error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # Validate environment
    if [[ ! "$ENVIRONMENT" =~ ^(dev|prod)$ ]]; then
        die "Invalid environment: $ENVIRONMENT. Must be 'dev' or 'prod'"
    fi
}

# Check prerequisites
check_prerequisites() {
    check_kubectl
    
    # Determine namespace based on environment
    local namespace
    if [[ "$ENVIRONMENT" == "dev" ]]; then
        namespace="lilnas-dev"
    else
        namespace="lilnas-core"
    fi
    
    # Check if namespace exists
    check_namespace "$namespace"
    
    # Check if secret exists
    if ! resource_exists secret turbo-cache-secrets "$namespace"; then
        die "Secret 'turbo-cache-secrets' not found in namespace '$namespace'\nPlease create the secret first using the setup.sh script:\n  ./scripts/setup.sh --turbo-token <token> --aws-access-key <key> --aws-secret-key <secret>"
    fi
    
    debug "All prerequisites met"
}

# Deploy the service
deploy_service() {
    local overlay_dir="${SERVICE_DIR}/overlays"
    local kustomize_file
    if [[ "$ENVIRONMENT" == "dev" ]]; then
        kustomize_file="kustomization.dev.yaml"
    else
        kustomize_file="kustomization.prod.yaml"
    fi
    
    info "Deploying Turbo Cache to $ENVIRONMENT environment..."
    
    # Apply the manifests by temporarily copying the kustomization file
    cd "$overlay_dir"
    cp "$kustomize_file" kustomization.yaml
    
    if [[ "${DRY_RUN}" == "true" ]]; then
        info "[DRY-RUN] Would deploy from: $overlay_dir/$kustomize_file"
        kubectl apply -k . --dry-run=client
        rm kustomization.yaml
    else
        kubectl apply -k .
        rm kustomization.yaml
        
        # Determine namespace
        local namespace
        if [[ "$ENVIRONMENT" == "dev" ]]; then
            namespace="lilnas-dev"
        else
            namespace="lilnas-core"
        fi
        
        # Wait for deployment to be ready
        wait_for_deployment turbo-cache "$namespace" 300
        
        # Get the URL
        local url
        if [[ "$ENVIRONMENT" == "dev" ]]; then
            url="https://turbo.dev.lilnas.io"
        else
            url="https://turbo.lilnas.io"
        fi
        
        success "Turbo Cache deployed successfully!"
        info "Access at: $url"
    fi
}

# Main execution
main() {
    parse_args "$@"
    check_prerequisites
    deploy_service
}

# Run main function
main "$@"