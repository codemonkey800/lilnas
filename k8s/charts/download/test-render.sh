#!/bin/bash
# Test rendering of the download Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Testing download Helm chart rendering..."
echo

# Test default values
echo "=== Testing with default values ==="
helm template download . --debug
echo

# Test with dev values
echo "=== Testing with dev values ==="
helm template download . -f values-dev.yaml --debug
echo

# Test with prod values (without secrets)
echo "=== Testing with prod values (without secrets) ==="
helm template download . -f values-prod.yaml --debug 2>/dev/null || true
echo

# Test with prod values and secrets
echo "=== Testing with prod values and secrets ==="
helm template download . -f values-prod.yaml \
  --set auth.minioAccessKey=test-access-key \
  --set auth.minioSecretKey=test-secret-key \
  --debug
echo

# Test with custom MinIO credentials
echo "=== Testing with custom MinIO credentials ==="
helm template download . \
  --set auth.minioAccessKey=custom-access-key \
  --set auth.minioSecretKey=custom-secret-key \
  --debug
echo

# Test with existing secret
echo "=== Testing with existing secret ==="
helm template download . \
  --set existingSecret=my-existing-secret \
  --debug
echo

# Test with custom MinIO configuration
echo "=== Testing with custom MinIO configuration ==="
helm template download . \
  --set config.minioHost=custom-minio.example.com \
  --set config.minioPort=9001 \
  --set config.minioPublicUrl=https://storage.example.com \
  --debug
echo

# Test with download configuration
echo "=== Testing with custom download configuration ==="
helm template download . \
  --set config.maxDownloads=10 \
  --set config.timezone=UTC \
  --set config.nodeEnv=development \
  --debug
echo

# Test with ingress disabled
echo "=== Testing with ingress disabled ==="
helm template download . \
  --set ingress.enabled=false \
  --debug
echo

# Test with different ingress configuration
echo "=== Testing with custom ingress configuration ==="
helm template download . \
  --set ingress.hosts[0].host=download.example.com \
  --set ingress.tls[0].hosts[0]=download.example.com \
  --set ingress.tls[0].secretName=custom-tls-secret \
  --set ingress.certManager.clusterIssuer=letsencrypt-staging \
  --debug
echo

# Test with pod disruption budget disabled
echo "=== Testing with pod disruption budget disabled ==="
helm template download . \
  --set podDisruptionBudget.enabled=false \
  --debug
echo

# Test with higher replica count
echo "=== Testing with multiple replicas ==="
helm template download . \
  --set replicaCount=3 \
  --set podDisruptionBudget.minAvailable=2 \
  --debug
echo

# Test with custom resources
echo "=== Testing with custom resource limits ==="
helm template download . \
  --set resources.requests.memory=512Mi \
  --set resources.requests.cpu=300m \
  --set resources.limits.memory=2Gi \
  --set resources.limits.cpu=2000m \
  --debug
echo

# Test with custom service account
echo "=== Testing with custom service account ==="
helm template download . \
  --set serviceAccount.create=false \
  --set serviceAccount.name=custom-service-account \
  --debug
echo

# Test with extra environment variables
echo "=== Testing with extra environment variables ==="
helm template download . \
  --set 'extraEnv[0].name=CUSTOM_VAR' \
  --set 'extraEnv[0].value=custom-value' \
  --set 'extraEnv[1].name=DOWNLOAD_TIMEOUT' \
  --set 'extraEnv[1].value=3600' \
  --debug
echo

# Test with node selector and tolerations
echo "=== Testing with node selector and tolerations ==="
helm template download . \
  --set 'nodeSelector.disktype=ssd' \
  --set 'tolerations[0].key=download-node' \
  --set 'tolerations[0].operator=Equal' \
  --set 'tolerations[0].value=true' \
  --set 'tolerations[0].effect=NoSchedule' \
  --debug
echo

# Test with common labels and annotations
echo "=== Testing with common labels and annotations ==="
helm template download . \
  --set 'commonLabels.team=platform' \
  --set 'commonLabels.version=v1.0.0' \
  --set 'commonAnnotations.contact=platform-team@example.com' \
  --set 'commonAnnotations.documentation=https://docs.example.com/download' \
  --debug
echo

# Test with health check customization
echo "=== Testing with custom health check configuration ==="
helm template download . \
  --set livenessProbe.initialDelaySeconds=120 \
  --set livenessProbe.timeoutSeconds=15 \
  --set readinessProbe.periodSeconds=10 \
  --debug
echo

# Test with persistent volume configuration
echo "=== Testing with persistent volume configuration ==="
helm template download . \
  --set persistence.enabled=true \
  --set persistence.size=50Gi \
  --set persistence.storageClass=fast-ssd \
  --debug
echo

# Test with custom port configuration
echo "=== Testing with custom port configuration ==="
helm template download . \
  --set config.frontendPort=3000 \
  --set config.backendPort=3001 \
  --set service.port=3000 \
  --set service.targetPort=3000 \
  --debug
echo

echo "All rendering tests completed successfully!"