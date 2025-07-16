# tdr-bot

Discord bot with AI capabilities and admin interface for the lilnas ecosystem.

## TL;DR

```bash
# Development deployment
helm install tdr-bot ./k8s/charts/tdr-bot \
  --namespace lilnas-apps \
  --create-namespace \
  -f ./k8s/charts/tdr-bot/values-dev.yaml

# Production deployment with secrets
helm install tdr-bot ./k8s/charts/tdr-bot \
  --namespace lilnas-apps \
  --create-namespace \
  -f ./k8s/charts/tdr-bot/values-prod.yaml \
  --set secrets.DISCORD_API_TOKEN='your-discord-token' \
  --set secrets.OPENAI_API_KEY='your-openai-key'
```

## Introduction

This chart deploys the TDR Discord bot on a Kubernetes cluster using the Helm package manager. The bot provides AI-powered conversational capabilities with integrations to various services including OpenAI, Tavily search, and equation rendering.

### Architecture Overview

The TDR bot is a full-stack application consisting of:

- **Backend**: NestJS API server (port 8081) with Discord bot integration
- **Frontend**: Next.js admin interface (port 8080) for bot management and monitoring
- **AI Engine**: LangChain + LangGraph for advanced conversation workflows
- **Discord Integration**: Using Discord.js and Necord for command handling
- **External APIs**: OpenAI, Tavily search, Hugging Face, and SERP API integrations
- **Storage**: MinIO integration for file storage and caching

### Key Features

- **AI Conversations**: Powered by OpenAI GPT models with LangChain/LangGraph
- **Multi-Modal Support**: Text, image generation (DALL-E), and equation rendering
- **Search Integration**: Tavily search for up-to-date information
- **Discord Commands**: Slash commands and message handling
- **Admin Interface**: Web-based management and monitoring dashboard
- **Container Management**: Docker socket access for service management (optional)
- **State Management**: Persistent conversation state with memory
- **Rate Limiting**: Built-in throttling for API calls

## Prerequisites

- Kubernetes 1.19+
- Helm 3.2.0+
- Discord bot application with API token
- OpenAI API key for AI capabilities
- MinIO or S3-compatible storage (deployed separately)
- Traefik ingress controller (or modify ingress configuration)
- **Optional**: Docker socket access for container management features

## Installing the Chart

### Basic Installation

To install the chart with the release name `tdr-bot`:

```bash
# Basic installation with defaults
helm install tdr-bot ./k8s/charts/tdr-bot

# With custom namespace
helm install tdr-bot ./k8s/charts/tdr-bot \
  --namespace lilnas-apps \
  --create-namespace

# With environment-specific values
helm install tdr-bot ./k8s/charts/tdr-bot \
  -f ./k8s/charts/tdr-bot/values-prod.yaml
```

### Production Installation

For production deployments, you must provide Discord and AI service credentials:

```bash
# Using command-line flags
helm install tdr-bot ./k8s/charts/tdr-bot \
  --namespace lilnas-apps \
  --create-namespace \
  -f ./k8s/charts/tdr-bot/values-prod.yaml \
  --set secrets.DISCORD_API_TOKEN='your-discord-token' \
  --set secrets.DISCORD_CLIENT_ID='your-discord-client-id' \
  --set secrets.OPENAI_API_KEY='your-openai-key' \
  --set secrets.TAVILY_API_KEY='your-tavily-key' \
  --set secrets.MINIO_ACCESS_KEY='your-minio-access-key' \
  --set secrets.MINIO_SECRET_KEY='your-minio-secret-key'

# Using environment variables
export TDR_DISCORD_TOKEN='your-discord-token'
export TDR_OPENAI_KEY='your-openai-key'
helm install tdr-bot ./k8s/charts/tdr-bot \
  -f ./k8s/charts/tdr-bot/values-prod.yaml \
  --set secrets.DISCORD_API_TOKEN=$TDR_DISCORD_TOKEN \
  --set secrets.OPENAI_API_KEY=$TDR_OPENAI_KEY
```

### Using External Secrets with 1Password

For secure secret management with 1Password integration:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: tdr-bot-secrets
  namespace: lilnas-apps
  annotations:
    operator.1password.io/item-vault: "kubernetes-secrets"
    operator.1password.io/item-name: "tdr-bot-secrets"
type: Opaque
stringData:
  DISCORD_API_TOKEN: "op://kubernetes-secrets/tdr-bot-secrets/discord-token"
  DISCORD_CLIENT_ID: "op://kubernetes-secrets/tdr-bot-secrets/discord-client-id"
  OPENAI_API_KEY: "op://kubernetes-secrets/tdr-bot-secrets/openai-key"
  TAVILY_API_KEY: "op://kubernetes-secrets/tdr-bot-secrets/tavily-key"
  MINIO_ACCESS_KEY: "op://kubernetes-secrets/tdr-bot-secrets/minio-access-key"
  MINIO_SECRET_KEY: "op://kubernetes-secrets/tdr-bot-secrets/minio-secret-key"
```

Then reference it in your values:

```yaml
existingSecret: 'tdr-bot-secrets'
```

## Discord Bot Setup

### Creating a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to the "Bot" section and click "Add Bot"
4. Copy the bot token (this is your `DISCORD_API_TOKEN`)
5. Copy the Application ID (this is your `DISCORD_CLIENT_ID`)
6. Enable the following bot permissions:
   - Send Messages
   - Use Slash Commands
   - Read Message History
   - Embed Links
   - Attach Files
   - Add Reactions
   - Use External Emojis

### Inviting the Bot to Your Server

Generate an invite link with the required permissions:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=326417973312&scope=bot%20applications.commands
```

Replace `YOUR_CLIENT_ID` with your actual Discord client ID.

### Guild Configuration

For development environments, you can restrict the bot to a specific guild:

```yaml
secrets:
  DISCORD_DEV_GUILD_ID: "your-guild-id"
```

## Uninstalling the Chart

To uninstall/delete the `tdr-bot` deployment:

```bash
helm delete tdr-bot -n lilnas-apps

# Also clean up any persistent resources if enabled
kubectl delete pvc -n lilnas-apps -l app.kubernetes.io/name=tdr-bot
```

## Configuration

The following table lists the configurable parameters of the tdr-bot chart and their default values.

### General Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of replicas | `1` |
| `namespace` | Kubernetes namespace | `lilnas-apps` |
| `nameOverride` | Override chart name | `""` |
| `fullnameOverride` | Override full name | `""` |

### Image Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Image repository | `ghcr.io/codemonkey800/lilnas-tdr-bot` |
| `image.tag` | Image tag (uses appVersion if not set) | `latest` |
| `image.pullPolicy` | Image pull policy | `Always` |
| `imagePullSecrets` | Image pull secrets | `[]` |

### Service Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `service.type` | Kubernetes service type | `ClusterIP` |
| `service.port` | Service port | `80` |
| `service.targetPort` | Container port | `8080` |
| `service.annotations` | Service annotations | `{}` |

### Application Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `config.FRONTEND_PORT` | Frontend server port | `8080` |
| `config.BACKEND_PORT` | Backend API port | `8081` |
| `config.DOWNLOAD_POLL_DURATION_MS` | Download polling interval | `2000` |
| `config.DOWNLOAD_POLL_RETRIES` | Download retry attempts | `50` |
| `config.TZ` | Application timezone | `America/Los_Angeles` |
| `config.NODE_ENV` | Node environment | `production` |
| `config.EQUATIONS_URL` | Equations service URL | `http://equations.lilnas-apps.svc.cluster.local:8080` |
| `config.MINIO_HOST` | MinIO host | `minio-api.lilnas-core.svc.cluster.local` |
| `config.MINIO_PORT` | MinIO port | `9000` |
| `config.MINIO_PUBLIC_URL` | MinIO public URL | `https://storage.lilnas.io` |

### Authentication and API Keys

| Parameter | Description | Default |
|-----------|-------------|---------|
| `secrets.DISCORD_API_TOKEN` | Discord bot token (⚠️ Use CLI/env vars) | `""` |
| `secrets.DISCORD_CLIENT_ID` | Discord client ID | `""` |
| `secrets.DISCORD_DEV_GUILD_ID` | Discord development guild ID | `""` |
| `secrets.OPENAI_API_KEY` | OpenAI API key (⚠️ Use CLI/env vars) | `""` |
| `secrets.TAVILY_API_KEY` | Tavily search API key | `""` |
| `secrets.HUGGING_FACE_TOKEN` | Hugging Face API token | `""` |
| `secrets.SERP_API_KEY` | SERP API key | `""` |
| `secrets.OMBI_API_KEY` | Ombi API key | `""` |
| `secrets.EQUATIONS_API_KEY` | Equations service API key | `""` |
| `secrets.MINIO_ACCESS_KEY` | MinIO access key | `""` |
| `secrets.MINIO_SECRET_KEY` | MinIO secret key | `""` |
| `existingSecret` | Use existing secret for auth | `""` |

### Docker Socket Configuration

⚠️ **Security Warning**: Docker socket access poses significant security risks.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `dockerSocket.enabled` | Enable Docker socket access | `false` |
| `dockerSocket.hostPath` | Docker socket path | `/var/run/docker.sock` |
| `rbac.create` | Create RBAC resources | `false` |

### Ingress Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.className` | Ingress class | `traefik` |
| `ingress.annotations` | Ingress annotations | See values.yaml |
| `ingress.hosts[0].host` | Hostname | `tdr.lilnas.io` |
| `ingress.hosts[0].paths` | Path configurations | `[{path: "/", pathType: "Prefix"}]` |
| `ingress.tls` | TLS configuration | Enabled with cert-manager |
| `ingress.certManager.clusterIssuer` | Cert-manager cluster issuer | `letsencrypt-prod` |

### Security Context

| Parameter | Description | Default |
|-----------|-------------|---------|
| `podSecurityContext.runAsNonRoot` | Run as non-root user | `true` |
| `podSecurityContext.runAsUser` | User ID | `1000` |
| `podSecurityContext.runAsGroup` | Group ID | `1000` |
| `podSecurityContext.fsGroup` | Filesystem group | `1000` |
| `securityContext.allowPrivilegeEscalation` | Allow privilege escalation | `false` |
| `securityContext.readOnlyRootFilesystem` | Read-only root filesystem | `true` |
| `securityContext.capabilities.drop` | Drop capabilities | `["ALL"]` |

### Resource Limits

| Parameter | Description | Default |
|-----------|-------------|---------|
| `resources.requests.memory` | Memory request | `1Gi` |
| `resources.requests.cpu` | CPU request | `500m` |
| `resources.limits.memory` | Memory limit | `2Gi` |
| `resources.limits.cpu` | CPU limit | `1000m` |

### Persistence

| Parameter | Description | Default |
|-----------|-------------|---------|
| `persistence.enabled` | Enable persistent storage | `false` |
| `persistence.storageClass` | Storage class | `hdd-storage` |
| `persistence.accessMode` | Access mode | `ReadWriteOnce` |
| `persistence.size` | Volume size | `10Gi` |
| `persistence.mountPath` | Mount path | `/app/data` |
| `persistence.annotations` | PVC annotations | `{}` |

### Volume Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `tmpVolume.enabled` | Enable tmp volume | `true` |
| `tmpVolume.sizeLimit` | Tmp volume size limit | `500Mi` |
| `cacheVolume.enabled` | Enable cache volume | `true` |
| `cacheVolume.sizeLimit` | Cache volume size limit | `1Gi` |

### Health Checks

| Parameter | Description | Default |
|-----------|-------------|---------|
| `livenessProbe.initialDelaySeconds` | Initial delay | `60` |
| `livenessProbe.periodSeconds` | Check period | `30` |
| `livenessProbe.timeoutSeconds` | Timeout | `10` |
| `readinessProbe.initialDelaySeconds` | Initial delay | `30` |
| `readinessProbe.periodSeconds` | Check period | `15` |
| `readinessProbe.timeoutSeconds` | Timeout | `5` |

### Autoscaling

| Parameter | Description | Default |
|-----------|-------------|---------|
| `autoscaling.enabled` | Enable HPA | `false` |
| `autoscaling.minReplicas` | Minimum replicas | `1` |
| `autoscaling.maxReplicas` | Maximum replicas | `3` |
| `autoscaling.targetCPUUtilizationPercentage` | Target CPU usage | `70` |
| `autoscaling.targetMemoryUtilizationPercentage` | Target memory usage | `80` |

### Network Policy

| Parameter | Description | Default |
|-----------|-------------|---------|
| `networkPolicy.enabled` | Enable network policy | `false` |
| `networkPolicy.egress` | Egress rules | `[{}]` (allow all) |

## Security Considerations

### Docker Socket Access

⚠️ **Critical Security Warning**: The tdr-bot service can be configured to access the Docker socket for container management features. This poses significant security risks:

1. **Root Privileges**: Docker socket access grants root-level privileges on the host
2. **Container Escape**: Malicious code could escape container boundaries
3. **Host Compromise**: Full access to host system resources
4. **Privilege Escalation**: Can create privileged containers

### Security Measures When Using Docker Socket

If Docker socket access is absolutely required:

1. **Disable by Default**: Keep `dockerSocket.enabled: false` unless specifically needed
2. **Network Isolation**: Use strict network policies
3. **RBAC**: Implement minimal RBAC permissions
4. **Monitoring**: Enable comprehensive audit logging
5. **Alternative**: Consider migrating to Kubernetes API calls instead

### Recommended Security Configuration

```yaml
# Disable Docker socket access
dockerSocket:
  enabled: false

# Enable strict network policies
networkPolicy:
  enabled: true
  egress:
    - to:
      - namespaceSelector:
          matchLabels:
            name: lilnas-core  # For MinIO access
      ports:
      - protocol: TCP
        port: 9000
    - to:
      - namespaceSelector:
          matchLabels:
            name: lilnas-apps  # For equations service
      ports:
      - protocol: TCP
        port: 8080
    - to:  # Allow Discord API
      - ipBlock:
          cidr: 0.0.0.0/0
      ports:
      - protocol: TCP
        port: 443
    - to:  # Allow OpenAI API
      - ipBlock:
          cidr: 0.0.0.0/0
      ports:
      - protocol: TCP
        port: 443

# Enhanced security context
podSecurityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000
  seccompProfile:
    type: RuntimeDefault

securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
    - ALL
```

### API Key Security

1. **Never commit API keys** to version control
2. **Use external secrets** (1Password, Vault, etc.)
3. **Rotate keys regularly** especially if compromised
4. **Monitor API usage** for anomalies
5. **Restrict API permissions** to minimum required

## AI/ML Service Configuration

### OpenAI Configuration

The bot uses OpenAI for various AI capabilities:

- **GPT Models**: Text generation and conversation
- **DALL-E**: Image generation
- **Embeddings**: Text similarity and search

```yaml
secrets:
  OPENAI_API_KEY: "sk-..."
```

### Tavily Search Integration

Tavily provides real-time web search capabilities:

```yaml
secrets:
  TAVILY_API_KEY: "tvly-..."
```

### Hugging Face Integration

For additional AI model access:

```yaml
secrets:
  HUGGING_FACE_TOKEN: "hf_..."
```

### SERP API Integration

For search engine result parsing:

```yaml
secrets:
  SERP_API_KEY: "..."
```

## LangChain/LangGraph Architecture

The bot uses LangChain with LangGraph for sophisticated AI workflows:

### Graph-Based Processing

The bot implements a state machine with the following nodes:

1. **Response Type Classification**: Determines conversation type
2. **Default Response**: Standard AI conversation
3. **Math Response**: LaTeX equation processing
4. **Image Response**: DALL-E image generation
5. **Tool Integration**: External API calls and searches

### Memory Management

The bot maintains conversation state across interactions:

- **Message History**: Persistent conversation memory
- **Context Window**: Sliding window for long conversations
- **State Persistence**: Conversation state stored in database

### Tool Integration

Available tools include:

- **Date/Time**: Current date and time information
- **Web Search**: Tavily search integration
- **Equation Rendering**: LaTeX equation processing
- **Image Generation**: DALL-E integration
- **File Storage**: MinIO integration

## Troubleshooting Guide

### Common Issues

1. **Bot not responding to Discord messages**:
   ```bash
   # Check bot status
   kubectl get pods -n lilnas-apps -l app.kubernetes.io/name=tdr-bot
   
   # View bot logs
   kubectl logs -n lilnas-apps -l app.kubernetes.io/name=tdr-bot
   
   # Check Discord API connectivity
   kubectl exec -n lilnas-apps deploy/tdr-bot -- curl -I https://discord.com/api/v10/gateway
   ```

2. **AI responses not working**:
   ```bash
   # Verify OpenAI API key
   kubectl get secret -n lilnas-apps tdr-bot -o yaml | grep OPENAI_API_KEY
   
   # Test OpenAI API connectivity
   kubectl exec -n lilnas-apps deploy/tdr-bot -- curl -I https://api.openai.com/v1/models
   
   # Check AI service logs
   kubectl logs -n lilnas-apps -l app.kubernetes.io/name=tdr-bot | grep -i openai
   ```

3. **Admin interface not accessible**:
   ```bash
   # Check ingress status
   kubectl get ingress -n lilnas-apps tdr-bot
   
   # Verify TLS certificate
   kubectl describe certificate -n lilnas-apps tdr-lilnas-io-tls
   
   # Port-forward for local access
   kubectl port-forward -n lilnas-apps svc/tdr-bot 8080:80
   ```

4. **High memory usage**:
   ```bash
   # Check resource usage
   kubectl top pod -n lilnas-apps -l app.kubernetes.io/name=tdr-bot
   
   # View memory metrics
   kubectl describe pod -n lilnas-apps -l app.kubernetes.io/name=tdr-bot | grep -A5 -B5 memory
   
   # Check for memory leaks
   kubectl exec -n lilnas-apps deploy/tdr-bot -- node --expose-gc -e "global.gc(); console.log(process.memoryUsage())"
   ```

5. **Docker socket issues** (if enabled):
   ```bash
   # Check Docker socket mount
   kubectl describe pod -n lilnas-apps -l app.kubernetes.io/name=tdr-bot | grep -A10 -B5 docker.sock
   
   # Test Docker API access
   kubectl exec -n lilnas-apps deploy/tdr-bot -- curl -s --unix-socket /var/run/docker.sock http://localhost/version
   
   # Check RBAC permissions
   kubectl auth can-i --list --as=system:serviceaccount:lilnas-apps:tdr-bot
   ```

### Debug Commands

```bash
# Access bot container
kubectl exec -it -n lilnas-apps deploy/tdr-bot -- /bin/bash

# Check environment variables
kubectl exec -n lilnas-apps deploy/tdr-bot -- env | grep -E '(DISCORD|OPENAI|TAVILY)'

# Test Discord API
kubectl exec -n lilnas-apps deploy/tdr-bot -- curl -H "Authorization: Bot $DISCORD_API_TOKEN" https://discord.com/api/v10/users/@me

# Test OpenAI API
kubectl exec -n lilnas-apps deploy/tdr-bot -- curl -H "Authorization: Bearer $OPENAI_API_KEY" https://api.openai.com/v1/models

# View conversation state
kubectl exec -n lilnas-apps deploy/tdr-bot -- ls -la /app/data

# Check LangChain logs
kubectl logs -n lilnas-apps -l app.kubernetes.io/name=tdr-bot | grep -i langchain
```

## Monitoring and Observability

### Metrics to Monitor

1. **Application Metrics**:
   - Discord message processing rate
   - AI API response times
   - Error rates by service
   - Memory usage patterns
   - Conversation state size

2. **External API Metrics**:
   - OpenAI API latency and errors
   - Discord API rate limits
   - Tavily search success rates
   - MinIO storage usage

3. **Resource Metrics**:
   - CPU usage during AI processing
   - Memory consumption trends
   - Network bandwidth for API calls
   - Storage usage for conversation state

### Logging Configuration

```yaml
# Enhanced logging for debugging
extraEnv:
  - name: LOG_LEVEL
    value: "debug"
  - name: LANGCHAIN_VERBOSE
    value: "true"
  - name: DISCORD_DEBUG
    value: "true"
```

### Health Monitoring

The bot exposes health endpoints:

- `GET /` - Basic health check
- `GET /health` - Detailed health status
- `GET /metrics` - Prometheus metrics (if enabled)

### Alerting Rules

Recommended alerts:

```yaml
# High error rate
- alert: TDRBotHighErrorRate
  expr: rate(tdr_bot_errors_total[5m]) > 0.1
  for: 5m

# OpenAI API failures
- alert: TDRBotOpenAIFailures
  expr: rate(tdr_bot_openai_failures_total[5m]) > 0.05
  for: 2m

# Discord API rate limiting
- alert: TDRBotDiscordRateLimit
  expr: tdr_bot_discord_rate_limited > 0
  for: 1m
```

## Examples for Common Deployment Scenarios

### Development Setup

```bash
# Deploy with minimal resources and debug logging
helm install tdr-bot-dev ./k8s/charts/tdr-bot \
  --namespace lilnas-dev \
  --create-namespace \
  -f ./k8s/charts/tdr-bot/values-dev.yaml \
  --set resources.limits.memory=1Gi \
  --set resources.limits.cpu=500m \
  --set extraEnv[0].name=LOG_LEVEL \
  --set extraEnv[0].value=debug \
  --set secrets.DISCORD_API_TOKEN='your-dev-token' \
  --set secrets.OPENAI_API_KEY='your-openai-key'
```

### Production High-Availability

```yaml
# values-ha.yaml
replicaCount: 2

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 5
  targetCPUUtilizationPercentage: 60
  targetMemoryUtilizationPercentage: 70

podDisruptionBudget:
  enabled: true
  minAvailable: 1

resources:
  requests:
    memory: "2Gi"
    cpu: "1000m"
  limits:
    memory: "4Gi"
    cpu: "2000m"

affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        labelSelector:
          matchLabels:
            app.kubernetes.io/name: tdr-bot
        topologyKey: kubernetes.io/hostname
```

### Resource-Constrained Environment

```yaml
# values-small.yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "1Gi"
    cpu: "500m"

persistence:
  enabled: false

tmpVolume:
  sizeLimit: 100Mi

cacheVolume:
  sizeLimit: 200Mi

autoscaling:
  enabled: false
```

### Multi-Region Deployment

```yaml
# values-region-us.yaml
nodeSelector:
  region: us-west-2
  
config:
  TZ: "America/Los_Angeles"
  MINIO_PUBLIC_URL: "https://storage-us.lilnas.io"

affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
      - matchExpressions:
        - key: topology.kubernetes.io/region
          operator: In
          values:
          - us-west-2
```

## Integration with CI/CD

### GitOps with ArgoCD

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: tdr-bot
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/codemonkey800/lilnas
    targetRevision: main
    path: k8s/charts/tdr-bot
    helm:
      valueFiles:
      - values-prod.yaml
      parameters:
      - name: secrets.DISCORD_API_TOKEN
        value: $DISCORD_API_TOKEN
      - name: secrets.OPENAI_API_KEY
        value: $OPENAI_API_KEY
  destination:
    server: https://kubernetes.default.svc
    namespace: lilnas-apps
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

### GitHub Actions Deployment

```yaml
- name: Deploy TDR Bot
  run: |
    helm upgrade --install tdr-bot ./k8s/charts/tdr-bot \
      --namespace lilnas-apps \
      --create-namespace \
      -f ./k8s/charts/tdr-bot/values-prod.yaml \
      --set secrets.DISCORD_API_TOKEN=${{ secrets.DISCORD_API_TOKEN }} \
      --set secrets.OPENAI_API_KEY=${{ secrets.OPENAI_API_KEY }} \
      --set secrets.TAVILY_API_KEY=${{ secrets.TAVILY_API_KEY }} \
      --set image.tag=${{ github.sha }} \
      --wait --timeout 15m
```

## Maintenance

### Regular Tasks

1. **Update API Keys**: Rotate Discord and OpenAI keys regularly
2. **Monitor Costs**: Track OpenAI API usage and costs
3. **Clean Logs**: Implement log rotation and cleanup
4. **Update Dependencies**: Keep Docker images updated
5. **Review Conversations**: Monitor bot interactions for issues

### Backup Considerations

If persistence is enabled:

```bash
# Backup conversation data
kubectl exec -n lilnas-apps deploy/tdr-bot -- tar -czf /tmp/backup.tar.gz /app/data
kubectl cp lilnas-apps/tdr-bot-xxx:/tmp/backup.tar.gz ./tdr-bot-backup.tar.gz

# Restore conversation data
kubectl cp ./tdr-bot-backup.tar.gz lilnas-apps/tdr-bot-xxx:/tmp/backup.tar.gz
kubectl exec -n lilnas-apps deploy/tdr-bot -- tar -xzf /tmp/backup.tar.gz -C /
```

### Performance Optimization

1. **Resource Tuning**: Adjust CPU/memory based on usage patterns
2. **API Caching**: Implement response caching for frequent queries
3. **Model Selection**: Use appropriate OpenAI models for different tasks
4. **Batch Processing**: Group API calls where possible
5. **Connection Pooling**: Optimize database and API connections

## Support and Contributing

For issues, feature requests, or contributions, please visit the [lilnas GitHub repository](https://github.com/codemonkey800/lilnas).

### Useful Links

- [Discord.js Documentation](https://discord.js.org/)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [LangChain Documentation](https://js.langchain.com/)
- [Tavily Search Documentation](https://tavily.com/docs)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Helm Documentation](https://helm.sh/docs/)

### Bot Commands

Common Discord commands (configure in Discord settings):

- `/chat <message>` - AI conversation
- `/image <prompt>` - Generate image with DALL-E
- `/search <query>` - Web search with Tavily
- `/equation <latex>` - Render LaTeX equation
- `/status` - Bot status and health