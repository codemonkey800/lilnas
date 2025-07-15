#!/bin/bash
# Test rendering of the equations Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Testing equations Helm chart rendering..."
echo

# Test default values
echo "=== Testing with default values ==="
helm template equations . --debug
echo

# Test with dev values
echo "=== Testing with dev values ==="
helm template equations . -f values-dev.yaml --debug
echo

# Test with prod values (without secrets)
echo "=== Testing with prod values (without secrets) ==="
helm template equations . -f values-prod.yaml --debug
echo

# Test with prod values and secrets
echo "=== Testing with prod values and secrets ==="
helm template equations . -f values-prod.yaml \
  --set auth.apiToken=test-api-token \
  --set auth.s3AccessKey=test-access-key \
  --set auth.s3SecretKey=test-secret-key \
  --debug
echo

# Test with custom auth tokens
echo "=== Testing with custom auth tokens ==="
helm template equations . \
  --set auth.apiToken=custom-api-token \
  --set auth.minioAccessKey=custom-access-key \
  --set auth.minioSecretKey=custom-secret-key \
  --debug
echo

# Test with existing secret
echo "=== Testing with existing secret ==="
helm template equations . \
  --set existingSecret=my-existing-secret \
  --debug
echo

# Test with custom MinIO configuration
echo "=== Testing with custom MinIO configuration ==="
helm template equations . \
  --set config.minioHost=custom-minio.example.com \
  --set config.minioPort=9001 \
  --set config.nodeEnv=development \
  --debug
echo

# Test with ingress disabled
echo "=== Testing with ingress disabled ==="
helm template equations . \
  --set ingress.enabled=false \
  --debug
echo

# Test with different ingress configuration
echo "=== Testing with custom ingress configuration ==="
helm template equations . \
  --set ingress.host=equations.example.com \
  --set ingress.tls.issuer=letsencrypt-staging \
  --set ingress.tls.secretName=custom-tls-secret \
  --debug
echo

# Test with pod disruption budget disabled
echo "=== Testing with pod disruption budget disabled ==="
helm template equations . \
  --set podDisruptionBudget.enabled=false \
  --debug
echo

# Test with higher replica count
echo "=== Testing with multiple replicas ==="
helm template equations . \
  --set replicaCount=3 \
  --set podDisruptionBudget.minAvailable=2 \
  --debug
echo

# Test with custom resources
echo "=== Testing with custom resource limits ==="
helm template equations . \
  --set resources.requests.memory=512Mi \
  --set resources.requests.cpu=300m \
  --set resources.limits.memory=2Gi \
  --set resources.limits.cpu=2000m \
  --debug
echo

# Test with custom service account
echo "=== Testing with custom service account ==="
helm template equations . \
  --set serviceAccount.create=false \
  --set serviceAccount.name=custom-service-account \
  --debug
echo

# Test with extra environment variables
echo "=== Testing with extra environment variables ==="
helm template equations . \
  --set 'extraEnv[0].name=CUSTOM_VAR' \
  --set 'extraEnv[0].value=custom-value' \
  --set 'extraEnv[1].name=LATEX_TIMEOUT' \
  --set 'extraEnv[1].value=30000' \
  --debug
echo

# Test with node selector and tolerations
echo "=== Testing with node selector and tolerations ==="
helm template equations . \
  --set 'nodeSelector.disktype=ssd' \
  --set 'tolerations[0].key=latex-node' \
  --set 'tolerations[0].operator=Equal' \
  --set 'tolerations[0].value=true' \
  --set 'tolerations[0].effect=NoSchedule' \
  --debug
echo

# Test with common labels and annotations
echo "=== Testing with common labels and annotations ==="
helm template equations . \
  --set 'commonLabels.team=platform' \
  --set 'commonLabels.version=v1.0.0' \
  --set 'commonAnnotations.contact=platform-team@example.com' \
  --set 'commonAnnotations.documentation=https://docs.example.com/equations' \
  --debug
echo

# Test with health check customization
echo "=== Testing with custom health check configuration ==="
helm template equations . \
  --set livenessProbe.initialDelaySeconds=120 \
  --set livenessProbe.timeoutSeconds=15 \
  --set readinessProbe.periodSeconds=10 \
  --debug
echo

echo "All rendering tests completed successfully!"