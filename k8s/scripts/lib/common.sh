#!/usr/bin/env bash
#
# Common functions library for Kubernetes management scripts
# Source this file in other scripts: source "${SCRIPT_DIR}/../lib/common.sh"
#

# Color codes for output
declare -r COLOR_RED='\033[0;31m'
declare -r COLOR_GREEN='\033[0;32m'
declare -r COLOR_YELLOW='\033[1;33m'
declare -r COLOR_BLUE='\033[0;34m'
declare -r COLOR_CYAN='\033[0;36m'
declare -r COLOR_RESET='\033[0m'

# Script metadata
declare -r SCRIPT_VERSION="1.0.0"
declare -r SCRIPT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Global variables
VERBOSE=${VERBOSE:-false}
DRY_RUN=${DRY_RUN:-false}
FORCE=${FORCE:-false}

# -----------------------------------------------------------------------------
# Logging Functions
# -----------------------------------------------------------------------------

# Print info message
info() {
    echo -e "${COLOR_BLUE}[INFO]${COLOR_RESET} $*" >&2
}

# Print success message
success() {
    echo -e "${COLOR_GREEN}[SUCCESS]${COLOR_RESET} $*" >&2
}

# Print warning message
warn() {
    echo -e "${COLOR_YELLOW}[WARN]${COLOR_RESET} $*" >&2
}

# Print error message
error() {
    echo -e "${COLOR_RED}[ERROR]${COLOR_RESET} $*" >&2
}

# Print debug message (only if VERBOSE is true)
debug() {
    if [[ "${VERBOSE}" == "true" ]]; then
        echo -e "${COLOR_CYAN}[DEBUG]${COLOR_RESET} $*" >&2
    fi
}

# Print a message and exit with error
die() {
    error "$@"
    exit 1
}

# -----------------------------------------------------------------------------
# Validation Functions
# -----------------------------------------------------------------------------

# Check if a command exists
check_command() {
    local cmd="$1"
    if ! command -v "$cmd" &> /dev/null; then
        die "Required command '$cmd' not found. Please install it and try again."
    fi
    debug "Found command: $cmd"
}

# Validate kubectl is available and configured
check_kubectl() {
    check_command kubectl
    
    # Check if kubectl can connect to cluster
    if ! kubectl cluster-info &> /dev/null; then
        die "kubectl cannot connect to Kubernetes cluster. Please check your kubeconfig."
    fi
    
    local context
    context=$(kubectl config current-context)
    info "Using Kubernetes context: ${context}"
}

# Check if a namespace exists
check_namespace() {
    local namespace="$1"
    if ! kubectl get namespace "$namespace" &> /dev/null; then
        die "Namespace '$namespace' does not exist"
    fi
    debug "Namespace '$namespace' exists"
}

# Check if a resource exists
resource_exists() {
    local resource_type="$1"
    local resource_name="$2"
    local namespace="${3:-}"
    
    local cmd="kubectl get $resource_type $resource_name"
    if [[ -n "$namespace" ]]; then
        cmd="$cmd -n $namespace"
    fi
    
    if $cmd &> /dev/null; then
        return 0
    else
        return 1
    fi
}

# -----------------------------------------------------------------------------
# User Interaction Functions
# -----------------------------------------------------------------------------

# Ask for confirmation
confirm() {
    local prompt="${1:-Are you sure?}"
    local default="${2:-n}"
    
    if [[ "${FORCE}" == "true" ]]; then
        debug "Force mode enabled, skipping confirmation"
        return 0
    fi
    
    local answer
    if [[ "$default" == "y" ]]; then
        read -r -p "$prompt [Y/n] " answer
        answer=${answer:-y}
    else
        read -r -p "$prompt [y/N] " answer
        answer=${answer:-n}
    fi
    
    [[ "$answer" =~ ^[Yy]$ ]]
}

# Read a value with a default
read_value() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"
    
    local value
    if [[ -n "$default" ]]; then
        read -r -p "$prompt [$default]: " value
        value=${value:-$default}
    else
        read -r -p "$prompt: " value
    fi
    
    eval "$var_name='$value'"
}

# Read a secret value (no echo)
read_secret() {
    local prompt="$1"
    local var_name="$2"
    
    local value
    read -r -s -p "$prompt: " value
    echo "" # New line after password input
    
    eval "$var_name='$value'"
}

# -----------------------------------------------------------------------------
# Kubernetes Operations
# -----------------------------------------------------------------------------

# Apply a manifest with dry-run support
kubectl_apply() {
    local file="$1"
    local namespace="${2:-}"
    
    local cmd="kubectl apply -f $file"
    if [[ -n "$namespace" ]]; then
        cmd="$cmd -n $namespace"
    fi
    
    if [[ "${DRY_RUN}" == "true" ]]; then
        info "[DRY-RUN] Would execute: $cmd"
        $cmd --dry-run=client
    else
        debug "Executing: $cmd"
        $cmd
    fi
}

# Delete a resource with dry-run support
kubectl_delete() {
    local resource_type="$1"
    local resource_name="$2"
    local namespace="${3:-}"
    
    local cmd="kubectl delete $resource_type $resource_name"
    if [[ -n "$namespace" ]]; then
        cmd="$cmd -n $namespace"
    fi
    
    if [[ "${DRY_RUN}" == "true" ]]; then
        info "[DRY-RUN] Would execute: $cmd"
    else
        debug "Executing: $cmd"
        $cmd
    fi
}

# Wait for a deployment to be ready
wait_for_deployment() {
    local deployment="$1"
    local namespace="$2"
    local timeout="${3:-300}"
    
    info "Waiting for deployment '$deployment' to be ready..."
    if kubectl wait --for=condition=available --timeout="${timeout}s" \
        deployment/"$deployment" -n "$namespace"; then
        success "Deployment '$deployment' is ready"
    else
        error "Deployment '$deployment' failed to become ready within ${timeout}s"
        return 1
    fi
}

# Get a secret value
get_secret_value() {
    local secret_name="$1"
    local key="$2"
    local namespace="${3:-default}"
    
    kubectl get secret "$secret_name" -n "$namespace" \
        -o jsonpath="{.data.$key}" 2>/dev/null | base64 -d
}

# Create a secret from literal values
create_secret() {
    local secret_name="$1"
    local namespace="$2"
    shift 2
    
    local cmd="kubectl create secret generic $secret_name -n $namespace"
    
    # Add literal values
    for arg in "$@"; do
        cmd="$cmd --from-literal=$arg"
    done
    
    if [[ "${DRY_RUN}" == "true" ]]; then
        info "[DRY-RUN] Would create secret '$secret_name' in namespace '$namespace'"
        $cmd --dry-run=client -o yaml
    else
        if resource_exists secret "$secret_name" "$namespace"; then
            warn "Secret '$secret_name' already exists in namespace '$namespace'"
            if confirm "Do you want to delete and recreate it?"; then
                kubectl_delete secret "$secret_name" "$namespace"
                $cmd
                success "Secret '$secret_name' recreated"
            else
                info "Skipping secret creation"
            fi
        else
            $cmd
            success "Secret '$secret_name' created"
        fi
    fi
}

# -----------------------------------------------------------------------------
# Utility Functions
# -----------------------------------------------------------------------------

# Generate a random string
generate_random_string() {
    local length="${1:-32}"
    openssl rand -base64 "$length" | tr -d "=+/" | cut -c1-"$length"
}

# Get current timestamp
timestamp() {
    date +"%Y%m%d-%H%M%S"
}

# Create a backup of a resource
backup_resource() {
    local resource_type="$1"
    local resource_name="$2"
    local namespace="${3:-}"
    local backup_dir="${4:-./backups}"
    
    mkdir -p "$backup_dir"
    
    local backup_file="$backup_dir/${resource_type}-${resource_name}-$(timestamp).yaml"
    local cmd="kubectl get $resource_type $resource_name -o yaml"
    
    if [[ -n "$namespace" ]]; then
        cmd="$cmd -n $namespace"
    fi
    
    if $cmd > "$backup_file"; then
        success "Backed up $resource_type/$resource_name to $backup_file"
    else
        error "Failed to backup $resource_type/$resource_name"
        return 1
    fi
}

# Cleanup function to be used with trap
cleanup() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        error "Script failed with exit code: $exit_code"
    fi
    # Add any cleanup tasks here
    exit $exit_code
}

# -----------------------------------------------------------------------------
# Argument Parsing Helpers
# -----------------------------------------------------------------------------

# Parse common flags
parse_common_flags() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--verbose)
                VERBOSE=true
                debug "Verbose mode enabled"
                shift
                ;;
            -d|--dry-run)
                DRY_RUN=true
                info "Dry-run mode enabled"
                shift
                ;;
            -f|--force)
                FORCE=true
                warn "Force mode enabled - confirmations will be skipped"
                shift
                ;;
            -h|--help)
                return 1
                ;;
            *)
                # Unknown option, let the calling script handle it
                break
                ;;
        esac
    done
    
    # Return remaining arguments
    echo "$@"
}

# Show common flags in help text
show_common_flags_help() {
    cat << EOF
Common Options:
  -v, --verbose     Enable verbose output
  -d, --dry-run     Show what would be done without making changes
  -f, --force       Skip confirmation prompts
  -h, --help        Show this help message
EOF
}

# -----------------------------------------------------------------------------
# Environment Detection
# -----------------------------------------------------------------------------

# Detect the environment based on context or namespace
detect_environment() {
    local context
    context=$(kubectl config current-context)
    
    case "$context" in
        *prod*|*production*)
            echo "prod"
            ;;
        *stage*|*staging*)
            echo "staging"
            ;;
        *dev*|*development*|*local*)
            echo "dev"
            ;;
        *)
            echo "unknown"
            ;;
    esac
}

# Get the appropriate values file for an environment
get_values_file() {
    local base_dir="$1"
    local environment="$2"
    
    case "$environment" in
        prod|production)
            echo "$base_dir/values-prod.yaml"
            ;;
        dev|development)
            echo "$base_dir/values-dev.yaml"
            ;;
        *)
            echo "$base_dir/values.yaml"
            ;;
    esac
}

# -----------------------------------------------------------------------------
# Initialization
# -----------------------------------------------------------------------------

# Set up error handling
set -euo pipefail
trap cleanup EXIT

# Export functions for use in subshells
export -f info success warn error debug die
export -f check_command check_kubectl check_namespace resource_exists
export -f confirm read_value read_secret
export -f kubectl_apply kubectl_delete wait_for_deployment
export -f get_secret_value create_secret
export -f generate_random_string timestamp backup_resource
export -f parse_common_flags show_common_flags_help
export -f detect_environment get_values_file

# Initialize
debug "Common library loaded from: ${SCRIPT_LIB_DIR}"
debug "Script version: ${SCRIPT_VERSION}"