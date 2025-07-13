#!/usr/bin/env bash
#
# Clean up Turbo Cache deployment
#
# Usage: cleanup.sh [options]
#
# Options:
#   -h, --help            Show this help message
#   -v, --verbose         Enable verbose output
#   -d, --dry-run         Show what would be done without executing
#   -e, --env <env>       Environment to clean up (dev/prod, default: prod)
#   --delete-secrets      Also delete secrets (default: false)
#

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(dirname "$SCRIPT_DIR")"

# Source common functions
source "${SCRIPT_DIR}/../../scripts/lib/common.sh"

# Default values
ENVIRONMENT="prod"
DELETE_SECRETS=false

# Show usage
show_usage() {
    cat << EOF
Usage: $(basename "$0") [options]

Clean up Turbo Cache deployment from Kubernetes.

Options:
  -h, --help            Show this help message
  -v, --verbose         Enable verbose output
  -d, --dry-run         Show what would be done without executing
  -e, --env <env>       Environment to clean up (dev/prod, default: prod)
  --delete-secrets      Also delete secrets (default: false)

Examples:
  # Clean up production deployment (keep secrets)
  $(basename "$0")
  
  # Clean up development deployment
  $(basename "$0") --env dev
  
  # Clean up everything including secrets
  $(basename "$0") --delete-secrets
  
  # Dry-run to see what would be deleted
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
            --delete-secrets)
                DELETE_SECRETS=true
                shift
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

# Clean up deployment
cleanup_deployment() {
    local namespace
    local kustomize_dir
    
    if [[ "$ENVIRONMENT" == "dev" ]]; then
        namespace="lilnas-dev"
        kustomize_dir="${SERVICE_DIR}/overlays/dev"
    else
        namespace="lilnas-core"
        kustomize_dir="${SERVICE_DIR}/overlays/prod"
    fi
    
    info "Cleaning up Turbo Cache deployment from $ENVIRONMENT environment..."
    
    # Delete manifest resources
    if [[ "${DRY_RUN}" == "true" ]]; then
        info "[DRY-RUN] Would delete resources from: $kustomize_dir"
        kubectl delete -k "$kustomize_dir" --dry-run=client 2>/dev/null || true
    else
        info "Deleting deployment resources..."
        kubectl delete -k "$kustomize_dir" 2>/dev/null || {
            warn "Some resources may have already been deleted"
        }
    fi
    
    # Delete secret if requested
    if [[ "$DELETE_SECRETS" == "true" ]]; then
        if resource_exists secret turbo-cache-secrets "$namespace"; then
            if [[ "${DRY_RUN}" == "true" ]]; then
                info "[DRY-RUN] Would delete secret: turbo-cache-secrets"
            else
                info "Deleting secret..."
                kubectl_delete secret turbo-cache-secrets "$namespace"
            fi
        else
            debug "Secret turbo-cache-secrets not found in namespace $namespace"
        fi
    else
        info "Keeping secret (use --delete-secrets to remove)"
    fi
    
    if [[ "${DRY_RUN}" != "true" ]]; then
        success "Turbo Cache cleanup completed!"
    fi
}

# Main execution
main() {
    parse_args "$@"
    check_kubectl
    
    if ! confirm "Are you sure you want to clean up Turbo Cache from $ENVIRONMENT?"; then
        info "Cleanup cancelled"
        exit 0
    fi
    
    cleanup_deployment
}

# Run main function
main "$@"