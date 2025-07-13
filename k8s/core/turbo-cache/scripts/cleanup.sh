#!/bin/bash
set -e

echo "Cleaning up Turbo Cache deployment..."

# Delete the secret
kubectl delete secret turbo-cache-secrets -n lilnas-core || true

# Delete all manifest resources
kubectl delete -f ../manifests/ || true

echo "Turbo Cache cleanup completed!"