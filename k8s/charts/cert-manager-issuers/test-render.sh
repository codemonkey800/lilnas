#!/bin/bash
# Test rendering of the cert-manager-issuers Helm chart

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Testing cert-manager-issuers Helm chart rendering..."
echo

# Test default values
echo "=== Testing with default values ==="
helm template cert-manager-issuers . --debug
echo

# Test with dev values
echo "=== Testing with dev values ==="
helm template cert-manager-issuers . -f values-dev.yaml --debug
echo

# Test with prod values
echo "=== Testing with prod values ==="
helm template cert-manager-issuers . -f values-prod.yaml --debug
echo

# Test with custom email
echo "=== Testing with custom email ==="
helm template cert-manager-issuers . --set email=custom@example.com --debug
echo

# Test with disabled production issuer
echo "=== Testing with production issuer disabled ==="
helm template cert-manager-issuers . --set production.enabled=false --debug
echo

# Test with disabled staging issuer
echo "=== Testing with staging issuer disabled ==="
helm template cert-manager-issuers . --set staging.enabled=false --debug
echo

echo "All rendering tests completed successfully!"