#!/usr/bin/env bash
#
# Uninstall script for dashcam Helm chart
# Usage: ./uninstall.sh
#
# This script removes the dashcam deployment from the cluster
#

set -euo pipefail

# Configuration
RELEASE_NAME="dashcam"
NAMESPACE="lilnas-apps"
CHART_NAME="dashcam"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Validate prerequisites
validate_prerequisites() {
    log_info "Validating prerequisites..."
    
    if ! command_exists helm; then
        log_error "Helm is not installed. Please install Helm 3.x"
        exit 1
    fi
    
    if ! command_exists kubectl; then
        log_error "kubectl is not installed. Please install kubectl"
        exit 1
    fi
    
    # Check if kubectl can connect to cluster
    if ! kubectl cluster-info >/dev/null 2>&1; then
        log_error "Cannot connect to Kubernetes cluster. Please check your kubectl configuration"
        exit 1
    fi
    
    log_info "Prerequisites validated successfully"
}

# Check if release exists
check_release() {
    if ! helm status "$RELEASE_NAME" -n "$NAMESPACE" >/dev/null 2>&1; then
        log_warn "Release $RELEASE_NAME not found in namespace $NAMESPACE"
        echo "Available releases in namespace $NAMESPACE:"
        helm list -n "$NAMESPACE"
        exit 1
    fi
}

# Show current status
show_current_status() {
    log_info "Current release status:"
    helm status "$RELEASE_NAME" -n "$NAMESPACE"
    
    echo
    log_info "Current Kubernetes resources:"
    kubectl get all -n "$NAMESPACE" -l app.kubernetes.io/name="$CHART_NAME"
}

# Uninstall the release
uninstall_release() {
    log_info "Uninstalling release $RELEASE_NAME from namespace $NAMESPACE..."
    
    # Uninstall with Helm
    helm uninstall "$RELEASE_NAME" -n "$NAMESPACE" --wait --timeout 10m
    
    log_info "Release uninstalled successfully"
}

# Clean up remaining resources
cleanup_resources() {
    log_info "Checking for remaining resources..."
    
    # Check for any remaining resources
    local remaining_resources
    remaining_resources=$(kubectl get all -n "$NAMESPACE" -l app.kubernetes.io/name="$CHART_NAME" --no-headers 2>/dev/null | wc -l)
    
    if [[ "$remaining_resources" -gt 0 ]]; then
        log_warn "Found $remaining_resources remaining resources"
        kubectl get all -n "$NAMESPACE" -l app.kubernetes.io/name="$CHART_NAME"
        
        echo
        read -p "Do you want to force delete these resources? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log_info "Force deleting remaining resources..."
            kubectl delete all -n "$NAMESPACE" -l app.kubernetes.io/name="$CHART_NAME" --grace-period=0 --force
        fi
    else
        log_info "No remaining resources found"
    fi
}

# Show final status
show_final_status() {
    log_info "Final status check:"
    
    echo
    echo "Helm releases in namespace $NAMESPACE:"
    helm list -n "$NAMESPACE"
    
    echo
    echo "Remaining resources with label app.kubernetes.io/name=$CHART_NAME:"
    kubectl get all -n "$NAMESPACE" -l app.kubernetes.io/name="$CHART_NAME" || log_info "No resources found"
}

# Main execution
main() {
    log_info "Starting uninstall of $CHART_NAME"
    log_info "Release: $RELEASE_NAME"
    log_info "Namespace: $NAMESPACE"
    
    validate_prerequisites
    check_release
    show_current_status
    
    echo
    read -p "Are you sure you want to uninstall $RELEASE_NAME? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Uninstall cancelled by user"
        exit 0
    fi
    
    uninstall_release
    cleanup_resources
    show_final_status
    
    log_info "Uninstall completed successfully"
    echo
    echo "🗑️  Dashcam has been uninstalled from the cluster"
    echo "   The service is no longer accessible at https://dashcam.lilnas.io"
}

# Help function
show_help() {
    cat << EOF
Uninstall script for dashcam Helm chart

Usage: $0

This script will:
1. Check if the release exists
2. Show current status
3. Prompt for confirmation
4. Uninstall the Helm release
5. Clean up any remaining resources

Options:
  -h, --help    Show this help message

EOF
}

# Parse command line arguments
case "${1:-}" in
    -h|--help)
        show_help
        exit 0
        ;;
    "")
        main
        ;;
    *)
        log_error "Unknown argument: $1"
        show_help
        exit 1
        ;;
esac