#!/bin/bash
# Test rendering of the tdr-bot Helm chart

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Testing tdr-bot Helm chart rendering..."
echo

# Test default values
echo "=== Testing with default values ==="
helm template tdr-bot . --debug
echo

# Test with dev values
echo "=== Testing with dev values ==="
helm template tdr-bot . -f values-dev.yaml --debug
echo

# Test with prod values (without secrets)
echo "=== Testing with prod values (without secrets) ==="
helm template tdr-bot . -f values-prod.yaml --debug 2>/dev/null || true
echo

# Test with prod values and all secrets
echo "=== Testing with prod values and all secrets ==="
helm template tdr-bot . -f values-prod.yaml \
  --set secrets.DISCORD_API_TOKEN=test-discord-token \
  --set secrets.DISCORD_CLIENT_ID=test-client-id \
  --set secrets.DISCORD_DEV_GUILD_ID=test-guild-id \
  --set secrets.OPENAI_API_KEY=test-openai-key \
  --set secrets.TAVILY_API_KEY=test-tavily-key \
  --set secrets.HUGGING_FACE_TOKEN=test-hf-token \
  --set secrets.SERP_API_KEY=test-serp-key \
  --set secrets.OMBI_API_KEY=test-ombi-key \
  --set secrets.EQUATIONS_API_KEY=test-equations-key \
  --set secrets.MINIO_ACCESS_KEY=test-minio-access \
  --set secrets.MINIO_SECRET_KEY=test-minio-secret \
  --debug
echo

# Test with minimal required secrets
echo "=== Testing with minimal required secrets ==="
helm template tdr-bot . \
  --set secrets.DISCORD_API_TOKEN=test-discord-token \
  --set secrets.DISCORD_CLIENT_ID=test-client-id \
  --set secrets.OPENAI_API_KEY=test-openai-key \
  --set secrets.MINIO_ACCESS_KEY=test-minio-access \
  --set secrets.MINIO_SECRET_KEY=test-minio-secret \
  --debug
echo

# Test with existing secret
echo "=== Testing with existing secret ==="
helm template tdr-bot . \
  --set existingSecret=my-existing-secret \
  --debug
echo

# Test with custom Discord configuration
echo "=== Testing with custom Discord configuration ==="
helm template tdr-bot . \
  --set secrets.DISCORD_API_TOKEN=custom-discord-token \
  --set secrets.DISCORD_CLIENT_ID=custom-client-id \
  --set secrets.DISCORD_DEV_GUILD_ID=custom-guild-id \
  --debug
echo

# Test with AI/ML configuration
echo "=== Testing with AI/ML configuration ==="
helm template tdr-bot . \
  --set secrets.OPENAI_API_KEY=custom-openai-key \
  --set secrets.TAVILY_API_KEY=custom-tavily-key \
  --set secrets.HUGGING_FACE_TOKEN=custom-hf-token \
  --set secrets.SERP_API_KEY=custom-serp-key \
  --debug
echo

# Test with custom service configuration
echo "=== Testing with custom service configuration ==="
helm template tdr-bot . \
  --set config.FRONTEND_PORT=3000 \
  --set config.BACKEND_PORT=3001 \
  --set service.port=3000 \
  --set service.targetPort=3000 \
  --debug
echo

# Test with custom MinIO configuration
echo "=== Testing with custom MinIO configuration ==="
helm template tdr-bot . \
  --set config.MINIO_HOST=custom-minio.example.com \
  --set config.MINIO_PORT=9001 \
  --set config.MINIO_PUBLIC_URL=https://storage.example.com \
  --set secrets.MINIO_ACCESS_KEY=custom-access-key \
  --set secrets.MINIO_SECRET_KEY=custom-secret-key \
  --debug
echo

# Test with ingress disabled
echo "=== Testing with ingress disabled ==="
helm template tdr-bot . \
  --set ingress.enabled=false \
  --debug
echo

# Test with custom ingress configuration
echo "=== Testing with custom ingress configuration ==="
helm template tdr-bot . \
  --set ingress.hosts[0].host=tdr.example.com \
  --set ingress.tls[0].hosts[0]=tdr.example.com \
  --set ingress.tls[0].secretName=custom-tls-secret \
  --set ingress.certManager.clusterIssuer=letsencrypt-staging \
  --debug
echo

# Test with Docker socket enabled (security risk)
echo "=== Testing with Docker socket enabled ==="
helm template tdr-bot . \
  --set dockerSocket.enabled=true \
  --set rbac.create=true \
  --debug
echo

# Test with pod disruption budget disabled
echo "=== Testing with pod disruption budget disabled ==="
helm template tdr-bot . \
  --set podDisruptionBudget.enabled=false \
  --debug
echo

# Test with autoscaling enabled
echo "=== Testing with autoscaling enabled ==="
helm template tdr-bot . \
  --set autoscaling.enabled=true \
  --set autoscaling.minReplicas=2 \
  --set autoscaling.maxReplicas=5 \
  --set autoscaling.targetCPUUtilizationPercentage=60 \
  --debug
echo

# Test with higher replica count
echo "=== Testing with multiple replicas ==="
helm template tdr-bot . \
  --set replicaCount=3 \
  --set podDisruptionBudget.minAvailable=2 \
  --debug
echo

# Test with custom resource limits for AI workloads
echo "=== Testing with custom AI workload resources ==="
helm template tdr-bot . \
  --set resources.requests.memory=2Gi \
  --set resources.requests.cpu=1000m \
  --set resources.limits.memory=4Gi \
  --set resources.limits.cpu=2000m \
  --debug
echo

# Test with custom service account
echo "=== Testing with custom service account ==="
helm template tdr-bot . \
  --set serviceAccount.create=false \
  --set serviceAccount.name=custom-service-account \
  --debug
echo

# Test with extra environment variables
echo "=== Testing with extra environment variables ==="
helm template tdr-bot . \
  --set 'extraEnv[0].name=CUSTOM_VAR' \
  --set 'extraEnv[0].value=custom-value' \
  --set 'extraEnv[1].name=BOT_DEBUG' \
  --set 'extraEnv[1].value=true' \
  --set 'extraEnv[2].name=AI_TIMEOUT' \
  --set 'extraEnv[2].value=30000' \
  --debug
echo

# Test with node selector and tolerations
echo "=== Testing with node selector and tolerations ==="
helm template tdr-bot . \
  --set 'nodeSelector.bot=true' \
  --set 'nodeSelector.gpu=available' \
  --set 'tolerations[0].key=bot-node' \
  --set 'tolerations[0].operator=Equal' \
  --set 'tolerations[0].value=true' \
  --set 'tolerations[0].effect=NoSchedule' \
  --debug
echo

# Test with common labels and annotations
echo "=== Testing with common labels and annotations ==="
helm template tdr-bot . \
  --set 'commonLabels.team=ai' \
  --set 'commonLabels.version=v2.0.0' \
  --set 'commonLabels.bot-type=discord' \
  --set 'commonAnnotations.contact=ai-team@example.com' \
  --set 'commonAnnotations.documentation=https://docs.example.com/tdr-bot' \
  --debug
echo

# Test with health check customization
echo "=== Testing with custom health check configuration ==="
helm template tdr-bot . \
  --set livenessProbe.initialDelaySeconds=120 \
  --set livenessProbe.timeoutSeconds=15 \
  --set livenessProbe.periodSeconds=45 \
  --set readinessProbe.initialDelaySeconds=60 \
  --set readinessProbe.periodSeconds=10 \
  --debug
echo

# Test with persistence enabled
echo "=== Testing with persistence enabled ==="
helm template tdr-bot . \
  --set persistence.enabled=true \
  --set persistence.size=20Gi \
  --set persistence.storageClass=fast-ssd \
  --debug
echo

# Test with custom timezone and polling configuration
echo "=== Testing with custom timezone and polling configuration ==="
helm template tdr-bot . \
  --set config.TZ=UTC \
  --set config.DOWNLOAD_POLL_DURATION_MS=5000 \
  --set config.DOWNLOAD_POLL_RETRIES=100 \
  --debug
echo

# Test with development environment variables
echo "=== Testing with development environment variables ==="
helm template tdr-bot . \
  --set config.NODE_ENV=development \
  --set config.EQUATIONS_URL=http://equations.localhost \
  --set config.MINIO_PUBLIC_URL=http://storage.localhost \
  --debug
echo

# Test with network policy enabled
echo "=== Testing with network policy enabled ==="
helm template tdr-bot . \
  --set networkPolicy.enabled=true \
  --debug
echo

# Test with custom volume configurations
echo "=== Testing with custom volume configurations ==="
helm template tdr-bot . \
  --set tmpVolume.enabled=true \
  --set tmpVolume.sizeLimit=1Gi \
  --set cacheVolume.enabled=true \
  --set cacheVolume.sizeLimit=2Gi \
  --debug
echo

# Test with init containers
echo "=== Testing with init containers ==="
helm template tdr-bot . \
  --set 'initContainers[0].name=wait-for-deps' \
  --set 'initContainers[0].image=busybox:1.35' \
  --set 'initContainers[0].command[0]=sh' \
  --set 'initContainers[0].command[1]=-c' \
  --set 'initContainers[0].command[2]=until nslookup minio-api.lilnas-core.svc.cluster.local; do sleep 1; done' \
  --debug
echo

# Test with extra environment from ConfigMap/Secret
echo "=== Testing with extra environment from ConfigMap/Secret ==="
helm template tdr-bot . \
  --set 'extraEnvFrom[0].configMapRef.name=tdr-bot-extra-config' \
  --set 'extraEnvFrom[1].secretRef.name=tdr-bot-extra-secrets' \
  --debug
echo

# Test with security context customization
echo "=== Testing with security context customization ==="
helm template tdr-bot . \
  --set podSecurityContext.runAsUser=2000 \
  --set podSecurityContext.runAsGroup=2000 \
  --set podSecurityContext.fsGroup=2000 \
  --set securityContext.readOnlyRootFilesystem=false \
  --debug
echo

# Test with affinity configuration
echo "=== Testing with affinity configuration ==="
helm template tdr-bot . \
  --set 'affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution[0].labelSelector.matchExpressions[0].key=app.kubernetes.io/name' \
  --set 'affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution[0].labelSelector.matchExpressions[0].operator=In' \
  --set 'affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution[0].labelSelector.matchExpressions[0].values[0]=tdr-bot' \
  --set 'affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution[0].topologyKey=kubernetes.io/hostname' \
  --debug
echo

echo "All rendering tests completed successfully!"