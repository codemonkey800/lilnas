# Radarr Helm Chart

This Helm chart deploys [Radarr](https://radarr.video/), a PVR (Personal Video Recorder) for movies, to a Kubernetes cluster. Radarr automatically searches, downloads, and manages your movie collection.

## Overview

Radarr is a movie collection manager for Usenet and BitTorrent users. It can monitor multiple RSS feeds for new movies and will interface with clients and indexers to grab, sort, and rename them. It can also be configured to automatically upgrade the quality of existing files in the library when a better quality format becomes available.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.0+
- Persistent storage support in the underlying infrastructure
- Ingress controller (Traefik recommended)
- cert-manager (for automatic SSL certificate management)

## Installation

### Quick Start

1. Clone the repository and navigate to the chart directory:
   ```bash
   cd k8s/charts/radarr
   ```

2. Install with default values (development environment):
   ```bash
   ./deploy.sh
   ```

3. Install for production:
   ```bash
   ./deploy.sh prod
   ```

### Manual Installation

```bash
# Update dependencies
helm dependency update

# Install the chart
helm install radarr . \
  --namespace lilnas-media \
  --create-namespace \
  --values values.yaml
```

## Configuration

### Key Configuration Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Radarr Docker image repository | `lscr.io/linuxserver/radarr` |
| `image.tag` | Image tag | `latest` |
| `service.port` | Service port | `80` |
| `service.targetPort` | Container port | `7878` |
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.hosts[0].host` | Hostname for Radarr | `radarr.lilnas.io` |
| `persistence.config.size` | Size of config PVC | `10Gi` |
| `persistence.movies.size` | Size of movies PVC | `5Ti` |
| `persistence.downloads.size` | Size of downloads PVC | `1Ti` |

### Environment Variables

The chart configures the following environment variables for the LinuxServer.io container:

- `PUID=1000` - User ID for file permissions
- `PGID=1000` - Group ID for file permissions  
- `TZ=America/Los_Angeles` - Timezone setting

### Storage Configuration

The chart creates three persistent volume claims:

1. **Configuration Storage** (`/config`): Stores Radarr configuration, database, and logs
2. **Movies Storage** (`/movies`): Stores the movie library
3. **Downloads Storage** (`/downloads`): Stores downloaded files before processing

### Values Files

- `values.yaml` - Default configuration suitable for development
- `values-prod.yaml` - Production overrides with:
  - Higher resource limits
  - More conservative health check settings
  - Production SSL certificates
  - Larger storage allocations

## Data Migration

### From Docker Compose

If migrating from the existing Docker Compose setup:

1. **Stop the Docker Compose service** (but don't remove the data):
   ```bash
   # In the docker-compose directory
   docker-compose stop radarr
   ```

2. **Deploy the Helm chart**:
   ```bash
   ./deploy.sh prod
   ```

3. **Copy configuration data**:
   ```bash
   # Create a temporary pod for data migration
   kubectl run -it --rm radarr-migrate \
     --image=busybox \
     --restart=Never \
     --namespace=lilnas-media \
     --overrides='
   {
     "spec": {
       "containers": [{
         "name": "radarr-migrate",
         "image": "busybox",
         "command": ["sleep", "3600"],
         "volumeMounts": [{
           "name": "config",
           "mountPath": "/config"
         }]
       }],
       "volumes": [{
         "name": "config",
         "persistentVolumeClaim": {
           "claimName": "radarr-config"
         }
       }]
     }
   }' -- sh

   # Inside the pod, you can copy files from the host
   # This step requires manual intervention to copy files
   ```

4. **Copy essential files** from `/home/jeremy/lilnas/data/media/radarr/` to the config PVC:
   - `config.xml` (main configuration)
   - `radarr.db` (database)
   - `logs.db` (optional)

5. **Restart the Radarr deployment**:
   ```bash
   kubectl rollout restart deployment/radarr -n lilnas-media
   ```

## Security

### Pod Security

The chart implements security best practices:

- Runs as non-root user (UID 1000)
- Uses read-only root filesystem where possible
- Drops all Linux capabilities
- Enables seccomp profile

### Network Security

- No forward-auth middleware (Radarr handles its own authentication)
- Network policies can be enabled for production environments
- TLS encryption via cert-manager and Let's Encrypt

### Storage Security

- Persistent volumes use appropriate access modes
- Storage classes can be configured per environment

## Monitoring and Troubleshooting

### Health Checks

The chart configures HTTP health checks using Radarr's API:

- **Liveness Probe**: `/api/v3/system/status` (checks if Radarr is running)
- **Readiness Probe**: `/api/v3/system/status` (checks if Radarr is ready to serve requests)

### Viewing Logs

```bash
# View pod logs
kubectl logs -f deployment/radarr -n lilnas-media

# View logs from a specific pod
kubectl logs -f <pod-name> -n lilnas-media
```

### Accessing the Web UI

After deployment, Radarr will be available at:
- **Development**: `https://radarr.dev.lilnas.io`
- **Production**: `https://radarr.lilnas.io`

### Common Issues

1. **Pod stuck in Pending state**:
   - Check PVC status: `kubectl get pvc -n lilnas-media`
   - Verify storage classes are available
   - Check node resources

2. **Health check failures**:
   - Radarr takes time to initialize (especially first run)
   - Check container logs for startup errors
   - Verify port configuration matches container port

3. **Ingress not working**:
   - Verify Traefik is running and configured
   - Check cert-manager for SSL certificate issues
   - Ensure DNS resolves to your cluster

## Upgrading

### Helm Chart Updates

```bash
# Update dependencies
helm dependency update

# Upgrade the deployment
helm upgrade radarr . \
  --namespace lilnas-media \
  --values values-prod.yaml
```

### Application Updates

The chart uses the `latest` tag by default. To use a specific version:

1. Update `image.tag` in your values file
2. Upgrade the Helm release

## Uninstalling

```bash
# Uninstall the Helm release
helm uninstall radarr --namespace lilnas-media

# Optionally remove the namespace
kubectl delete namespace lilnas-media
```

**Note**: This will not delete persistent volume claims or data. To completely remove all data:

```bash
# Delete PVCs (WARNING: This will delete all data!)
kubectl delete pvc -n lilnas-media -l "app.kubernetes.io/name=radarr"
```

## Development

### Testing Changes

```bash
# Validate the chart
helm lint .

# Test template rendering
helm template radarr . --values values.yaml

# Dry run deployment
./deploy.sh --dry-run
```

### Chart Structure

```
radarr/
├── Chart.yaml              # Chart metadata
├── values.yaml             # Default values
├── values-prod.yaml        # Production overrides
├── templates/              # Kubernetes manifests
│   ├── _helpers.tpl       # Template helpers
│   ├── configmap.yaml     # Configuration
│   ├── deployment.yaml    # Main application deployment
│   ├── ingress.yaml       # Ingress configuration
│   ├── pvc.yaml          # Persistent volume claims
│   ├── service.yaml      # Kubernetes service
│   └── serviceaccount.yaml # Service account
├── deploy.sh              # Deployment script
└── README.md             # This file
```

## Support

For issues related to:
- **Radarr application**: Check the [official Radarr documentation](https://wiki.servarr.com/radarr)
- **Helm chart**: Create an issue in the lilnas repository
- **Kubernetes deployment**: Check cluster and namespace logs

## License

This Helm chart is part of the lilnas project. See the main repository for license information.