#!/bin/bash
# Test rendering of the MinIO Helm chart

set -euo pipefail

# Get script directory for relative path resolution
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Testing MinIO Helm chart rendering..."
echo ""

# Test default values
echo "=== Testing with default values ==="
helm template minio . --debug
echo ""

# Test with dev values
echo "=== Testing with dev values ==="
helm template minio . -f values-dev.yaml --debug
echo ""

# Test with prod values
echo "=== Testing with prod values ==="
helm template minio . -f values-prod.yaml --debug
echo ""

# Test with custom storage size
echo "=== Testing with custom storage size (100Gi) ==="
helm template minio . \
  --set persistence.size=100Gi \
  --debug
echo ""

# Test with custom credentials
echo "=== Testing with custom credentials ==="
helm template minio . \
  --set auth.username=testuser \
  --set auth.password=testpass123 \
  --debug
echo ""

# Test with disabled ingress
echo "=== Testing with ingress disabled ==="
helm template minio . \
  --set ingress.console.enabled=false \
  --set ingress.api.enabled=false \
  --debug
echo ""

# Test with custom resource limits
echo "=== Testing with custom resource limits ==="
helm template minio . \
  --set resources.requests.memory=2Gi \
  --set resources.requests.cpu=1000m \
  --set resources.limits.memory=4Gi \
  --set resources.limits.cpu=2000m \
  --debug
echo ""

# Test with multiple replicas (distributed mode)
echo "=== Testing with multiple replicas (4 replicas) ==="
helm template minio . \
  --set replicaCount=4 \
  --set persistence.size=50Gi \
  --debug
echo ""

# Test with custom bucket configuration
echo "=== Testing with custom bucket configuration ==="
helm template minio . \
  --set 'defaultBuckets[0].name=custom-bucket' \
  --set 'defaultBuckets[0].versioning=true' \
  --set 'defaultBuckets[0].objectLocking=false' \
  --debug
echo ""

# Test with security context modifications
echo "=== Testing with custom security context ==="
helm template minio . \
  --set securityContext.runAsUser=1001 \
  --set securityContext.runAsGroup=1001 \
  --set securityContext.fsGroup=1001 \
  --debug
echo ""

# Test with node selector
echo "=== Testing with node selector ==="
helm template minio . \
  --set 'nodeSelector.storage=true' \
  --debug
echo ""

# Test with tolerations
echo "=== Testing with tolerations ==="
helm template minio . \
  --set 'tolerations[0].key=storage' \
  --set 'tolerations[0].operator=Equal' \
  --set 'tolerations[0].value=dedicated' \
  --set 'tolerations[0].effect=NoSchedule' \
  --debug
echo ""

# Test prod environment with SSL
echo "=== Testing prod environment with custom domain ==="
helm template minio . -f values-prod.yaml \
  --set ingress.console.host=storage.example.com \
  --set ingress.api.host=storage-api.example.com \
  --debug
echo ""

echo "All rendering tests completed successfully!"
echo ""
echo "Notes:"
echo "- Review the rendered templates for any issues"
echo "- Pay attention to resource requests/limits for your cluster capacity"
echo "- Verify ingress configurations match your domain setup"
echo "- Check that storage class and persistence settings are appropriate"
echo "- Ensure security contexts are compatible with your cluster policies"