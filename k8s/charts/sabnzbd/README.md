# sabnzbd

Binary newsreader and NZB downloader for Usenet in the lilnas ecosystem.

## TL;DR

```bash
# Development deployment
./deploy.sh -e dev

# Production deployment
./deploy.sh -e prod
```

## Introduction

This chart deploys SABnzbd on a Kubernetes cluster using the Helm package manager. SABnzbd is a multi-platform binary newsreader for Usenet that makes downloading from Usenet as simple and streamlined as possible. It integrates seamlessly with Sonarr, Radarr, and other Arr-suite applications in the lilnas media stack.

### What is SABnzbd?

SABnzbd is an Open Source Binary Newsreader written in Python. It's totally free, incredibly easy to use, and works practically everywhere. SABnzbd makes Usenet as simple and streamlined as possible by automating everything we can. All you have to do is add an .nzb file and SABnzbd takes over: it downloads, verifies, repairs, extracts and files, so you can sit back and relax.

### Integration with lilnas

This SABnzbd deployment is designed to integrate with the lilnas media ecosystem:
- **Storage Integration**: Uses HDD storage for downloads and configuration
- **Media Stack Integration**: Works with Sonarr/Radarr for automated media management
- **Security**: Runs with proper security context and resource limits
- **Web Interface**: Accessible via ingress with automatic SSL certificates

## Prerequisites

- Kubernetes 1.19+
- Helm 3.2.0+
- Storage class `hdd-media-storage` (for accessing /mnt/hdd1)
- Traefik ingress controller
- Cert-manager for automatic SSL certificates
- Namespace `lilnas-media` (or custom namespace)

## Installing the Chart

### Using the deployment script (recommended)

The easiest way to deploy is using the provided deployment script:

```bash
# Development deployment
./deploy.sh -e dev

# Production deployment
./deploy.sh -e prod

# Custom namespace
./deploy.sh -e prod -n my-namespace

# Dry run to preview changes
./deploy.sh -e dev --dry-run
```

### Using Helm directly

To install the chart with the release name `sabnzbd`:

```bash
# Basic installation
helm install sabnzbd ./k8s/charts/sabnzbd

# With custom namespace
helm install sabnzbd ./k8s/charts/sabnzbd \
  --namespace lilnas-media \
  --create-namespace

# With environment-specific values
helm install sabnzbd ./k8s/charts/sabnzbd \
  -f values.yaml
```

## Uninstalling the Chart

### Using the uninstall script (recommended)

```bash
# Interactive uninstall with confirmation
./uninstall.sh

# Force uninstall without confirmation
./uninstall.sh -f

# Custom namespace
./uninstall.sh -n my-namespace
```

### Using Helm directly

To uninstall/delete the `sabnzbd` deployment:

```bash
helm delete sabnzbd -n lilnas-media

# Also delete persistent volume claim if needed
kubectl delete pvc -n lilnas-media -l app.kubernetes.io/name=sabnzbd
```

**Important**: The uninstall process preserves your SABnzbd data on the host filesystem at `/mnt/hdd1/data/media/sabnzbd/`. This includes your configuration, download history, and incomplete downloads.

## Configuration

The following table lists the configurable parameters of the sabnzbd chart and their default values.

### General Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of replicas | `1` |
| `namespace` | Kubernetes namespace | `lilnas-media` |
| `nameOverride` | Override chart name | `""` |
| `fullnameOverride` | Override full name | `""` |

### Image Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | SABnzbd Docker image repository | `lscr.io/linuxserver/sabnzbd` |
| `image.tag` | Image tag | `latest` |
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
| `config.TZ` | Timezone for the application | `America/Los_Angeles` |
| `config.PUID` | Process User ID for file permissions | `1000` |
| `config.PGID` | Process Group ID for file permissions | `1000` |

### Ingress Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.className` | Ingress class | `traefik` |
| `ingress.annotations` | Ingress annotations | See values.yaml |
| `ingress.hosts[0].host` | Hostname | `sabnzbd.lilnas.io` |
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
| `resources.requests.memory` | Memory request | `256Mi` |
| `resources.requests.cpu` | CPU request | `200m` |
| `resources.limits.memory` | Memory limit | `1Gi` |
| `resources.limits.cpu` | CPU limit | `1000m` |

### Persistence

| Parameter | Description | Default |
|-----------|-------------|---------|
| `persistence.enabled` | Enable persistent storage | `true` |
| `persistence.storageClass` | Storage class | `hdd-media-storage` |
| `persistence.accessModes` | Access modes | `["ReadWriteOnce"]` |
| `persistence.size` | Volume size | `10Gi` |
| `persistence.mountPath` | Mount path | `/config` |
| `persistence.annotations` | PVC annotations | `{}` |

### Health Checks

| Parameter | Description | Default |
|-----------|-------------|---------|
| `livenessProbe.initialDelaySeconds` | Initial delay for liveness probe | `120` |
| `livenessProbe.periodSeconds` | Check period | `30` |
| `livenessProbe.timeoutSeconds` | Timeout | `10` |
| `readinessProbe.initialDelaySeconds` | Initial delay for readiness probe | `60` |
| `readinessProbe.periodSeconds` | Check period | `15` |
| `readinessProbe.timeoutSeconds` | Timeout | `5` |

### Autoscaling

| Parameter | Description | Default |
|-----------|-------------|---------|
| `autoscaling.enabled` | Enable HPA | `false` |
| `autoscaling.minReplicas` | Minimum replicas | `1` |
| `autoscaling.maxReplicas` | Maximum replicas | `2` |
| `autoscaling.targetCPUUtilizationPercentage` | Target CPU usage | `70` |
| `autoscaling.targetMemoryUtilizationPercentage` | Target memory usage | `80` |

### Network Policy

| Parameter | Description | Default |
|-----------|-------------|---------|
| `networkPolicy.enabled` | Enable network policy | `false` |
| `networkPolicy.egress` | Egress rules | `[{}]` (allow all) |

## Usage

### Accessing the Web Interface

After deployment, SABnzbd will be accessible via the configured ingress:

```bash
# Default URL (adjust based on your ingress configuration)
https://sabnzbd.lilnas.io

# Check the actual URL
kubectl get ingress -n lilnas-media sabnzbd
```

### Initial Configuration

1. **First-time setup**: Navigate to the web interface for the initial configuration wizard
2. **Server settings**: Configure your Usenet provider settings
3. **Folders**: Download directories are pre-configured to work with the lilnas media stack
4. **Categories**: Set up categories for different types of downloads (TV, Movies, etc.)

### Integration with Sonarr/Radarr

Configure Sonarr and Radarr to use SABnzbd as their download client:

1. **Host**: Use the Kubernetes service name: `sabnzbd.lilnas-media.svc.cluster.local`
2. **Port**: `8080`
3. **API Key**: Found in SABnzbd Settings > General > API Key
4. **Category**: Set up appropriate categories (tv-sonarr, radarr, etc.)

### Download Configuration

Default download paths within the container:
- **Incomplete downloads**: `/config/Downloads/incomplete`
- **Completed downloads**: `/config/Downloads/complete`
- **Categories**: Configured per category in SABnzbd settings

## Data Migration and Persistence

### Existing Data Location

If you have existing SABnzbd data at `/mnt/hdd1/data/media/sabnzbd/`, it will need to be moved to work with the new PVC-based storage:

```bash
# Check existing data
ls -la /mnt/hdd1/data/media/sabnzbd/

# After first deployment, data will be stored in the PVC
# The storage class 'hdd-media-storage' provides access to /mnt/hdd1
```

### Data Structure

Your SABnzbd configuration and data includes:
```
/config/ (PVC mount point)
├── sabnzbd.ini          (main configuration)
├── admin/               (database files)
├── logs/                (application logs)
└── Downloads/           (download directories)
    ├── complete/        (finished downloads)
    └── incomplete/      (active downloads)
```

### Backup and Restore

```bash
# Backup configuration
kubectl exec -n lilnas-media deployment/sabnzbd -- \
  tar -czf /tmp/sabnzbd-backup.tar.gz -C /config .

kubectl cp lilnas-media/sabnzbd-pod:/tmp/sabnzbd-backup.tar.gz ./sabnzbd-backup.tar.gz

# Restore configuration (to new deployment)
kubectl cp ./sabnzbd-backup.tar.gz lilnas-media/sabnzbd-pod:/tmp/sabnzbd-backup.tar.gz

kubectl exec -n lilnas-media deployment/sabnzbd -- \
  tar -xzf /tmp/sabnzbd-backup.tar.gz -C /config
```

## Security Considerations

### Container Security

SABnzbd runs with the following security measures:

1. **Non-root User**: Runs as UID/GID 1000
2. **Read-only Root Filesystem**: Prevents unauthorized modifications
3. **Dropped Capabilities**: All Linux capabilities are dropped
4. **Resource Limits**: CPU and memory limits prevent resource exhaustion
5. **Security Context**: Implements proper pod and container security contexts

### Network Security

- **No Authentication Middleware**: SABnzbd handles its own authentication internally
- **Ingress Access**: Accessible directly via configured hostname
- **Internal Communication**: Uses cluster-internal networking for service communication

### Recommended Production Settings

1. **Enable SABnzbd Authentication**: Configure username/password in SABnzbd settings
2. **Restrict API Access**: Limit API access to necessary applications only
3. **Enable HTTPS**: Automatic SSL certificates via cert-manager
4. **Regular Updates**: Keep SABnzbd image updated to latest version

## Troubleshooting Guide

### Common Issues

1. **Pod not starting**:
   ```bash
   # Check pod status
   kubectl get pods -n lilnas-media -l app.kubernetes.io/name=sabnzbd
   
   # View pod events
   kubectl describe pod -n lilnas-media -l app.kubernetes.io/name=sabnzbd
   
   # Check logs
   kubectl logs -n lilnas-media -l app.kubernetes.io/name=sabnzbd -f
   ```

2. **Storage issues**:
   ```bash
   # Check PVC status
   kubectl get pvc -n lilnas-media -l app.kubernetes.io/name=sabnzbd
   
   # Check storage class
   kubectl get storageclass hdd-media-storage
   
   # Check disk usage
   kubectl exec -n lilnas-media deployment/sabnzbd -- df -h /config
   ```

3. **Configuration problems**:
   ```bash
   # Access configuration files
   kubectl exec -n lilnas-media deployment/sabnzbd -- ls -la /config
   
   # View configuration file
   kubectl exec -n lilnas-media deployment/sabnzbd -- cat /config/sabnzbd.ini
   
   # Check download directories
   kubectl exec -n lilnas-media deployment/sabnzbd -- ls -la /config/Downloads/
   ```

4. **Network connectivity**:
   ```bash
   # Test Usenet server connectivity
   kubectl exec -n lilnas-media deployment/sabnzbd -- \
     nslookup your-usenet-provider.com
   
   # Check ingress status
   kubectl get ingress -n lilnas-media sabnzbd
   
   # Test internal connectivity
   kubectl exec -n lilnas-media deployment/sabnzbd -- \
     curl -I http://localhost:8080
   ```

5. **Resource limitations**:
   ```bash
   # Check resource usage
   kubectl top pod -n lilnas-media -l app.kubernetes.io/name=sabnzbd
   
   # View resource limits
   kubectl describe pod -n lilnas-media -l app.kubernetes.io/name=sabnzbd | grep -A 10 -i limits
   
   # Check for throttling
   kubectl describe pod -n lilnas-media -l app.kubernetes.io/name=sabnzbd | grep -i throttling
   ```

### Debug Commands

```bash
# Port-forward for local access
kubectl port-forward -n lilnas-media svc/sabnzbd 8080:80

# Access locally
curl http://localhost:8080

# Execute commands in container
kubectl exec -it -n lilnas-media deployment/sabnzbd -- /bin/bash

# Check SABnzbd process
kubectl exec -n lilnas-media deployment/sabnzbd -- ps aux | grep sabnzbd

# Check environment variables
kubectl exec -n lilnas-media deployment/sabnzbd -- env | grep -E '(TZ|PUID|PGID)'
```

### Performance Tuning

1. **Increase resources for heavy usage**:
   ```yaml
   resources:
     requests:
       memory: "512Mi"
       cpu: "500m"
     limits:
       memory: "2Gi"
       cpu: "2000m"
   ```

2. **Optimize download settings**:
   - Configure appropriate number of connections
   - Set reasonable bandwidth limits
   - Use appropriate cache settings

3. **Storage optimization**:
   - Consider using faster storage class for active downloads
   - Implement proper cleanup policies

## Integration Examples

### Sonarr Configuration

```yaml
# In Sonarr Settings > Download Clients
Name: SABnzbd
Enable: Yes
Host: sabnzbd.lilnas-media.svc.cluster.local
Port: 8080
API Key: [from SABnzbd Settings]
Username: [if authentication enabled]
Password: [if authentication enabled]
Category: tv-sonarr
```

### Radarr Configuration

```yaml
# In Radarr Settings > Download Clients
Name: SABnzbd
Enable: Yes
Host: sabnzbd.lilnas-media.svc.cluster.local
Port: 8080
API Key: [from SABnzbd Settings]
Category: radarr
```

### Custom Values for Heavy Usage

```yaml
# values-heavy-usage.yaml
resources:
  requests:
    memory: "1Gi"
    cpu: "1000m"
  limits:
    memory: "4Gi"
    cpu: "4000m"

persistence:
  size: 100Gi

# Enable autoscaling for variable loads
autoscaling:
  enabled: true
  minReplicas: 1
  maxReplicas: 2
  targetCPUUtilizationPercentage: 60
```

## Monitoring and Maintenance

### Health Monitoring

Monitor these key aspects:

1. **Download Performance**: Track download speeds and completion rates
2. **Storage Usage**: Monitor PVC usage and growth trends  
3. **Resource Consumption**: Watch CPU and memory usage patterns
4. **Error Rates**: Monitor failed downloads and connection issues

### Regular Maintenance Tasks

1. **Update the image**: Regularly update to latest SABnzbd version
2. **Clean old downloads**: Implement cleanup policies for completed downloads
3. **Monitor disk space**: Ensure adequate storage for downloads
4. **Backup configuration**: Regular backups of SABnzbd settings
5. **Review logs**: Check for errors or performance issues

### Upgrading the Chart

```bash
# Update to latest chart version
./deploy.sh -e prod

# Or using helm directly
helm upgrade sabnzbd ./k8s/charts/sabnzbd \
  -f values.yaml \
  --wait
```

## Support and Contributing

For issues, feature requests, or contributions, please visit the [lilnas GitHub repository](https://github.com/codemonkey800/lilnas).

### Useful Links

- [SABnzbd Documentation](https://sabnzbd.org/wiki/)
- [LinuxServer.io SABnzbd Image](https://docs.linuxserver.io/images/docker-sabnzbd)
- [Usenet Guide](https://www.reddit.com/r/usenet/wiki/guides)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Helm Documentation](https://helm.sh/docs/)
- [lilnas Media Stack Documentation](https://github.com/codemonkey800/lilnas)