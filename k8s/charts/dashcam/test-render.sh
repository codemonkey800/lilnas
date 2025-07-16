#!/usr/bin/env bash
#
# Test render script for dashcam Helm chart
# Usage: ./test-render.sh [environment]
#
# This script tests the Helm chart rendering without deploying
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
    
    log_info "Prerequisites validated successfully"
}

# Update Helm dependencies
update_dependencies() {
    log_info "Updating Helm dependencies..."
    cd "$CHART_DIR"
    helm dependency update
    log_info "Dependencies updated successfully"
}

# Test chart rendering
test_render() {
    local environment="${1:-prod}"
    local values_file="values-${environment}.yaml"
    
    log_info "Testing $CHART_NAME chart rendering for $environment environment..."
    
    # Check if values file exists
    if [[ ! -f "$CHART_DIR/$values_file" ]]; then
        log_error "Values file not found: $values_file"
        exit 1
    fi
    
    # Test rendering with helm template
    log_info "Running helm template..."
    helm template "$RELEASE_NAME" "$CHART_DIR" \
        --namespace "$NAMESPACE" \
        --values "$CHART_DIR/values.yaml" \
        --values "$CHART_DIR/$values_file" \
        --debug \
        --validate
    
    log_info "Chart rendering test completed successfully"
}

# Lint the chart
lint_chart() {
    log_info "Linting chart..."
    
    helm lint "$CHART_DIR" \
        --values "$CHART_DIR/values.yaml" \
        --values "$CHART_DIR/values-prod.yaml"
    
    log_info "Chart linting completed successfully"
}

# Main execution
main() {
    local environment="${1:-prod}"
    
    log_info "Starting chart render test for $CHART_NAME"
    log_info "Environment: $environment"
    log_info "Release: $RELEASE_NAME"
    log_info "Namespace: $NAMESPACE"
    
    validate_prerequisites
    update_dependencies
    lint_chart
    test_render "$environment"
    
    log_info "Chart render test completed successfully"
    echo
    echo "✅ Chart renders correctly for $environment environment"
    echo "   Ready for deployment!"
}

# Help function
show_help() {
    cat << EOF
Test render script for dashcam Helm chart

Usage: $0 [environment]

Arguments:
  environment    Target environment (default: prod)

Available environments:
  prod          Production environment

Examples:
  $0            Test render for production
  $0 prod       Test render for production explicitly

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