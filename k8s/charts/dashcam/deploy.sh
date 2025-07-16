#!/usr/bin/env bash
#
# Deploy script for dashcam Helm chart
# Usage: ./deploy.sh [environment]
#
# Environment options:
#   prod (default) - Deploy to production
#
# Examples:
#   ./deploy.sh           # Deploy to production
#   ./deploy.sh prod      # Deploy to production explicitly
#

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART_DIR="$SCRIPT_DIR"

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

# Create namespace if it doesn't exist
create_namespace() {
    if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
        log_info "Creating namespace: $NAMESPACE"
        kubectl create namespace "$NAMESPACE"
    else
        log_info "Namespace $NAMESPACE already exists"
    fi
}

# Update Helm dependencies
update_dependencies() {
    log_info "Updating Helm dependencies..."
    cd "$CHART_DIR"
    helm dependency update
    log_info "Dependencies updated successfully"
}

# Deploy the chart
deploy_chart() {
    local environment="${1:-prod}"
    local values_file="values-${environment}.yaml"
    
    log_info "Deploying $CHART_NAME to $environment environment..."
    
    # Check if values file exists
    if [[ ! -f "$CHART_DIR/$values_file" ]]; then
        log_error "Values file not found: $values_file"
        exit 1
    fi
    
    # Deploy with Helm
    helm upgrade --install "$RELEASE_NAME" "$CHART_DIR" \
        --namespace "$NAMESPACE" \
        --values "$CHART_DIR/values.yaml" \
        --values "$CHART_DIR/$values_file" \
        --timeout 10m \
        --wait \
        --atomic
    
    log_info "Deployment completed successfully"
}

# Show deployment status
show_status() {
    log_info "Deployment status:"
    
    echo
    echo "Helm release status:"
    helm status "$RELEASE_NAME" -n "$NAMESPACE"
    
    echo
    echo "Kubernetes resources:"
    kubectl get all -n "$NAMESPACE" -l app.kubernetes.io/name="$CHART_NAME"
    
    echo
    echo "Ingress information:"
    kubectl get ingress -n "$NAMESPACE" -l app.kubernetes.io/name="$CHART_NAME"
}

# Main execution
main() {
    local environment="${1:-prod}"
    
    log_info "Starting deployment of $CHART_NAME chart"
    log_info "Environment: $environment"
    log_info "Release: $RELEASE_NAME"
    log_info "Namespace: $NAMESPACE"
    
    validate_prerequisites
    create_namespace
    update_dependencies
    deploy_chart "$environment"
    show_status
    
    log_info "Deployment script completed successfully"
    echo
    echo "🎉 Dashcam is now deployed and accessible at:"
    echo "   https://dashcam.lilnas.io"
    echo
    echo "To check logs, run:"
    echo "   kubectl logs -n $NAMESPACE deployment/$RELEASE_NAME"
}

# Help function
show_help() {
    cat << EOF
Deploy script for dashcam Helm chart

Usage: $0 [environment]

Arguments:
  environment    Target environment (default: prod)

Available environments:
  prod          Production environment

Examples:
  $0            Deploy to production
  $0 prod       Deploy to production explicitly

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
    ""|prod)
        main "${1:-prod}"
        ;;
    *)
        log_error "Unknown environment: $1"
        show_help
        exit 1
        ;;
esac