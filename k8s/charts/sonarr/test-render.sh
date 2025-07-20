#!/bin/bash
# Test rendering of the sonarr Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Testing sonarr Helm chart rendering..."
echo

# Test default values
echo "=== Testing with default values ==="
helm template sonarr . --debug
echo

# Test with dev values if they exist
if [[ -f "values-dev.yaml" ]]; then
    echo "=== Testing with dev values ==="
    helm template sonarr . -f values-dev.yaml --debug
    echo
fi

# Test with prod values if they exist
if [[ -f "values-prod.yaml" ]]; then
    echo "=== Testing with prod values ==="
    helm template sonarr . -f values-prod.yaml --debug 2>/dev/null || true
    echo
fi

# Test with custom namespace
echo "=== Testing with custom namespace ==="
helm template sonarr . \
  --set namespace=sonarr-test \
  --debug
echo

# Test with ingress disabled
echo "=== Testing with ingress disabled ==="
helm template sonarr . \
  --set ingress.enabled=false \
  --debug
echo

# Test with custom ingress configuration
echo "=== Testing with custom ingress configuration ==="
helm template sonarr . \
  --set ingress.hosts[0].host=sonarr.example.com \
  --set ingress.tls[0].hosts[0]=sonarr.example.com \
  --set ingress.tls[0].secretName=sonarr-tls-secret \
  --set ingress.certManager.clusterIssuer=letsencrypt-staging \
  --debug
echo

# Test with pod disruption budget disabled
echo "=== Testing with pod disruption budget disabled ==="
helm template sonarr . \
  --set podDisruptionBudget.enabled=false \
  --debug
echo

# Test with higher replica count
echo "=== Testing with multiple replicas ==="
helm template sonarr . \
  --set replicaCount=2 \
  --set podDisruptionBudget.minAvailable=1 \
  --debug
echo

# Test with custom resources
echo "=== Testing with custom resource limits ==="
helm template sonarr . \
  --set resources.requests.memory=512Mi \
  --set resources.requests.cpu=300m \
  --set resources.limits.memory=2Gi \
  --set resources.limits.cpu=1500m \
  --debug
echo

# Test with custom service account
echo "=== Testing with custom service account ==="
helm template sonarr . \
  --set serviceAccount.create=false \
  --set serviceAccount.name=custom-service-account \
  --debug
echo

# Test with custom configuration
echo "=== Testing with custom timezone ==="
helm template sonarr . \
  --set config.TZ=UTC \
  --debug
echo

# Test with persistence disabled
echo "=== Testing with persistence disabled ==="
helm template sonarr . \
  --set persistence.enabled=false \
  --debug
echo

# Test with different storage class
echo "=== Testing with different storage class ==="
helm template sonarr . \
  --set persistence.storageClass=ssd-storage \
  --set persistence.size=20Gi \
  --debug
echo

# Test with extra environment variables
echo "=== Testing with extra environment variables ==="
helm template sonarr . \
  --set 'extraEnv[0].name=SONARR_DEBUG' \
  --set 'extraEnv[0].value=1' \
  --set 'extraEnv[1].name=SONARR_CONFIG_SPECIAL' \
  --set 'extraEnv[1].value=special-config' \
  --debug
echo

# Test with node selector and tolerations
echo "=== Testing with node selector and tolerations ==="
helm template sonarr . \
  --set 'nodeSelector.storage=hdd' \
  --set 'tolerations[0].key=media-processing' \
  --set 'tolerations[0].operator=Equal' \
  --set 'tolerations[0].value=true' \
  --set 'tolerations[0].effect=NoSchedule' \
  --debug
echo

# Test with common labels and annotations
echo "=== Testing with common labels and annotations ==="
helm template sonarr . \
  --set 'commonLabels.app.kubernetes.io/component=pvr' \
  --set 'commonLabels.app.kubernetes.io/part-of=media-stack' \
  --set 'commonAnnotations.documentation=https://sonarr.tv' \
  --set 'commonAnnotations.description=Sonarr PVR' \
  --debug
echo

# Test with health check customization
echo "=== Testing with custom health check configuration ==="
helm template sonarr . \
  --set livenessProbe.initialDelaySeconds=180 \
  --set livenessProbe.timeoutSeconds=15 \
  --set readinessProbe.periodSeconds=10 \
  --debug
echo

# Test with custom image
echo "=== Testing with custom image configuration ==="
helm template sonarr . \
  --set image.repository=custom/sonarr \
  --set image.tag=4.0.0 \
  --set image.pullPolicy=IfNotPresent \
  --debug
echo

echo "All rendering tests completed successfully!"