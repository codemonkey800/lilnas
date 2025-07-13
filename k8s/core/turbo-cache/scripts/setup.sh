#!/usr/bin/env bash
#
# Setup Turbo Cache secrets for Kubernetes
# Creates the necessary secrets for Turbo Cache to connect to MinIO/S3
#
# Usage: setup.sh [options]
#
# Required Options:
#   --turbo-token <token>    The Turbo token for authentication
#   --aws-access-key <key>   AWS access key ID for MinIO/S3
#   --aws-secret-key <secret> AWS secret access key for MinIO/S3
#
# Optional Options:
#   -h, --help        Show this help message
#   -v, --verbose     Enable verbose output
#   -d, --dry-run     Show what would be done without executing (default)
#   -f, --force       Skip confirmation prompts
#   --create          Actually create the secret (deprecated, use without --dry-run)
#

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common functions
source "${SCRIPT_DIR}/../../scripts/lib/common.sh"

# Default to dry-run mode for safety
DRY_RUN=${DRY_RUN:-true}

# Show usage
show_usage() {
    cat << EOF
Usage: $(basename "$0") [options]

Setup Turbo Cache secrets for Kubernetes. Creates the necessary secrets for
Turbo Cache to connect to MinIO/S3 storage.

Required Options:
  --turbo-token <token>     The Turbo token for authentication
  --aws-access-key <key>    AWS access key ID for MinIO/S3
  --aws-secret-key <secret> AWS secret access key for MinIO/S3

Optional Options:
  -h, --help        Show this help message
  -v, --verbose     Enable verbose output
  -d, --dry-run     Show what would be done without executing (default)
  -f, --force       Skip confirmation prompts
  --create          Actually create the secret (deprecated, use without --dry-run)

Examples:
  # Dry-run to see what would be created
  $(basename "$0") --turbo-token tk_xxx --aws-access-key KEY --aws-secret-key SECRET
  
  # Actually create the secret
  $(basename "$0") --turbo-token tk_xxx --aws-access-key KEY --aws-secret-key SECRET --create
  
  # Create with confirmation
  $(basename "$0") --turbo-token tk_xxx --aws-access-key KEY --aws-secret-key SECRET -d=false

EOF
    show_common_flags_help
}

# Variables
TURBO_TOKEN=""
AWS_ACCESS_KEY_ID=""
AWS_SECRET_ACCESS_KEY=""
NAMESPACE="lilnas-core"
SECRET_NAME="turbo-cache-secrets"

# Parse arguments
parse_args() {
    # First parse common flags
    local remaining_args
    remaining_args=$(parse_common_flags "$@") || { show_usage; exit 0; }
    set -- $remaining_args
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --turbo-token)
                TURBO_TOKEN="$2"
                shift 2
                ;;
            --aws-access-key)
                AWS_ACCESS_KEY_ID="$2"
                shift 2
                ;;
            --aws-secret-key)
                AWS_SECRET_ACCESS_KEY="$2"
                shift 2
                ;;
            --create)
                # Deprecated flag, but still support it
                DRY_RUN=false
                warn "--create flag is deprecated. Use without --dry-run instead."
                shift
                ;;
            *)
                error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
}

# Validate arguments
validate_args() {
    local errors=()
    
    if [ -z "$TURBO_TOKEN" ]; then
        errors+=("Missing required argument: --turbo-token")
    fi
    
    if [ -z "$AWS_ACCESS_KEY_ID" ]; then
        errors+=("Missing required argument: --aws-access-key")
    fi
    
    if [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
        errors+=("Missing required argument: --aws-secret-key")
    fi
    
    if [ ${#errors[@]} -gt 0 ]; then
        error "Validation failed:"
        for err in "${errors[@]}"; do
            error "  - $err"
        done
        echo
        show_usage
        exit 1
    fi
    
    debug "All required arguments provided"
}

# Create the secret
create_turbo_cache_secret() {
    info "Setting up Turbo Cache secrets..."
    
    # Check if namespace exists
    check_namespace "$NAMESPACE" || {
        if [[ "${DRY_RUN}" == "true" ]]; then
            info "[DRY-RUN] Would create namespace: $NAMESPACE"
        else
            info "Creating namespace: $NAMESPACE"
            kubectl create namespace "$NAMESPACE"
        fi
    }
    
    # Check if secret already exists
    if resource_exists secret "$SECRET_NAME" "$NAMESPACE"; then
        warn "Secret '$SECRET_NAME' already exists in namespace '$NAMESPACE'"
        if [[ "${DRY_RUN}" != "true" ]] && ! confirm "Do you want to delete and recreate it?"; then
            info "Skipping secret creation"
            return 0
        fi
        
        if [[ "${DRY_RUN}" == "true" ]]; then
            info "[DRY-RUN] Would delete existing secret"
        else
            kubectl_delete secret "$SECRET_NAME" "$NAMESPACE"
        fi
    fi
    
    # Create the secret
    create_secret "$SECRET_NAME" "$NAMESPACE" \
        "TURBO_TOKEN=$TURBO_TOKEN" \
        "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID" \
        "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY"
    
    if [[ "${DRY_RUN}" != "true" ]]; then
        echo
        success "Turbo Cache secret setup completed!"
        echo
        info "To verify the secret:"
        echo "  kubectl get secret $SECRET_NAME -n $NAMESPACE"
        echo
        info "To view secret keys (not values):"
        echo "  kubectl get secret $SECRET_NAME -n $NAMESPACE -o jsonpath='{.data}' | jq 'keys'"
    fi
}

# Main execution
main() {
    parse_args "$@"
    validate_args
    check_kubectl
    
    create_turbo_cache_secret
}

# Run main function
main "$@"