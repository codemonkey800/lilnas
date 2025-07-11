# Storage Architecture

This directory contains the storage configuration for the lilnas k8s cluster, implementing a tiered storage strategy based on performance requirements and data characteristics.

## Storage Tiers

### SSD Storage (`/mnt/ssd1`)

High-performance storage for applications requiring fast I/O:

- **Database storage** (PostgreSQL, Redis)
- **Photo libraries** (Immich, Google Photos)
- **Build cache** (CI/CD artifacts)

### HDD Storage (`/mnt/hdd1`)

Cost-effective storage for larger volumes and less performance-critical data:

- **Media files** (Movies, TV shows)
- **Application configurations**
- **Object storage** (MinIO)
- **Game servers** (Minecraft, Palworld)

## Storage Classes

| Name                 | Provisioner           | Node Path                    | Use Case                      |
| -------------------- | --------------------- | ---------------------------- | ----------------------------- |
| `hdd-storage`        | rancher.io/local-path | `/mnt/hdd1/data/k8s-volumes` | General HDD storage (default) |
| `hdd-media-storage`  | rancher.io/local-path | `/mnt/hdd1`                  | Direct media file access      |
| `ssd-storage`        | rancher.io/local-path | `/mnt/ssd1/k8s-volumes`      | Fast SSD storage              |
| `ssd-photos-storage` | rancher.io/local-path | `/mnt/ssd1`                  | Direct photo library access   |

## Persistent Volumes

### Application Storage (HDD)

- **`app-configs-pv`** (20Gi) - Application configuration files
- **`game-servers-pv`** (100Gi) - Game server data (Minecraft, Palworld)
- **`media-services-pv`** (50Gi) - Media management service configs
- **`minio-data-pv`** (1Ti) - S3-compatible object storage
- **`postgres-main-pv`** (100Gi) - Main PostgreSQL database

### Performance Storage (SSD)

- **`build-cache-pv`** (100Gi) - CI/CD build cache
- **`immich-db-pv`** (50Gi) - Immich database
- **`redis-cache-pv`** (10Gi) - Redis cache

### Media Storage (HDD)

- **`movies-pv`** (10Ti) - Movie collection
- **`tv-pv`** (5Ti) - TV show collection

### Photo Storage (SSD)

- **`google-photos-pv`** (500Gi) - Google Photos backup
- **`immich-library-pv`** (2Ti) - Immich photo library

## Deployment

Apply storage resources in order:

```bash
# Apply storage classes first
kubectl apply -f k8s/storage/storage-classes.yaml

# Then apply persistent volumes
kubectl apply -f k8s/storage/persistent-volumes.yaml
```

## Capacity Planning

### Current Allocations

- **Total HDD**: ~16.17 Ti allocated
- **Total SSD**: ~3.16 Ti allocated

### Host Path Mapping

- **HDD**: `/mnt/hdd1` (physical HDD storage)
- **SSD**: `/mnt/ssd1` (physical SSD storage)

## Backup Strategy

### Retain Policy

All persistent volumes use `Retain` reclaim policy to prevent accidental data loss.

### Volume Snapshots

Consider implementing volume snapshots for critical databases and configuration data.

## Monitoring

Monitor storage usage with:

```bash
# Check storage class usage
kubectl get storageclass

# Check persistent volume status
kubectl get pv

# Check persistent volume claims
kubectl get pvc --all-namespaces
```

## Troubleshooting

### Common Issues

1. **PV stuck in Pending**: Check node selector and path availability
2. **Permission errors**: Ensure proper directory permissions on host
3. **Capacity issues**: Monitor disk usage on host paths

### Verification Commands

```bash
# Verify storage classes
kubectl describe storageclass hdd-storage

# Check persistent volume details
kubectl describe pv minio-data-pv

# Monitor storage usage
df -h /mnt/hdd1 /mnt/ssd1
```
