#!/bin/bash
set -e

echo "Deploying Turbo Cache to k3s..."

# Check if secret exists
if ! kubectl get secret turbo-cache-secrets -n lilnas-core >/dev/null 2>&1; then
    echo "Error: Secret 'turbo-cache-secrets' not found in namespace 'lilnas-core'"
    echo "Please create the secret first using the setup.sh script:"
    echo "  ./scripts/setup.sh --turbo-token <token> --aws-access-key <key> --aws-secret-key <secret> --create"
    exit 1
fi

echo "Secret found, proceeding with deployment..."

# Apply all manifests
kubectl apply -f manifests/

# Wait for deployment to be ready
kubectl wait --for=condition=available --timeout=300s deployment/turbo-cache -n lilnas-core

echo "Turbo Cache deployed successfully! Access at: https://turbo.lilnas.io"