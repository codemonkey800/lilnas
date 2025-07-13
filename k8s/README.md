# lilnas Kubernetes Infrastructure

This directory contains the Kubernetes manifests and configuration for the lilnas self-hosted NAS system. The infrastructure is organized into logical components for maintainability and scalability.

## Architecture Overview

### Infrastructure Tiers

- **Core**: Foundational services (cert-manager, Traefik, storage)
- **Applications**: Main lilnas services (apps, equations, bots)
- **Media**: Media management stack (Sonarr, Radarr, Emby)
- **Monitoring**: Observability stack (Prometheus, Grafana)
- **Development**: Testing and development environment

### Core Components

#### cert-manager

SSL certificate management with Let's Encrypt integration.

- **Installation Method**: kubectl apply + Helm chart for ClusterIssuers
- **Status**: ✅ Deployed
- **Configuration**: ClusterIssuers for staging and production

#### Traefik Ingress Controller

HTTP reverse proxy and load balancer for routing external traffic.

- **Installation Method**: Built-in with k3s
- **Status**: ✅ Deployed (via k3s)
- **Configuration**: Default k3s configuration

#### Storage Classes & Persistent Volumes

Tiered storage configuration for different workload requirements.

- **Installation Method**: Helm chart
- **Status**: ✅ Deployed
- See [Storage Architecture](#storage-architecture) section below

#### Forward Auth

OAuth2 forward authentication service for Traefik.

- **Installation Method**: Helm chart
- **Status**: ✅ Deployed

#### Turbo Cache

Turborepo remote cache for build optimization.

- **Installation Method**: Helm chart
- **Status**: ✅ Deployed

### Storage Architecture

#### Storage Tiers

- **SSD Storage** (`/mnt/ssd1`): High-performance storage for databases, photo libraries, and build cache
- **HDD Storage** (`/mnt/hdd1`): Cost-effective storage for media files, configurations, and object storage

#### Storage Classes

| Name                 | Provisioner           | Node Path                    | Use Case                      |
| -------------------- | --------------------- | ---------------------------- | ----------------------------- |
| `hdd-storage`        | rancher.io/local-path | `/mnt/hdd1/data/k8s-volumes` | General HDD storage (default) |
| `hdd-media-storage`  | rancher.io/local-path | `/mnt/hdd1`                  | Direct media file access      |
| `ssd-storage`        | rancher.io/local-path | `/mnt/ssd1/k8s-volumes`      | Fast SSD storage              |
| `ssd-photos-storage` | rancher.io/local-path | `/mnt/ssd1`                  | Direct photo library access   |

## Directory Structure

```
k8s/
├── charts/               # Helm charts
│   ├── _library/        # Common Helm library chart
│   ├── cert-manager-issuers/  # Let's Encrypt ClusterIssuers
│   ├── forward-auth/    # OAuth2 authentication service
│   ├── minio/           # MinIO object storage
│   ├── namespaces/      # Namespace management
│   ├── storage-setup/   # Storage classes and PVs
│   └── turbo-cache/     # Turborepo remote cache
├── ci-cd/               # CI/CD integration (GitHub Actions)
│   ├── github-actions-rbac.yml
│   ├── github-actions-rbac-extended.yml
│   ├── setup-service-account.sh
│   └── README.md
├── scripts/             # Utility scripts
│   ├── lib/
│   │   └── common.sh
│   └── verify-infrastructure.sh
├── secrets/             # Secret templates and deployment scripts
│   ├── ghcr-secret-template.yaml
│   └── deploy-ghcr-secret.sh
└── README.md           # This file
```

## Current Status

### ✅ Deployed Infrastructure

- **k3s cluster** with Traefik ingress controller
- **cert-manager** with Let's Encrypt ClusterIssuers (Helm chart)
- **Storage tiers** with 4 storage classes and 12 persistent volumes (Helm chart)
- **Namespaces** for logical organization (Helm chart)
- **Container registry access** via GHCR secrets
- **MinIO** object storage (Helm chart)
- **Forward Auth** OAuth2 authentication (Helm chart)
- **Turbo Cache** Turborepo remote cache (Helm chart)

### 🚧 Pending Implementation

- **Application deployments** (Phase 2 of k8s migration)
- **Monitoring stack** (Prometheus, Grafana)
- **Media services** (Sonarr, Radarr, Emby)
- **Development environment** setup

## Quick Start

### Prerequisites

- k3s cluster installed and running
- kubectl configured with cluster access
- Helm 3.x installed
- DNS records pointing to the cluster (for Let's Encrypt)
- GitHub Personal Access Token for container registry

### Installation Order

The components must be installed in a specific order due to dependencies:

1. **k3s cluster** (includes Traefik ingress controller)

2. **Install cert-manager**:

   ```bash
   # Install cert-manager CRDs and components
   kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

   # Wait for cert-manager to be ready
   kubectl wait --for=condition=Ready pods -l app.kubernetes.io/instance=cert-manager -n cert-manager --timeout=120s
   ```

3. **Deploy namespaces** (creates organizational structure):

   ```bash
   helm install namespaces charts/namespaces -f charts/namespaces/values-prod.yaml
   ```

4. **Deploy storage resources** (storage classes and persistent volumes):

   ```bash
   helm install storage-setup charts/storage-setup -f charts/storage-setup/values-prod.yaml
   ```

5. **Deploy ClusterIssuers** (for Let's Encrypt certificates):

   ```bash
   helm install cert-manager-issuers charts/cert-manager-issuers -f charts/cert-manager-issuers/values-prod.yaml
   ```

6. **Deploy GHCR secrets** (for container registry access):

   ```bash
   export GITHUB_TOKEN=ghp_your_token_here
   ./secrets/deploy-ghcr-secret.sh
   ```

7. **Deploy core services** (MinIO, Forward Auth, Turbo Cache):

   ```bash
   # MinIO object storage
   helm install minio charts/minio -n lilnas-core -f charts/minio/values-prod.yaml

   # Forward authentication
   helm install forward-auth charts/forward-auth -n lilnas-core -f charts/forward-auth/values-prod.yaml \
     --set auth.googleClientId="your-client-id" \
     --set auth.googleClientSecret="your-client-secret" \
     --set auth.secret="your-secret"

   # Turbo cache
   helm install turbo-cache charts/turbo-cache -n lilnas-core -f charts/turbo-cache/values-prod.yaml \
     --set auth.turboToken="your-token" \
     --set auth.s3AccessKey="your-access-key" \
     --set auth.s3SecretKey="your-secret-key"
   ```

### Verification

```bash
# Check Helm releases
helm list -A

# Check all components
kubectl get namespaces | grep lilnas
kubectl get storageclass
kubectl get pv
kubectl get clusterissuers
kubectl get secrets --all-namespaces | grep ghcr-secret

# Check core services
kubectl get all -n lilnas-core
kubectl get ingress -n lilnas-core
```

## Component Documentation

Each Helm chart contains detailed documentation:

- **[cert-manager-issuers](charts/cert-manager-issuers/)** - Let's Encrypt ClusterIssuers
- **[forward-auth](charts/forward-auth/)** - OAuth2 authentication service
- **[minio](charts/minio/)** - S3-compatible object storage
- **[namespaces](charts/namespaces/)** - Namespace organization and policies
- **[storage-setup](charts/storage-setup/)** - Storage classes and persistent volumes
- **[turbo-cache](charts/turbo-cache/)** - Turborepo remote cache
- **[CI/CD Integration](ci-cd/README.md)** - GitHub Actions Kubernetes access

## Monitoring

### Health Checks

```bash
# Check cluster status
kubectl cluster-info

# Check node health
kubectl get nodes

# Check all core components
kubectl get pods -n cert-manager
kubectl get pods -n kube-system | grep traefik
kubectl get pods -n lilnas-core

# Check certificates
kubectl get certificates --all-namespaces

# Check ClusterIssuers
kubectl get clusterissuers
```

### Resource Usage

```bash
# Check storage usage
kubectl get pv
kubectl get pvc --all-namespaces

# Monitor disk usage on host paths
df -h /mnt/hdd1 /mnt/ssd1

# Check namespace resource usage
kubectl top nodes
kubectl top pods --all-namespaces
```

### Logs

```bash
# cert-manager logs
kubectl logs -n cert-manager -l app=cert-manager

# Traefik logs
kubectl logs -n kube-system -l app.kubernetes.io/name=traefik

# Core service logs
kubectl logs -n lilnas-core -l app.kubernetes.io/name=forward-auth
kubectl logs -n lilnas-core -l app=minio
kubectl logs -n lilnas-core -l app=turbo-cache
```

## Troubleshooting

### Common Issues

#### Core Infrastructure

1. **Namespace not found**: Apply namespace manifests first
2. **PV not binding**: Check storage class and node selector
3. **Image pull errors**: Verify GHCR secrets are deployed

#### cert-manager

1. **Certificate not issuing**:
   - Check ClusterIssuer status: `kubectl describe clusterissuer letsencrypt-prod`
   - Verify DNS configuration is correct
   - Check cert-manager logs for errors
2. **Let's Encrypt rate limits**: Use staging issuer for testing

#### Traefik

1. **Service not accessible**:
   - Check ingress configuration
   - Verify service endpoints exist
   - Check Traefik logs
2. **SSL termination issues**: Verify cert-manager is working properly

#### Storage

1. **PV stuck in Pending**: Check node selector and path availability
2. **Permission errors**: Ensure proper directory permissions on host
3. **Capacity issues**: Monitor disk usage on host paths

### Useful Commands

```bash
# Debug pod issues
kubectl describe pod <pod-name> -n <namespace>

# Check events
kubectl get events --all-namespaces --sort-by=.metadata.creationTimestamp

# Check logs
kubectl logs <pod-name> -n <namespace>

# Describe ClusterIssuer for troubleshooting
kubectl describe clusterissuer letsencrypt-prod

# Check certificate status
kubectl describe certificate <certificate-name> -n <namespace>

# View Traefik configuration
kubectl get ingress --all-namespaces

# Verify storage classes
kubectl describe storageclass hdd-storage

# Check persistent volume details
kubectl describe pv <pv-name>
```

## Security Considerations

- **Secrets**: Use environment variables, never commit tokens
- **RBAC**: Implement proper role-based access controls
- **Network Policies**: Consider pod-to-pod communication restrictions
- **Image Security**: Use verified base images and vulnerability scanning

## Next Steps

1. **Application Migration**: Move services from Docker Compose to Kubernetes
2. **Monitoring Setup**: Deploy Prometheus and Grafana
3. **GitOps**: Implement ArgoCD for automated deployments
4. **Backup Strategy**: Set up persistent volume backups

## Contributing

When adding new infrastructure:

1. Follow the existing directory structure
2. Add appropriate documentation
3. Update this README with new components
4. Test deployment in dev environment first

For more details on the k8s migration progress, see [GitHub Issue #13](https://github.com/codemonkey800/lilnas/issues/13).
