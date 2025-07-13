# Turbo Remote Cache

A Kubernetes deployment of [Turborepo Remote Cache](https://turbo.build/repo/docs/core-concepts/remote-caching) for accelerating builds across development environments and CI/CD pipelines.

## Overview

This deployment provides a self-hosted remote cache server for Turborepo, enabling teams to share build artifacts and dramatically reduce build times. The cache server stores build outputs in MinIO (S3-compatible storage) and provides secure access through Traefik with forward authentication.

## Features & Benefits

- **Faster Builds**: Share build artifacts across team members and CI/CD environments
- **Reduced Resource Usage**: Avoid redundant builds by reusing cached outputs
- **Scalable Storage**: Uses MinIO for reliable, S3-compatible object storage
- **Secure Access**: Protected by forward authentication and TLS encryption
- **Health Monitoring**: Built-in health checks and readiness probes
- **Resource Optimized**: Configured with appropriate CPU and memory limits

## Prerequisites

Before deploying the Turbo Remote Cache, ensure you have:

1. **Kubernetes Cluster**: A running k3s/k8s cluster with:
   - Traefik ingress controller
   - cert-manager for TLS certificates
   - lilnas-core namespace

2. **MinIO Storage**: MinIO instance running in the `lilnas-core` namespace

3. **Domain Configuration**: DNS pointing `turbo.lilnas.io` to your cluster

4. **Environment Variables**: Create `/infra/.env.turbo` with:
   ```bash
   TURBO_TOKEN=your-secure-token-here
   AWS_ACCESS_KEY_ID=your-minio-access-key
   AWS_SECRET_ACCESS_KEY=your-minio-secret-key
   ```

## Quick Start

### 1. Set Up Environment Variables

Create the environment file with your secrets:

```bash
# Create the environment file
cp /infra/.env.turbo.example /infra/.env.turbo

# Edit with your actual values
nano /infra/.env.turbo
```

Required variables:
- `TURBO_TOKEN`: Secure token for cache authentication
- `AWS_ACCESS_KEY_ID`: MinIO access key
- `AWS_SECRET_ACCESS_KEY`: MinIO secret key

### 2. Deploy the Cache Server

```bash
# Navigate to the turbo-cache directory
cd k8s/core/turbo-cache/scripts

# Make scripts executable
chmod +x *.sh

# Deploy the cache server
./deploy.sh
```

### 3. Verify Deployment

```bash
# Check deployment status
kubectl get deployment turbo-cache -n lilnas-core

# Check pod status
kubectl get pods -l app=turbo-cache -n lilnas-core

# View logs
kubectl logs -l app=turbo-cache -n lilnas-core -f
```

### 4. Test Access

```bash
# Test health endpoint
curl -k https://turbo.lilnas.io/health

# Should return: {"status":"ok"}
```

## Configuration

### Environment Variables

The deployment uses two types of configuration:

#### ConfigMap Variables (`configmap.yaml`)
- `LOG_LEVEL`: Logging level (default: "info")
- `STORAGE_PROVIDER`: Storage backend (default: "minio")
- `STORAGE_PATH`: Storage bucket path (default: "build")
- `S3_ENDPOINT`: MinIO endpoint URL

#### Secret Variables (from `.env.turbo`)
- `TURBO_TOKEN`: Authentication token for cache access
- `AWS_ACCESS_KEY_ID`: MinIO access credentials
- `AWS_SECRET_ACCESS_KEY`: MinIO secret credentials

### Resource Limits

The deployment is configured with:
- **Requests**: 128Mi memory, 100m CPU
- **Limits**: 512Mi memory, 500m CPU

Adjust these in `manifests/deployment.yaml` based on your workload requirements.

## Usage

### Configure Turborepo Client

Add the remote cache configuration to your `turbo.json`:

```json
{
  "remoteCache": {
    "enabled": true
  }
}
```

### Set Environment Variables

Configure your development environment:

```bash
# Set the cache server URL
export TURBO_API="https://turbo.lilnas.io"

# Set your authentication token
export TURBO_TOKEN="your-secure-token-here"

# Enable remote caching
export TURBO_REMOTE_CACHE_ENABLED=true
```

### Run Builds with Remote Cache

```bash
# Run with remote caching
pnpm turbo build

# Force remote cache upload
pnpm turbo build --force

# View cache statistics
pnpm turbo build --summarize
```

### CI/CD Integration

For GitHub Actions, add environment variables:

```yaml
env:
  TURBO_API: "https://turbo.lilnas.io"
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_REMOTE_CACHE_ENABLED: "true"
```

## Troubleshooting

### Common Commands

```bash
# Check deployment status
kubectl get deployment turbo-cache -n lilnas-core

# View pod logs
kubectl logs -l app=turbo-cache -n lilnas-core -f

# Check service endpoints
kubectl get endpoints turbo-cache -n lilnas-core

# Describe deployment for issues
kubectl describe deployment turbo-cache -n lilnas-core

# Check ingress configuration
kubectl get ingress turbo-cache -n lilnas-core -o yaml

# Verify secrets
kubectl get secret turbo-cache-secrets -n lilnas-core -o yaml
```

### Common Issues

#### 1. Pod Not Starting
```bash
# Check pod events
kubectl describe pod -l app=turbo-cache -n lilnas-core

# Common causes:
# - Missing secrets
# - Invalid environment variables
# - Image pull errors
```

#### 2. Cache Not Working
```bash
# Test connectivity
curl -k https://turbo.lilnas.io/health

# Check authentication
curl -k -H "Authorization: Bearer YOUR_TOKEN" https://turbo.lilnas.io/health

# Verify MinIO connectivity from pod
kubectl exec -it deployment/turbo-cache -n lilnas-core -- curl http://minio.lilnas-core:9000
```

#### 3. SSL/TLS Issues
```bash
# Check certificate status
kubectl get certificate turbo-cache-tls -n lilnas-core

# Check cert-manager logs
kubectl logs -n cert-manager deployment/cert-manager -f
```

#### 4. Permission Errors
```bash
# Check MinIO bucket permissions
# Ensure the bucket exists and access keys have read/write permissions
```

### Logs Analysis

```bash
# Real-time logs
kubectl logs -l app=turbo-cache -n lilnas-core -f

# Previous container logs (if restarted)
kubectl logs -l app=turbo-cache -n lilnas-core --previous

# All events in namespace
kubectl get events -n lilnas-core --sort-by='.lastTimestamp'
```

## Architecture

### Components

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐
│                 │    │              │    │                 │
│  Turborepo      │────▶│   Traefik    │────▶│  Turbo Cache    │
│  Client         │    │   Ingress    │    │   Server        │
│                 │    │              │    │                 │
└─────────────────┘    └──────────────┘    └─────────────────┘
                              │                        │
                              │                        │
                              ▼                        ▼
                       ┌──────────────┐    ┌─────────────────┐
                       │              │    │                 │
                       │ Forward Auth │    │     MinIO       │
                       │              │    │   S3 Storage    │
                       │              │    │                 │
                       └──────────────┘    └─────────────────┘
```

### Data Flow

1. **Client Request**: Turborepo client sends cache request to `turbo.lilnas.io`
2. **Ingress**: Traefik receives request and applies forward authentication
3. **Authentication**: Forward auth middleware validates the request
4. **Cache Server**: Request reaches the turbo-cache pod
5. **Storage**: Cache server reads/writes artifacts to MinIO storage
6. **Response**: Cache artifacts returned to client

### Network Policies

- **Ingress**: HTTPS traffic on port 443 (Traefik)
- **Service**: Internal ClusterIP on port 3000
- **Storage**: Internal communication to MinIO on port 9000

## Security Notes

### Secret Management

**⚠️ Important Security Considerations:**

1. **Environment File**: The `.env.turbo` file contains sensitive credentials
   - Never commit this file to version control
   - Ensure proper file permissions (600)
   - Rotate tokens regularly

2. **Kubernetes Secrets**: Secrets are base64 encoded but not encrypted
   - Consider using external secret management (Vault, External Secrets Operator)
   - Enable encryption at rest in etcd

3. **Token Security**: 
   - Use strong, unique tokens for `TURBO_TOKEN`
   - Rotate tokens periodically
   - Monitor access logs for suspicious activity

4. **Network Security**:
   - All traffic encrypted with TLS
   - Internal communication uses ClusterIP services
   - Forward authentication provides additional security layer

### Access Control

- **Authentication**: Required via forward auth middleware
- **Authorization**: Token-based access to cache operations
- **TLS**: End-to-end encryption with Let's Encrypt certificates

### Monitoring

- **Health Checks**: Liveness and readiness probes monitor service health
- **Resource Limits**: Prevent resource exhaustion attacks
- **Logging**: All requests logged for audit purposes

### Best Practices

1. **Regular Updates**: Keep the container image updated
2. **Backup Strategy**: Implement regular MinIO backups
3. **Monitoring**: Set up alerts for service availability
4. **Access Review**: Regularly review who has access to the cache
5. **Token Rotation**: Implement automated token rotation

## Maintenance

### Updating the Cache Server

```bash
# Update deployment with new image
kubectl set image deployment/turbo-cache turbo-cache=ducktors/turborepo-remote-cache:latest -n lilnas-core

# Monitor rollout
kubectl rollout status deployment/turbo-cache -n lilnas-core
```

### Scaling

```bash
# Scale replicas (if needed)
kubectl scale deployment turbo-cache --replicas=2 -n lilnas-core
```

### Cleanup

```bash
# Remove the deployment
cd k8s/core/turbo-cache/scripts
./cleanup.sh
```

---

For more information about Turborepo remote caching, see the [official documentation](https://turbo.build/repo/docs/core-concepts/remote-caching).