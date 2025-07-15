# download

Video download service with web UI for the lilnas ecosystem.

## TL;DR

```bash
# Development deployment
helm install download ./k8s/charts/download \
  --namespace lilnas-apps \
  --create-namespace \
  -f ./k8s/charts/download/values-dev.yaml

# Production deployment with secrets
helm install download ./k8s/charts/download \
  --namespace lilnas-apps \
  --create-namespace \
  -f ./k8s/charts/download/values-prod.yaml \
  --set auth.minioAccessKey='your-access-key' \
  --set auth.minioSecretKey='your-secret-key'
```

## Introduction

This chart deploys a video download service on a Kubernetes cluster using the Helm package manager. The service provides a web interface and API for downloading videos using yt-dlp and ffmpeg, with MinIO integration for storing downloaded content.

### Architecture Overview

The download service is a full-stack application consisting of:

- **Backend**: NestJS API server (port 8081) handling download requests and video processing
- **Frontend**: Next.js web interface (port 8080) for user interaction
- **Video Processing**: Uses yt-dlp for downloading and ffmpeg for video processing
- **Storage**: MinIO integration for persistent video storage
- **Security**: Implements input validation, rate limiting, and secure execution patterns

## Prerequisites

- Kubernetes 1.19+
- Helm 3.2.0+
- MinIO or S3-compatible storage (deployed separately)
- Storage class for persistent volumes (default: `hdd-storage`)
- Internet connectivity for downloading videos
- Traefik ingress controller (or modify ingress configuration)

## Installing the Chart

### Basic Installation

To install the chart with the release name `download`:

```bash
# Basic installation with defaults
helm install download ./k8s/charts/download

# With custom namespace
helm install download ./k8s/charts/download \
  --namespace lilnas-apps \
  --create-namespace

# With environment-specific values
helm install download ./k8s/charts/download \
  -f ./k8s/charts/download/values-prod.yaml
```

### Production Installation

For production deployments, you must provide MinIO credentials:

```bash
# Using command-line flags
helm install download ./k8s/charts/download \
  --namespace lilnas-apps \
  --create-namespace \
  -f ./k8s/charts/download/values-prod.yaml \
  --set auth.minioAccessKey='your-access-key' \
  --set auth.minioSecretKey='your-secret-key'

# Using environment variables
export DOWNLOAD_MINIO_ACCESS_KEY='your-access-key'
export DOWNLOAD_MINIO_SECRET_KEY='your-secret-key'
helm install download ./k8s/charts/download \
  -f ./k8s/charts/download/values-prod.yaml \
  --set auth.minioAccessKey=$DOWNLOAD_MINIO_ACCESS_KEY \
  --set auth.minioSecretKey=$DOWNLOAD_MINIO_SECRET_KEY
```

### Using External Secrets

If you prefer to manage secrets externally, create a secret with the following keys:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: download-secrets
  namespace: lilnas-apps
type: Opaque
stringData:
  MINIO_ACCESS_KEY: "your-access-key"
  MINIO_SECRET_KEY: "your-secret-key"
```

Then reference it in your values:

```yaml
existingSecret: 'download-secrets'
```

## Uninstalling the Chart

To uninstall/delete the `download` deployment:

```bash
helm delete download -n lilnas-apps

# Also delete persistent volume claim if needed
kubectl delete pvc -n lilnas-apps -l app.kubernetes.io/name=download
```

## Configuration

The following table lists the configurable parameters of the download chart and their default values.

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
| `image.repository` | Image repository | `ghcr.io/codemonkey800/lilnas-download` |
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
| `config.frontendPort` | Frontend server port | `8080` |
| `config.backendPort` | Backend API port | `8081` |
| `config.maxDownloads` | Maximum concurrent downloads | `5` |
| `config.timezone` | Application timezone | `America/Los_Angeles` |
| `config.minioHost` | MinIO host | `minio-api.lilnas-core` |
| `config.minioPort` | MinIO port | `9000` |
| `config.minioPublicUrl` | MinIO public URL | `https://storage.lilnas.io` |
| `config.nodeEnv` | Node environment | `production` |

### Authentication

| Parameter | Description | Default |
|-----------|-------------|---------|
| `auth.minioAccessKey` | MinIO access key (⚠️ Use CLI/env vars) | `""` |
| `auth.minioSecretKey` | MinIO secret key (⚠️ Use CLI/env vars) | `""` |
| `existingSecret` | Use existing secret for auth | `""` |

### Ingress Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.className` | Ingress class | `traefik` |
| `ingress.annotations` | Ingress annotations | See values.yaml |
| `ingress.hosts[0].host` | Hostname | `download.lilnas.io` |
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
| `resources.requests.memory` | Memory request | `512Mi` |
| `resources.requests.cpu` | CPU request | `500m` |
| `resources.limits.memory` | Memory limit | `2Gi` |
| `resources.limits.cpu` | CPU limit | `2000m` |

### Persistence

| Parameter | Description | Default |
|-----------|-------------|---------|
| `persistence.enabled` | Enable persistent storage | `true` |
| `persistence.storageClass` | Storage class | `hdd-storage` |
| `persistence.accessMode` | Access mode | `ReadWriteOnce` |
| `persistence.size` | Volume size | `100Gi` |
| `persistence.mountPath` | Mount path | `/download/videos` |
| `persistence.annotations` | PVC annotations | `{}` |

### Volume Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `tmpVolume.enabled` | Enable tmp volume | `true` |
| `tmpVolume.sizeLimit` | Tmp volume size limit | `1Gi` |
| `cacheVolume.enabled` | Enable cache volume | `true` |
| `cacheVolume.sizeLimit` | Cache volume size limit | `2Gi` |

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

### execSync and Command Execution

**⚠️ Important Security Notice**: This service uses `execSync` and `spawn` to execute yt-dlp and ffmpeg commands. While necessary for video processing functionality, this poses potential security risks:

1. **Command Injection**: The service must carefully validate and sanitize all user inputs to prevent command injection attacks
2. **Resource Consumption**: Video processing can be resource-intensive; proper limits must be enforced
3. **Network Access**: The service requires unrestricted internet access to download videos from various sources

### Security Measures Implemented

1. **Non-root User**: Container runs as UID 1000 (non-root)
2. **Read-only Root Filesystem**: Prevents unauthorized file system modifications
3. **Capability Dropping**: All Linux capabilities are dropped
4. **Resource Limits**: CPU and memory limits prevent resource exhaustion
5. **Temporary Storage**: Uses emptyDir volumes for temporary files
6. **Input Validation**: Service should validate URLs and parameters (verify in application code)

### Recommended Security Enhancements

1. **Network Policies**: Enable network policies in production:
   ```yaml
   networkPolicy:
     enabled: true
     egress:
       - to:
         - namespaceSelector:
             matchLabels:
               name: lilnas-core  # For MinIO access
       - to:
         - ipBlock:
             cidr: 0.0.0.0/0
             except:
               - 10.0.0.0/8     # Block internal networks
               - 172.16.0.0/12
               - 192.168.0.0/16
   ```

2. **Pod Security Standards**: Apply restricted pod security standards:
   ```yaml
   podSecurityContext:
     seccompProfile:
       type: RuntimeDefault
     runAsNonRoot: true
     runAsUser: 1000
     fsGroup: 1000
   ```

3. **Resource Quotas**: Set namespace resource quotas to prevent abuse
4. **Rate Limiting**: Implement application-level rate limiting
5. **Audit Logging**: Enable audit logging for download activities

## MinIO Integration Details

The service integrates with MinIO for storing downloaded videos:

1. **Bucket Creation**: Ensure the download bucket exists in MinIO
2. **Access Permissions**: Service account needs read/write access to the bucket
3. **Public Access**: Configure MinIO policies for public URL access if needed
4. **Storage Lifecycle**: Implement lifecycle policies to manage old downloads

### MinIO Configuration Example

```bash
# Create bucket
mc mb minio/downloads

# Set bucket policy for public read access (if desired)
mc policy set download minio/downloads

# Configure lifecycle to delete old files
mc ilm add --expiry-days 30 minio/downloads
```

## Persistent Storage Configuration

The service uses persistent volumes for storing downloaded videos:

1. **Storage Class**: Uses `hdd-storage` by default (suitable for large video files)
2. **Access Mode**: `ReadWriteOnce` - single node access
3. **Size Recommendations**:
   - Development: 100Gi
   - Production: 500Gi or more based on usage
4. **Backup Strategy**: Implement regular backups of the PVC

### Custom Storage Configuration

```yaml
persistence:
  enabled: true
  storageClass: "fast-ssd"  # Use SSD for better performance
  size: 1Ti                 # Increase size for heavy usage
  annotations:
    volume.beta.kubernetes.io/storage-class: "fast-ssd"
```

## Network Policy Recommendations

For production environments, implement strict network policies:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: download-network-policy
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: download
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: traefik-system  # Allow Traefik
    ports:
    - protocol: TCP
      port: 8080
  egress:
  - to:  # Allow MinIO access
    - namespaceSelector:
        matchLabels:
          name: lilnas-core
    ports:
    - protocol: TCP
      port: 9000
  - to:  # Allow DNS
    - namespaceSelector: {}
    ports:
    - protocol: UDP
      port: 53
  - to:  # Allow HTTPS for downloads
    - ipBlock:
        cidr: 0.0.0.0/0
    ports:
    - protocol: TCP
      port: 443
    - protocol: TCP
      port: 80
```

## Troubleshooting Guide

### Common Issues

1. **Pod not starting**:
   ```bash
   # Check pod status
   kubectl get pods -n lilnas-apps -l app.kubernetes.io/name=download
   
   # View pod events
   kubectl describe pod -n lilnas-apps -l app.kubernetes.io/name=download
   
   # Check logs
   kubectl logs -n lilnas-apps -l app.kubernetes.io/name=download
   ```

2. **MinIO connection failures**:
   ```bash
   # Verify MinIO credentials
   kubectl get secret -n lilnas-apps download -o yaml
   
   # Test MinIO connectivity from pod
   kubectl exec -n lilnas-apps deploy/download -- curl -I http://minio-api.lilnas-core:9000
   
   # Check MinIO access logs
   kubectl logs -n lilnas-core -l app=minio
   ```

3. **Download failures**:
   ```bash
   # Check yt-dlp installation
   kubectl exec -n lilnas-apps deploy/download -- /usr/bin/yt-dlp --version
   
   # Check ffmpeg installation
   kubectl exec -n lilnas-apps deploy/download -- ffmpeg -version
   
   # View download logs
   kubectl logs -n lilnas-apps -l app.kubernetes.io/name=download -f | grep -i download
   ```

4. **Storage issues**:
   ```bash
   # Check PVC status
   kubectl get pvc -n lilnas-apps -l app.kubernetes.io/name=download
   
   # Check disk usage
   kubectl exec -n lilnas-apps deploy/download -- df -h /download/videos
   
   # List downloaded files
   kubectl exec -n lilnas-apps deploy/download -- ls -la /download/videos
   ```

5. **Performance issues**:
   ```bash
   # Check resource usage
   kubectl top pod -n lilnas-apps -l app.kubernetes.io/name=download
   
   # View HPA status (if enabled)
   kubectl get hpa -n lilnas-apps download
   
   # Check for throttling
   kubectl describe pod -n lilnas-apps -l app.kubernetes.io/name=download | grep -i throttling
   ```

### Debug Commands

```bash
# Port-forward for local testing
kubectl port-forward -n lilnas-apps svc/download 8080:80

# Access the service locally
curl http://localhost:8080

# Execute commands in the container
kubectl exec -it -n lilnas-apps deploy/download -- /bin/bash

# Test download functionality
kubectl exec -n lilnas-apps deploy/download -- \
  /usr/bin/yt-dlp --dump-json "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Check environment variables
kubectl exec -n lilnas-apps deploy/download -- env | grep -E '(MINIO|DOWNLOAD)'
```

## Monitoring and Observability Recommendations

### Metrics to Monitor

1. **Application Metrics**:
   - Active download count
   - Download success/failure rate
   - Average download duration
   - Storage usage trends

2. **Resource Metrics**:
   - CPU usage per download
   - Memory consumption
   - Network bandwidth usage
   - Disk I/O patterns

3. **Service Health**:
   - Response time for web interface
   - API endpoint availability
   - Queue depth (if using job queue)

### Recommended Monitoring Stack

```yaml
# Prometheus ServiceMonitor example
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: download-metrics
  namespace: lilnas-apps
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: download
  endpoints:
  - port: http
    path: /metrics
    interval: 30s
```

### Logging Configuration

```yaml
# Enhanced logging configuration
extraEnv:
  - name: LOG_LEVEL
    value: "info"
  - name: LOG_FORMAT
    value: "json"
  - name: ENABLE_ACCESS_LOGS
    value: "true"
```

## Examples for Common Deployment Scenarios

### Development Setup

```bash
# Deploy with minimal resources
helm install download-dev ./k8s/charts/download \
  --namespace lilnas-dev \
  --create-namespace \
  -f ./k8s/charts/download/values-dev.yaml \
  --set persistence.size=50Gi \
  --set resources.limits.memory=1Gi
```

### High-Availability Production

```yaml
# values-ha.yaml
replicaCount: 3

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10

podDisruptionBudget:
  enabled: true
  minAvailable: 2

affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        labelSelector:
          matchLabels:
            app.kubernetes.io/name: download
        topologyKey: kubernetes.io/hostname
```

### Resource-Constrained Environment

```yaml
# values-small.yaml
resources:
  requests:
    memory: "256Mi"
    cpu: "250m"
  limits:
    memory: "512Mi"
    cpu: "500m"

persistence:
  size: 20Gi

config:
  maxDownloads: "2"

autoscaling:
  enabled: false
```

### Multi-Region Deployment

```yaml
# values-region-us.yaml
nodeSelector:
  region: us-west-2

persistence:
  storageClass: "ebs-gp3"

config:
  minioHost: "minio-us-west.lilnas-core"
  timezone: "America/Los_Angeles"
```

## Integration with CI/CD

### GitOps with ArgoCD

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: download
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/codemonkey800/lilnas
    targetRevision: main
    path: k8s/charts/download
    helm:
      valueFiles:
      - values-prod.yaml
      parameters:
      - name: auth.minioAccessKey
        value: $MINIO_ACCESS_KEY
      - name: auth.minioSecretKey
        value: $MINIO_SECRET_KEY
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
- name: Deploy Download Service
  run: |
    helm upgrade --install download ./k8s/charts/download \
      --namespace lilnas-apps \
      --create-namespace \
      -f ./k8s/charts/download/values-prod.yaml \
      --set auth.minioAccessKey=${{ secrets.MINIO_ACCESS_KEY }} \
      --set auth.minioSecretKey=${{ secrets.MINIO_SECRET_KEY }} \
      --set image.tag=${{ github.sha }} \
      --wait --timeout 10m
```

## Support and Contributing

For issues, feature requests, or contributions, please visit the [lilnas GitHub repository](https://github.com/codemonkey800/lilnas).

### Useful Links

- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [MinIO Documentation](https://docs.min.io/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Helm Documentation](https://helm.sh/docs/)