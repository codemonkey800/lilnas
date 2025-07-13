#!/bin/bash
# Test rendering of the turbo-cache Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Testing turbo-cache Helm chart rendering..."
echo

# Test default values
echo "=== Testing with default values ==="
helm template turbo-cache . --debug
echo

# Test with dev values
echo "=== Testing with dev values ==="
helm template turbo-cache . -f values-dev.yaml --debug
echo

# Test with prod values
echo "=== Testing with prod values ==="
helm template turbo-cache . -f values-prod.yaml --debug
echo

# Test with custom auth tokens
echo "=== Testing with custom auth tokens ==="
helm template turbo-cache . \
  --set auth.turboToken=custom-turbo-token \
  --set auth.s3AccessKey=custom-access-key \
  --set auth.s3SecretKey=custom-secret-key \
  --debug
echo

# Test with existing secret
echo "=== Testing with existing secret ==="
helm template turbo-cache . \
  --set existingSecret=my-existing-secret \
  --debug
echo

# Test with custom storage configuration
echo "=== Testing with custom storage configuration ==="
helm template turbo-cache . \
  --set config.storageProvider=local \
  --set config.storagePath=/custom/cache/path \
  --set config.s3Endpoint=https://custom-s3.example.com \
  --set config.awsRegion=eu-west-1 \
  --debug
echo

# Test with ingress disabled
echo "=== Testing with ingress disabled ==="
helm template turbo-cache . \
  --set ingress.enabled=false \
  --debug
echo

# Test with different ingress configuration
echo "=== Testing with custom ingress configuration ==="
helm template turbo-cache . \
  --set ingress.host=cache.example.com \
  --set ingress.tls.issuer=letsencrypt-staging \
  --set ingress.tls.secretName=custom-tls-secret \
  --debug
echo

# Test with pod disruption budget disabled
echo "=== Testing with pod disruption budget disabled ==="
helm template turbo-cache . \
  --set podDisruptionBudget.enabled=false \
  --debug
echo

# Test with higher replica count
echo "=== Testing with multiple replicas ==="
helm template turbo-cache . \
  --set replicaCount=3 \
  --set podDisruptionBudget.minAvailable=2 \
  --debug
echo

# Test with custom resources
echo "=== Testing with custom resource limits ==="
helm template turbo-cache . \
  --set resources.requests.memory=512Mi \
  --set resources.requests.cpu=250m \
  --set resources.limits.memory=2Gi \
  --set resources.limits.cpu=2000m \
  --debug
echo

# Test with custom service account
echo "=== Testing with custom service account ==="
helm template turbo-cache . \
  --set serviceAccount.create=false \
  --set serviceAccount.name=custom-service-account \
  --debug
echo

# Test with extra environment variables
echo "=== Testing with extra environment variables ==="
helm template turbo-cache . \
  --set 'extraEnv[0].name=CUSTOM_VAR' \
  --set 'extraEnv[0].value=custom-value' \
  --set 'extraEnv[1].name=ANOTHER_VAR' \
  --set 'extraEnv[1].value=another-value' \
  --debug
echo

# Test with node selector and tolerations
echo "=== Testing with node selector and tolerations ==="
helm template turbo-cache . \
  --set 'nodeSelector.disktype=ssd' \
  --set 'tolerations[0].key=cache-node' \
  --set 'tolerations[0].operator=Equal' \
  --set 'tolerations[0].value=true' \
  --set 'tolerations[0].effect=NoSchedule' \
  --debug
echo

# Test with common labels and annotations
echo "=== Testing with common labels and annotations ==="
helm template turbo-cache . \
  --set 'commonLabels.team=platform' \
  --set 'commonLabels.version=v1.0.0' \
  --set 'commonAnnotations.contact=platform-team@example.com' \
  --set 'commonAnnotations.documentation=https://docs.example.com/turbo-cache' \
  --debug
echo

echo "All rendering tests completed successfully!"