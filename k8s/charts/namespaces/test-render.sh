#!/bin/bash
# Test rendering of the namespaces Helm chart

set -euo pipefail

echo "Testing namespaces Helm chart rendering..."
echo

# Test default values
echo "=== Testing with default values ==="
helm template namespaces . --debug
echo

# Test with dev values
echo "=== Testing with dev values ==="
helm template namespaces . -f values-dev.yaml --debug
echo

# Test with prod values
echo "=== Testing with prod values ==="
helm template namespaces . -f values-prod.yaml --debug
echo

# Test with custom namespaces
echo "=== Testing with custom namespaces ==="
helm template namespaces . --set 'customNamespaces[0].name=lilnas-test' \
  --set 'customNamespaces[0].enabled=true' \
  --set 'customNamespaces[0].labels.tier=testing' \
  --set 'customNamespaces[0].annotations.description=Test namespace' --debug
echo

# Test with resource quotas enabled
echo "=== Testing with resource quotas enabled ==="
helm template namespaces . --set resourceQuotas.enabled=true --debug
echo

# Test with network policies enabled
echo "=== Testing with network policies enabled ==="
helm template namespaces . --set networkPolicies.enabled=true --debug
echo

echo "All rendering tests completed successfully!"