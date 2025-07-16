#!/bin/bash
# Test rendering of the me-token-tracker Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENVIRONMENT="${ENVIRONMENT:-prod}"
NAMESPACE="${NAMESPACE:-lilnas-apps}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENV    Environment to test (prod) [default: prod]"
    echo "  -n, --namespace NS       Namespace to use [default: lilnas-apps]"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Test with prod values"
    echo "  $0 -n lilnas-prod       # Test with specific namespace"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Validate environment
if [[ "$ENVIRONMENT" != "prod" ]]; then
    echo "Error: Invalid environment '$ENVIRONMENT'. Must be 'prod'."
    exit 1
fi

VALUES_FILE="values-${ENVIRONMENT}.yaml"

echo "Testing me-token-tracker Helm chart rendering..."
echo "  Environment: $ENVIRONMENT"
echo "  Namespace: $NAMESPACE"
echo "  Values file: $VALUES_FILE"
echo ""

# Check if values file exists
if [[ ! -f "$VALUES_FILE" ]]; then
    echo "Error: Values file '$VALUES_FILE' not found!"
    exit 1
fi

# Test chart rendering
echo "=== Testing Chart Rendering ==="
helm template me-token-tracker . \
    -f "$VALUES_FILE" \
    -n "$NAMESPACE" \
    --set secrets.API_TOKEN="test-token" \
    --set secrets.CLIENT_ID="test-client-id" \
    --set secrets.APPLICATION_ID="test-app-id"

echo ""
echo "=== Chart Validation ==="
helm lint . -f "$VALUES_FILE"

echo ""
echo "=== Dependency Check ==="
helm dependency list .

echo ""
echo "Chart rendering test completed successfully!"