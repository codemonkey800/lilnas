# ME Token Tracker Helm Chart

A Helm chart for deploying the LilNAS ME Token Tracker Discord bot to Kubernetes.

## Overview

The ME Token Tracker is a Discord bot that provides cryptocurrency token tracking and price information using the CoinGecko API. This chart deploys the bot as a containerized service in a Kubernetes cluster.

## Features

- **Discord Bot**: Slash commands for token tracking and price queries
- **CoinGecko Integration**: Real-time cryptocurrency price data
- **NestJS Backend**: Robust Node.js application framework
- **Kubernetes Native**: Designed for cloud-native deployment
- **Security Focused**: Non-root containers with read-only filesystem
- **Production Ready**: Health checks, resource limits, and monitoring

## Prerequisites

- Kubernetes cluster (1.19+)
- Helm 3.x
- kubectl configured for your cluster
- Discord bot application configured
- lilnas-apps namespace created

## Installation

### 1. Package Dependencies

```bash
# From the chart directory
helm dependency update
```

### 2. Configure Secrets

The bot requires Discord API credentials. You can provide them via:

#### Option A: Command Line Arguments

```bash
./deploy.sh \
  --api-token 'your-discord-bot-token' \
  --client-id 'your-discord-client-id' \
  --application-id 'your-discord-application-id' \
  --client-secret 'your-discord-client-secret'
```

#### Option B: Environment Variables

```bash
export ME_TOKEN_TRACKER_API_TOKEN='your-discord-bot-token'
export ME_TOKEN_TRACKER_CLIENT_ID='your-discord-client-id'
export ME_TOKEN_TRACKER_APPLICATION_ID='your-discord-application-id'
export ME_TOKEN_TRACKER_CLIENT_SECRET='your-discord-client-secret'

./deploy.sh
```

#### Option C: 1Password Integration

Store secrets in 1Password under the "ME Token Tracker" item with fields:
- `api token`
- `client id`
- `application id`
- `client secret`
- `dev guild id` (optional)
- `public key` (optional)

```bash
# Sign in to 1Password
eval $(op signin)

# Deploy (secrets will be fetched automatically)
./deploy.sh
```

### 3. Deploy

```bash
# Standard deployment
./deploy.sh

# With custom namespace
./deploy.sh -n my-namespace

# Dry run to test configuration
./deploy.sh --dry-run
```

## Configuration

### Default Values

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Container image repository | `ghcr.io/codemonkey800/lilnas-me-token-tracker` |
| `image.tag` | Container image tag | `latest` |
| `service.port` | Service port | `80` |
| `service.targetPort` | Container port | `8080` |
| `resources.requests.memory` | Memory request | `256Mi` |
| `resources.requests.cpu` | CPU request | `100m` |
| `resources.limits.memory` | Memory limit | `512Mi` |
| `resources.limits.cpu` | CPU limit | `500m` |

### Environment-Specific Values

#### Production (`values-prod.yaml`)
- Higher resource limits for reliability
- Conservative health check settings
- Network policies enabled
- Production-grade annotations

### Required Secrets

| Secret | Description | Required |
|--------|-------------|----------|
| `API_TOKEN` | Discord bot token | Yes |
| `CLIENT_ID` | Discord client ID | Yes |
| `APPLICATION_ID` | Discord application ID | Yes |
| `CLIENT_SECRET` | Discord client secret | Optional |
| `DEV_GUILD_ID` | Development guild ID | Optional |
| `PUBLIC_KEY` | Discord public key | Optional |

## Usage

### Deploy to Production

```bash
# Deploy with production values
./deploy.sh -e prod

# Deploy with specific secrets
./deploy.sh -e prod \
  --api-token 'your-token' \
  --client-id 'your-client-id' \
  --application-id 'your-app-id'
```

### Test Chart Rendering

```bash
# Test template rendering
./test-render.sh

# Test with specific environment
./test-render.sh -e prod
```

### View Logs

```bash
# Follow bot logs
kubectl logs -n lilnas-apps -l app.kubernetes.io/name=me-token-tracker -f

# Check Discord connection
kubectl logs -n lilnas-apps -l app.kubernetes.io/name=me-token-tracker | grep -i discord
```

### Health Checks

```bash
# Check bot health
kubectl exec -n lilnas-apps deployment/me-token-tracker -- curl http://localhost:8080/

# Check pod status
kubectl get pods -n lilnas-apps -l app.kubernetes.io/name=me-token-tracker
```

## Uninstallation

```bash
# Uninstall with confirmation
./uninstall.sh

# Force uninstall without confirmation
./uninstall.sh -f

# Uninstall from specific namespace
./uninstall.sh -n my-namespace
```

## Security

### Container Security
- Runs as non-root user (UID 1000)
- Read-only root filesystem
- No privileged escalation
- Minimal capabilities

### Network Security
- Network policies supported
- Egress restricted to Discord API and DNS
- No ingress (bot only, no web interface)

### Secret Management
- Kubernetes secrets for sensitive data
- 1Password integration for secret retrieval
- Environment variable fallbacks

## Monitoring

### Resource Monitoring
```bash
# Check resource usage
kubectl top pods -n lilnas-apps -l app.kubernetes.io/name=me-token-tracker

# View resource limits
kubectl describe pod -n lilnas-apps -l app.kubernetes.io/name=me-token-tracker
```

### Health Monitoring
```bash
# Check deployment status
kubectl get deployment -n lilnas-apps me-token-tracker

# View events
kubectl get events -n lilnas-apps --field-selector involvedObject.name=me-token-tracker
```

## Troubleshooting

### Common Issues

#### Bot Not Connecting to Discord
1. Check Discord token is valid
2. Verify bot permissions in Discord
3. Check logs for authentication errors

```bash
kubectl logs -n lilnas-apps -l app.kubernetes.io/name=me-token-tracker | grep -i "discord\|error"
```

#### Pod Crashes or Restarts
1. Check resource limits
2. Verify health check endpoints
3. Review application logs

```bash
kubectl describe pod -n lilnas-apps -l app.kubernetes.io/name=me-token-tracker
kubectl logs -n lilnas-apps -l app.kubernetes.io/name=me-token-tracker --previous
```

#### Secret Issues
1. Verify secret exists and has correct keys
2. Check 1Password configuration
3. Validate environment variables

```bash
kubectl get secret -n lilnas-apps -l app.kubernetes.io/name=me-token-tracker
kubectl describe secret -n lilnas-apps me-token-tracker-secrets
```

## Development

### Testing Changes
```bash
# Lint chart
helm lint .

# Test rendering
helm template me-token-tracker . -f values-prod.yaml

# Dry run deployment
helm install me-token-tracker . -f values-prod.yaml --dry-run
```

### Updating Dependencies
```bash
# Update lilnas-common library
helm dependency update

# Check dependency status
helm dependency list
```

## Support

For issues and questions:
- Check the [LilNAS documentation](https://github.com/codemonkey800/lilnas)
- Review Discord bot setup in the main repository
- File issues in the [GitHub repository](https://github.com/codemonkey800/lilnas/issues)

## License

This chart is part of the LilNAS project and follows the same licensing terms.