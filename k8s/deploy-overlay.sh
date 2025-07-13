#!/bin/bash
# Deploy script for flat kustomization overlay files

set -euo pipefail

# Function to deploy a service
deploy_service() {
    local service_dir="$1"
    local env="$2"
    
    echo "Deploying ${service_dir##*/} in $env environment..."
    
    cd "$service_dir/overlays"
    
    # Temporarily copy the environment-specific kustomization file
    cp "kustomization.${env}.yaml" kustomization.yaml
    
    # Apply the configuration
    kubectl apply -k .
    
    # Clean up
    rm kustomization.yaml
    
    echo "✓ ${service_dir##*/} deployed successfully"
}

# Main execution
if [[ $# -lt 2 ]]; then
    echo "Usage: $0 <service> <env>"
    echo "Example: $0 forward-auth prod"
    echo "         $0 turbo-cache dev"
    exit 1
fi

SERVICE="$1"
ENV="$2"

# Validate environment
if [[ ! "$ENV" =~ ^(dev|prod)$ ]]; then
    echo "Error: Environment must be 'dev' or 'prod'"
    exit 1
fi

# Determine service directory
case "$SERVICE" in
    forward-auth)
        SERVICE_DIR="/Users/jasuncion/dev/lilnas/k8s/core/forward-auth"
        ;;
    turbo-cache)
        SERVICE_DIR="/Users/jasuncion/dev/lilnas/k8s/core/turbo-cache"
        ;;
    *)
        echo "Error: Unknown service '$SERVICE'"
        echo "Available services: forward-auth, turbo-cache"
        exit 1
        ;;
esac

# Deploy the service
deploy_service "$SERVICE_DIR" "$ENV"