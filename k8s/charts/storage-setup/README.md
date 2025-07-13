# Storage Setup Helm Chart

This Helm chart manages storage classes and persistent volumes for the lilnas Kubernetes cluster, implementing a tiered storage strategy based on performance requirements and data characteristics.

## Overview

The storage-setup chart creates:
- Storage Classes for different storage tiers (HDD, SSD)
- Persistent Volumes for various services

## Storage Architecture

### Storage Tiers

#### SSD Storage (`/mnt/ssd1`)
High-performance storage for applications requiring fast I/O:
- **Database storage** (PostgreSQL, Redis)
- **Photo libraries** (Immich, Google Photos)
- **Build cache** (CI/CD artifacts)

#### HDD Storage (`/mnt/hdd1`)
Cost-effective storage for larger volumes and less performance-critical data:
- **Media files** (Movies, TV shows)
- **Application configurations**
- **Object storage** (MinIO)
- **Game servers** (Minecraft, Palworld)

## Installation

```bash
# Install with default values
helm install storage-setup ./k8s/charts/storage-setup

# Install with custom values
helm install storage-setup ./k8s/charts/storage-setup -f custom-values.yaml

# Dry run to see what will be created
helm install storage-setup ./k8s/charts/storage-setup --dry-run --debug
```

## Configuration

### Storage Classes

The chart creates four storage classes by default:

| Storage Class | Description | Default Path |
|--------------|-------------|--------------|
| `hdd-storage` | General HDD storage (default) | `/mnt/hdd1/data/k8s-volumes` |
| `hdd-media-storage` | Media files on HDD | `/mnt/hdd1` |
| `ssd-storage` | Fast SSD storage | `/mnt/ssd1/k8s-volumes` |
| `ssd-photos-storage` | Photos on SSD | `/mnt/ssd1` |

### Persistent Volumes

Pre-configured persistent volumes include:

#### Application Storage (HDD)
| PV Name | Storage Class | Capacity | Purpose |
|---------|--------------|----------|---------|
| `app-configs-pv` | hdd-storage | 20Gi | Application configuration files |
| `game-servers-pv` | hdd-storage | 100Gi | Game server data (Minecraft, Palworld) |
| `media-services-pv` | hdd-storage | 50Gi | Media management service configs |
| `minio-data-pv` | hdd-storage | 1Ti | S3-compatible object storage |
| `postgres-main-pv` | hdd-storage | 100Gi | Main PostgreSQL database |

#### Performance Storage (SSD)
| PV Name | Storage Class | Capacity | Purpose |
|---------|--------------|----------|---------|
| `build-cache-pv` | ssd-storage | 100Gi | CI/CD build cache |
| `immich-db-pv` | ssd-storage | 50Gi | Immich database |
| `redis-cache-pv` | ssd-storage | 10Gi | Redis cache |

#### Media Storage (HDD)
| PV Name | Storage Class | Capacity | Purpose |
|---------|--------------|----------|---------|
| `movies-pv` | hdd-media-storage | 10Ti | Movie collection |
| `tv-pv` | hdd-media-storage | 5Ti | TV show collection |

#### Photo Storage (SSD)
| PV Name | Storage Class | Capacity | Purpose |
|---------|--------------|----------|---------|
| `google-photos-pv` | ssd-photos-storage | 500Gi | Google Photos backup |
| `immich-library-pv` | ssd-photos-storage | 2Ti | Immich photo library |

### Capacity Planning

**Current Allocations:**
- **Total HDD**: ~16.17 Ti allocated
- **Total SSD**: ~3.16 Ti allocated

**Host Path Mapping:**
- **HDD**: `/mnt/hdd1` (physical HDD storage)
- **SSD**: `/mnt/ssd1` (physical SSD storage)

## Values Configuration

### Basic Configuration

```yaml
# Node where volumes will be created
nodeSelector:
  hostname: lilnas

# Storage provisioner settings
provisioner: rancher.io/local-path
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
```

### Disabling Storage Classes

To disable a storage class:

```yaml
storageClasses:
  hdd:
    enabled: false
```

### Customizing Persistent Volumes

To modify a PV's configuration:

```yaml
persistentVolumes:
  appConfigs:
    enabled: true
    capacity: 50Gi  # Increase from default 20Gi
    path: /custom/path/app-configs
```

To disable a PV:

```yaml
persistentVolumes:
  gameServers:
    enabled: false
```

### Adding Additional Persistent Volumes

You can add custom PVs using the `additionalPVs` array:

```yaml
additionalPVs:
  - enabled: true
    name: custom-app-pv
    storageClass: hdd-storage
    capacity: 50Gi
    accessModes:
      - ReadWriteOnce
    path: /mnt/hdd1/data/k8s-volumes/custom-app
  - enabled: true
    name: fast-cache-pv
    storageClass: ssd-storage
    capacity: 20Gi
    accessModes:
      - ReadWriteMany
    path: /mnt/ssd1/k8s-volumes/fast-cache
```

## Advanced Configuration

### Custom Node Selector

To deploy on a different node:

```yaml
nodeSelector:
  hostname: different-node
```

### Custom Storage Class Paths

To change storage class paths:

```yaml
storageClasses:
  hdd:
    nodePath: /custom/hdd/path
  ssd:
    nodePath: /custom/ssd/path
```

### Different Reclaim Policies

To change the reclaim policy (use with caution):

```yaml
reclaimPolicy: Delete  # Default is Retain
```

## Migration from Static YAML

If migrating from static YAML files:

1. Review current PV usage:
   ```bash
   kubectl get pv
   kubectl get pvc --all-namespaces
   ```

2. Install the chart with matching values
3. Verify all resources are created correctly
4. Update PVC references if needed

## Backup Strategy

### Retain Policy
All persistent volumes use `Retain` reclaim policy to prevent accidental data loss. This means:
- PVs are not automatically deleted when PVCs are removed
- Data persists even after chart uninstallation
- Manual cleanup is required if you want to remove PVs

### Volume Snapshots
Consider implementing volume snapshots for critical databases and configuration data. Priority backup targets:
- PostgreSQL databases
- Redis persistent data
- Application configurations
- Photo libraries

## Monitoring

Monitor storage usage with:

```bash
# Check storage class usage
kubectl get storageclass

# Check persistent volume status
kubectl get pv

# Check persistent volume claims
kubectl get pvc --all-namespaces

# Monitor disk usage on host
df -h /mnt/hdd1 /mnt/ssd1

# Check PV usage details
kubectl describe pv <pv-name>
```

## Troubleshooting

### PV Not Binding

If a PV is not binding to a PVC:
- Ensure the storage class matches
- Check the capacity is sufficient
- Verify node affinity matches
- Check access modes compatibility
- Verify the host path exists and has correct permissions

### Storage Class Not Default

If the default storage class is not being set:
- Ensure only one storage class has `isDefault: true`
- Check for existing default storage classes

### Permission Errors

If pods have permission errors accessing volumes:
```bash
# Check directory permissions on host
ls -la /mnt/hdd1 /mnt/ssd1

# Ensure directories exist
mkdir -p /mnt/hdd1/data/k8s-volumes
mkdir -p /mnt/ssd1/k8s-volumes
```

### Capacity Issues

Monitor disk usage to prevent capacity issues:
```bash
# Check disk usage
df -h /mnt/hdd1 /mnt/ssd1

# Find large directories
du -h --max-depth=1 /mnt/hdd1
du -h --max-depth=1 /mnt/ssd1
```

## Uninstallation

**Warning**: Uninstalling this chart will remove storage classes but PVs will be retained due to the `Retain` reclaim policy.

```bash
# Uninstall the chart
helm uninstall storage-setup

# PVs will remain and need manual cleanup if desired
kubectl get pv | grep -E "(app-configs|build-cache|game-servers)"
```