#!/bin/bash
# Test rendering of the storage-setup Helm chart

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Testing storage-setup Helm chart rendering..."
echo

echo "1. Testing with default values:"
helm template storage-setup . > /tmp/storage-setup-default.yaml
echo "✓ Default values rendered successfully"
echo

echo "2. Testing with dev values:"
helm template storage-setup . -f values-dev.yaml > /tmp/storage-setup-dev.yaml
echo "✓ Dev values rendered successfully"
echo

echo "3. Testing with prod values:"
helm template storage-setup . -f values-prod.yaml > /tmp/storage-setup-prod.yaml
echo "✓ Prod values rendered successfully"
echo

echo "4. Testing with custom values:"
cat > /tmp/test-custom-values.yaml <<EOF
persistentVolumes:
  appConfigs:
    enabled: false
  buildCache:
    capacity: 200Gi
additionalPVs:
  - enabled: true
    name: test-pv
    storageClass: ssd-storage
    capacity: 100Gi
    accessModes:
      - ReadWriteOnce
    path: /mnt/ssd1/test
EOF

helm template storage-setup . -f /tmp/test-custom-values.yaml > /tmp/storage-setup-custom.yaml
echo "✓ Custom values rendered successfully"
echo

echo "5. Validating YAML syntax:"
for file in /tmp/storage-setup-*.yaml; do
  kubectl apply --dry-run=client -f "$file" > /dev/null 2>&1
  echo "✓ $(basename $file) is valid YAML"
done
echo

echo "6. Checking resource counts:"
echo "Default configuration:"
echo "  Storage Classes: $(grep -c "kind: StorageClass" /tmp/storage-setup-default.yaml)"
echo "  Persistent Volumes: $(grep -c "kind: PersistentVolume" /tmp/storage-setup-default.yaml)"
echo

echo "All rendering tests completed successfully!"
echo
echo "To see the rendered output, check:"
echo "  /tmp/storage-setup-default.yaml"
echo "  /tmp/storage-setup-dev.yaml"
echo "  /tmp/storage-setup-prod.yaml"
echo "  /tmp/storage-setup-custom.yaml"

# Cleanup
rm -f /tmp/test-custom-values.yaml