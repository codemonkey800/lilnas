#!/bin/bash
# Deploy the storage-setup Helm chart

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RELEASE_NAME="${RELEASE_NAME:-storage-setup}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
NAMESPACE="${NAMESPACE:-default}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENV    Environment to deploy (dev|prod) [default: dev]"
    echo "  -n, --namespace NS       Namespace to install chart in [default: default]"
    echo "  -r, --release NAME       Release name [default: storage-setup]"
    echo "  -f, --values FILE        Additional values file to use"
    echo "  -d, --dry-run           Perform a dry run"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Deploy with dev values"
    echo "  $0 -e prod              # Deploy with prod values"
    echo "  $0 -e dev --dry-run     # Dry run with dev values"
    echo "  $0 -f custom.yaml       # Deploy with custom values file"
}

DRY_RUN=""
ADDITIONAL_VALUES_FILE=""

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
        -f|--values)
            ADDITIONAL_VALUES_FILE="$2"
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

echo "Deploying storage-setup Helm chart..."
echo "  Release: $RELEASE_NAME"
echo "  Namespace: $NAMESPACE"
echo "  Environment: $ENVIRONMENT"
echo "  Values file: $VALUES_FILE"
if [[ -n "$ADDITIONAL_VALUES_FILE" ]]; then
    echo "  Additional values: $ADDITIONAL_VALUES_FILE"
fi
if [[ -n "$DRY_RUN" ]]; then
    echo "  Mode: DRY RUN"
fi
echo ""

# Check if values file exists
if [[ ! -f "$VALUES_FILE" ]]; then
    echo "Error: Values file '$VALUES_FILE' not found!"
    exit 1
fi

# Check if additional values file exists
if [[ -n "$ADDITIONAL_VALUES_FILE" ]] && [[ ! -f "$ADDITIONAL_VALUES_FILE" ]]; then
    echo "Error: Additional values file '$ADDITIONAL_VALUES_FILE' not found!"
    exit 1
fi

# Build helm command arguments
HELM_ARGS=()
HELM_ARGS+=("-f" "$VALUES_FILE")
if [[ -n "$ADDITIONAL_VALUES_FILE" ]]; then
    HELM_ARGS+=("-f" "$ADDITIONAL_VALUES_FILE")
fi
if [[ -n "$DRY_RUN" ]]; then
    HELM_ARGS+=("$DRY_RUN")
fi

# Deploy the chart
if helm list -n "$NAMESPACE" | grep -q "^${RELEASE_NAME}\s"; then
    echo "Upgrading existing release..."
    helm upgrade "$RELEASE_NAME" . \
        -n "$NAMESPACE" \
        "${HELM_ARGS[@]}"
else
    echo "Installing new release..."
    helm install "$RELEASE_NAME" . \
        -n "$NAMESPACE" \
        "${HELM_ARGS[@]}"
fi

if [[ -z "$DRY_RUN" ]]; then
    echo ""
    echo "Deployment complete!"
    echo ""
    echo "Storage resources created:"
    echo "  Storage Classes:"
    kubectl get storageclass
    echo ""
    echo "  Persistent Volumes:"
    kubectl get pv | grep -E "(app-configs|build-cache|game-servers|google-photos|immich|media-services|minio|movies|postgres|redis|tv)" || echo "    No lilnas PVs found"
    echo ""
    echo "To see the release status:"
    echo "  helm list -n $NAMESPACE"
    echo "  helm status $RELEASE_NAME -n $NAMESPACE"
fi