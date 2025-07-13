#!/bin/bash
# Test rendering of the forward-auth Helm chart

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Testing forward-auth Helm chart rendering..."
echo

# Test default values
echo "=== Testing with default values ==="
helm template forward-auth . --debug
echo

# Test with dev values
echo "=== Testing with dev values ==="
helm template forward-auth . -f values-dev.yaml --debug
echo

# Test with prod values
echo "=== Testing with prod values ==="
helm template forward-auth . -f values-prod.yaml --debug
echo

# Test with custom domain
echo "=== Testing with custom domain ==="
helm template forward-auth . \
  --set config.authHost=auth.example.com \
  --set config.cookieDomain=example.com \
  --set ingress.host=auth.example.com \
  --set ingress.tls.secretName=auth-example-com-tls \
  --debug
echo

# Test with different OAuth provider
echo "=== Testing with GitHub OAuth provider ==="
helm template forward-auth . \
  --set oauth.provider=github \
  --set oauth.secret.clientIdKey=github-client-id \
  --set oauth.secret.clientSecretKey=github-client-secret \
  --debug
echo

# Test with custom whitelist
echo "=== Testing with custom whitelist ==="
helm template forward-auth . \
  --set config.whitelist="user1@example.com\,user2@example.com\,user3@example.com" \
  --debug
echo

# Test with insecure cookie (dev mode)
echo "=== Testing with insecure cookie for development ==="
helm template forward-auth . \
  --set config.insecureCookie=true \
  --set config.authHost=auth.localhost \
  --set config.cookieDomain=localhost \
  --set ingress.host=auth.localhost \
  --set ingress.tls.enabled=false \
  --debug
echo

# Test with middleware disabled
echo "=== Testing with middleware disabled ==="
helm template forward-auth . \
  --set middleware.enabled=false \
  --debug
echo

# Test with ingress disabled
echo "=== Testing with ingress disabled ==="
helm template forward-auth . \
  --set ingress.enabled=false \
  --debug
echo

# Test with custom resources
echo "=== Testing with custom resource limits ==="
helm template forward-auth . \
  --set resources.requests.memory=128Mi \
  --set resources.requests.cpu=100m \
  --set resources.limits.memory=256Mi \
  --set resources.limits.cpu=200m \
  --debug
echo

# Test with replica count > 1
echo "=== Testing with multiple replicas ==="
helm template forward-auth . \
  --set replicaCount=2 \
  --set podDisruptionBudget.minAvailable=1 \
  --debug
echo

# Test with custom namespace
echo "=== Testing with custom namespace ==="
helm template forward-auth . \
  --set namespace=custom-auth \
  --debug
echo

echo "All rendering tests completed successfully!"