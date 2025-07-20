# sonarr

PVR for Usenet and BitTorrent users - TV series monitoring and management in the lilnas ecosystem.

## TL;DR

```bash
# Development deployment
./deploy.sh -e dev

# Production deployment
./deploy.sh -e prod
```

## Introduction

This chart deploys Sonarr on a Kubernetes cluster using the Helm package manager. Sonarr is a PVR for Usenet and BitTorrent users that monitors multiple RSS feeds for new episodes of your favorite shows and grabs, sorts, and renames them. It can also be configured to automatically upgrade the quality of files already downloaded when a better quality format becomes available.

### What is Sonarr?

Sonarr is a PVR (Personal Video Recorder) for Usenet and BitTorrent users. It can monitor multiple RSS feeds for new episodes of your favorite shows and will grab, sort and rename them. It can also be configured to automatically upgrade the quality of existing files in your library when a better quality format becomes available.

### Integration with lilnas

This Sonarr deployment is designed to integrate seamlessly with the lilnas media ecosystem:
- **Storage Integration**: Uses HDD storage for TV series library and configuration
- **Download Client Integration**: Works with SABnzbd, transmission, and qBittorrent
- **Security**: Runs with proper security context and resource limits
- **Web Interface**: Accessible via ingress with forward-auth protection
- **Media Management**: Automated organization and renaming of TV series

## Prerequisites

- Kubernetes 1.19+
- Helm 3.2.0+
- Storage class `hdd-media-storage` (for accessing /mnt/hdd1)
- Traefik ingress controller
- Cert-manager for automatic SSL certificates
- Forward-auth middleware for authentication
- Namespace `lilnas-apps` (or custom namespace)

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

To install the chart with the release name `sonarr`:

```bash
# Basic installation
helm install sonarr ./k8s/charts/sonarr

# With custom namespace
helm install sonarr ./k8s/charts/sonarr \
  --namespace lilnas-apps \
  --create-namespace

# With environment-specific values
helm install sonarr ./k8s/charts/sonarr \
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

To uninstall/delete the `sonarr` deployment:

```bash
helm delete sonarr -n lilnas-apps

# Also delete persistent volume claim if needed
kubectl delete pvc -n lilnas-apps -l app.kubernetes.io/name=sonarr
```

**Important**: The uninstall process preserves your Sonarr data on the host filesystem at `/mnt/hdd1/data/media/sonarr/`. This includes your TV series library, configuration, quality profiles, and download client settings.

## Configuration

The following table lists the configurable parameters of the sonarr chart and their default values.

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
| `image.repository` | Sonarr Docker image repository | `lscr.io/linuxserver/sonarr` |
| `image.tag` | Image tag | `latest` |
| `image.pullPolicy` | Image pull policy | `Always` |
| `imagePullSecrets` | Image pull secrets | `[]` |

### Service Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `service.type` | Kubernetes service type | `ClusterIP` |
| `service.port` | Service port | `80` |
| `service.targetPort` | Container port | `8989` |
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
| `ingress.hosts[0].host` | Hostname | `sonarr.lilnas.io` |
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

After deployment, Sonarr will be accessible via the configured ingress with forward-auth protection:

```bash
# Default URL (adjust based on your ingress configuration)
https://sonarr.lilnas.io

# Check the actual URL
kubectl get ingress -n lilnas-apps sonarr
```

### Initial Configuration

1. **First-time setup**: Navigate to the web interface for the initial configuration wizard
2. **Media Management**: Configure your TV series root folders (e.g., `/tv` for the mounted media directory)
3. **Download Clients**: Add SABnzbd, transmission, or qBittorrent as download clients
4. **Indexers**: Configure Usenet or torrent indexers for searching
5. **Quality Profiles**: Set up quality preferences for different types of content
6. **Release Profiles**: Configure release filtering and preferred words

### Download Client Integration

#### SABnzbd Configuration

Configure Sonarr to use SABnzbd as the primary download client:

1. **Host**: `sabnzbd.lilnas-media.svc.cluster.local`
2. **Port**: `8080`
3. **API Key**: Found in SABnzbd Settings > General > API Key
4. **Category**: `tv-sonarr` (must be configured in SABnzbd)
5. **Priority**: Normal

#### Transmission/qBittorrent Configuration

For torrent clients:

1. **Host**: Use the appropriate Kubernetes service name
2. **Port**: Default port for the client
3. **Username/Password**: As configured in the torrent client
4. **Category**: `tv-sonarr`

### Media Library Configuration

Default paths within the container:
- **TV Series Library**: `/tv` (mapped to host storage)
- **Configuration**: `/config` (PVC mount)
- **Logs**: `/config/logs/`
- **Metadata**: `/config/MediaCover/`

Recommended folder structure:
```
/tv/
├── Series Name (Year)/
│   ├── Season 01/
│   │   ├── Series.Name.S01E01.Episode.Title.1080p.x264.mkv
│   │   └── ...
│   └── Season 02/
└── Another Series (Year)/
```

## Data Migration and Persistence

### Existing Data Location

If you have existing Sonarr data at `/mnt/hdd1/data/media/sonarr/`, it will need to be moved to work with the new PVC-based storage:

```bash
# Check existing data
ls -la /mnt/hdd1/data/media/sonarr/

# After first deployment, data will be stored in the PVC
# The storage class 'hdd-media-storage' provides access to /mnt/hdd1
```

### Data Structure

Your Sonarr configuration and data includes:
```
/config/ (PVC mount point)
├── sonarr.db             (main database with series and episodes)
├── config.xml            (application configuration)
├── logs/                 (application logs)
├── MediaCover/           (series artwork and banners)
├── Backups/              (automatic configuration backups)
└── xdg/                  (XDG configuration directories)
```

### Backup and Restore

```bash
# Backup configuration and database
kubectl exec -n lilnas-apps deployment/sonarr -- \
  tar -czf /tmp/sonarr-backup.tar.gz -C /config .

kubectl cp lilnas-apps/sonarr-pod:/tmp/sonarr-backup.tar.gz ./sonarr-backup.tar.gz

# Restore configuration (to new deployment)
kubectl cp ./sonarr-backup.tar.gz lilnas-apps/sonarr-pod:/tmp/sonarr-backup.tar.gz

kubectl exec -n lilnas-apps deployment/sonarr -- \
  tar -xzf /tmp/sonarr-backup.tar.gz -C /config
```

### Library Metadata

Sonarr automatically creates backups of your configuration:
- **Location**: `/config/Backups/scheduled/`
- **Frequency**: Daily (configurable)
- **Retention**: 28 backups by default

## Security Considerations

### Container Security

Sonarr runs with the following security measures:

1. **Non-root User**: Runs as UID/GID 1000
2. **Read-only Root Filesystem**: Prevents unauthorized modifications
3. **Dropped Capabilities**: All Linux capabilities are dropped
4. **Resource Limits**: CPU and memory limits prevent resource exhaustion
5. **Security Context**: Implements proper pod and container security contexts

### Network Security

- **Forward-Auth Protection**: Web interface protected by authentication middleware
- **Ingress Access**: Accessible only via configured hostname with authentication
- **Internal Communication**: Uses cluster-internal networking for download client communication
- **API Security**: API access controlled by API keys

### Recommended Production Settings

1. **Enable Authentication**: Configure authentication in Sonarr settings
2. **Secure API Keys**: Use strong API keys and rotate regularly
3. **Enable HTTPS**: Automatic SSL certificates via cert-manager
4. **Regular Updates**: Keep Sonarr image updated to latest version
5. **Backup Strategy**: Regular backups of configuration and database

## Troubleshooting Guide

### Common Issues

1. **Pod not starting**:
   ```bash
   # Check pod status
   kubectl get pods -n lilnas-apps -l app.kubernetes.io/name=sonarr
   
   # View pod events
   kubectl describe pod -n lilnas-apps -l app.kubernetes.io/name=sonarr
   
   # Check logs
   kubectl logs -n lilnas-apps -l app.kubernetes.io/name=sonarr -f
   ```

2. **Database corruption**:
   ```bash
   # Access container and check database
   kubectl exec -it -n lilnas-apps deployment/sonarr -- /bin/bash
   
   # Check for database files
   ls -la /config/sonarr.db*
   
   # Restore from backup if needed
   cp /config/Backups/scheduled/sonarr_backup_*.zip /tmp/
   ```

3. **Download client connection issues**:
   ```bash
   # Test connectivity to SABnzbd
   kubectl exec -n lilnas-apps deployment/sonarr -- \
     curl -I http://sabnzbd.lilnas-media.svc.cluster.local:8080
   
   # Check download client configuration
   kubectl logs -n lilnas-apps -l app.kubernetes.io/name=sonarr | grep -i "download client"
   ```

4. **Storage issues**:
   ```bash
   # Check PVC status
   kubectl get pvc -n lilnas-apps -l app.kubernetes.io/name=sonarr
   
   # Check disk usage
   kubectl exec -n lilnas-apps deployment/sonarr -- df -h /config
   kubectl exec -n lilnas-apps deployment/sonarr -- df -h /tv
   ```

5. **Indexer connectivity**:
   ```bash
   # Test external connectivity
   kubectl exec -n lilnas-apps deployment/sonarr -- \
     curl -I https://api.nzbgeek.info/api
   
   # Check DNS resolution
   kubectl exec -n lilnas-apps deployment/sonarr -- \
     nslookup api.nzbgeek.info
   ```

### Debug Commands

```bash
# Port-forward for local access
kubectl port-forward -n lilnas-apps svc/sonarr 8989:80

# Access locally
curl http://localhost:8989

# Execute commands in container
kubectl exec -it -n lilnas-apps deployment/sonarr -- /bin/bash

# Check Sonarr process
kubectl exec -n lilnas-apps deployment/sonarr -- ps aux | grep Sonarr

# Check environment variables
kubectl exec -n lilnas-apps deployment/sonarr -- env | grep -E '(TZ|PUID|PGID)'

# View Sonarr logs
kubectl exec -n lilnas-apps deployment/sonarr -- tail -f /config/logs/sonarr.txt
```

### Performance Tuning

1. **Increase resources for large libraries**:
   ```yaml
   resources:
     requests:
       memory: "512Mi"
       cpu: "500m"
     limits:
       memory: "2Gi"
       cpu: "2000m"
   ```

2. **Database optimization**:
   - Regular maintenance of the Sonarr database
   - Monitor database size and growth
   - Clean up old logs and unused series

3. **Storage optimization**:
   - Use SSD storage for the database and configuration
   - HDD storage for media files
   - Implement proper cleanup policies

## Integration Examples

### SABnzbd Integration

```yaml
# In Sonarr Settings > Download Clients
Name: SABnzbd
Enable: Yes
Host: sabnzbd.lilnas-media.svc.cluster.local
Port: 8080
API Key: [from SABnzbd Settings]
Category: tv-sonarr
Recent Priority: Normal
Older Priority: Normal
```

### Transmission Integration

```yaml
# In Sonarr Settings > Download Clients
Name: Transmission
Enable: Yes
Host: transmission.lilnas-apps.svc.cluster.local
Port: 9091
Username: [transmission username]
Password: [transmission password]
Category: tv-sonarr
Directory: /downloads/tv/
```

### Plex/Jellyfin Integration

Configure your media server to monitor the TV series directory:
- **Plex**: Add `/tv` as a TV Shows library
- **Jellyfin**: Add `/tv` as a Shows collection
- **Emby**: Add `/tv` as a TV library

### Custom Values for Large Libraries

```yaml
# values-large-library.yaml
resources:
  requests:
    memory: "1Gi"
    cpu: "1000m"
  limits:
    memory: "4Gi"
    cpu: "4000m"

persistence:
  size: 50Gi

# Enable autoscaling for variable loads
autoscaling:
  enabled: true
  minReplicas: 1
  maxReplicas: 2
  targetCPUUtilizationPercentage: 60

# Optimize for large libraries
config:
  SONARR_BRANCH: "develop"  # Use develop branch for latest features
```

## Monitoring and Maintenance

### Health Monitoring

Monitor these key aspects:

1. **Series Monitoring**: Track wanted vs available episodes
2. **Download Performance**: Monitor successful download rates
3. **Storage Usage**: Monitor PVC usage and growth trends  
4. **Resource Consumption**: Watch CPU and memory usage patterns
5. **Database Health**: Monitor database size and query performance

### Regular Maintenance Tasks

1. **Update the image**: Regularly update to latest Sonarr version
2. **Database maintenance**: Periodic optimization and cleanup
3. **Library cleanup**: Remove unwanted series and old files
4. **Backup verification**: Test restore procedures periodically
5. **Monitor indexers**: Check indexer status and health
6. **Review quality profiles**: Update quality preferences as needed

### Automated Maintenance

Configure automatic maintenance in Sonarr:
- **Daily cleanup**: Remove old logs and temporary files
- **Weekly optimization**: Database optimization
- **Backup scheduling**: Configure automatic backups
- **Health checks**: Enable Sonarr's built-in health monitoring

### Upgrading the Chart

```bash
# Update to latest chart version
./deploy.sh -e prod

# Or using helm directly
helm upgrade sonarr ./k8s/charts/sonarr \
  -f values.yaml \
  --wait

# Check upgrade status
kubectl rollout status deployment/sonarr -n lilnas-apps
```

## Advanced Configuration

### Custom Quality Profiles

Create quality profiles optimized for your setup:

1. **4K Profile**: For 4K content with higher bitrate requirements
2. **Standard HD**: For 1080p content with reasonable file sizes  
3. **Space Saver**: For 720p content to minimize storage usage
4. **Archive**: For highest quality available regardless of size

### Release Profiles

Configure release filtering:

1. **Preferred Groups**: Prioritize specific release groups
2. **Ignored Terms**: Block releases with certain keywords
3. **Required Terms**: Only accept releases with specific terms
4. **Size Limits**: Set minimum and maximum file sizes

### Custom Scripts

Implement custom scripts for post-processing:

```bash
# Add custom scripts to /config/scripts/
# Configure in Settings > Connect > Custom Scripts
```

## Support and Contributing

For issues, feature requests, or contributions, please visit the [lilnas GitHub repository](https://github.com/codemonkey800/lilnas).

### Useful Links

- [Sonarr Documentation](https://wiki.servarr.com/sonarr)
- [LinuxServer.io Sonarr Image](https://docs.linuxserver.io/images/docker-sonarr)
- [Sonarr Discord](https://discord.gg/M6BvZn5)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Helm Documentation](https://helm.sh/docs/)
- [lilnas Media Stack Documentation](https://github.com/codemonkey800/lilnas)
- [Arr Suite Guide](https://trash-guides.info/)

### Community Resources

- [TRaSH Guides](https://trash-guides.info/Sonarr/) - Quality profiles and release profiles
- [r/sonarr](https://reddit.com/r/sonarr) - Community support and discussions
- [Servarr Wiki](https://wiki.servarr.com/sonarr) - Official documentation and guides