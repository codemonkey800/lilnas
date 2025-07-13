#!/bin/bash
# Deploy the namespaces Helm chart

set -euo pipefail

RELEASE_NAME="${RELEASE_NAME:-namespaces}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
NAMESPACE="${NAMESPACE:-default}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENV    Environment to deploy (dev|prod) [default: dev]"
    echo "  -n, --namespace NS       Namespace to install chart in [default: default]"
    echo "  -r, --release NAME       Release name [default: namespaces]"
    echo "  -d, --dry-run           Perform a dry run"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Deploy with dev values"
    echo "  $0 -e prod              # Deploy with prod values"
    echo "  $0 -e dev --dry-run     # Dry run with dev values"
}

DRY_RUN=""

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
        -r|--release)
            RELEASE_NAME="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN="--dry-run"
            shift
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
if [[ "$ENVIRONMENT" != "dev" && "$ENVIRONMENT" != "prod" ]]; then
    echo "Error: Invalid environment '$ENVIRONMENT'. Must be 'dev' or 'prod'."
    exit 1
fi

# Set values file based on environment
VALUES_FILE="values-${ENVIRONMENT}.yaml"

echo "Deploying namespaces Helm chart..."
echo "  Release: $RELEASE_NAME"
echo "  Namespace: $NAMESPACE"
echo "  Environment: $ENVIRONMENT"
echo "  Values file: $VALUES_FILE"
if [[ -n "$DRY_RUN" ]]; then
    echo "  Mode: DRY RUN"
fi
echo ""

# Check if values file exists
if [[ ! -f "$VALUES_FILE" ]]; then
    echo "Error: Values file '$VALUES_FILE' not found!"
    exit 1
fi

# Deploy the chart
if helm list -n "$NAMESPACE" | grep -q "^${RELEASE_NAME}\s"; then
    echo "Upgrading existing release..."
    helm upgrade "$RELEASE_NAME" . \
        -n "$NAMESPACE" \
        -f "$VALUES_FILE" \
        $DRY_RUN
else
    echo "Installing new release..."
    helm install "$RELEASE_NAME" . \
        -n "$NAMESPACE" \
        -f "$VALUES_FILE" \
        $DRY_RUN
fi

if [[ -z "$DRY_RUN" ]]; then
    echo ""
    echo "Deployment complete! Checking namespaces..."
    kubectl get namespaces -l project=lilnas
fi