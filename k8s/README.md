# lilnas Kubernetes Infrastructure

This directory contains the Kubernetes manifests and configuration for the lilnas self-hosted NAS system. The infrastructure is organized into logical components for maintainability and scalability.

## Architecture Overview

### Infrastructure Tiers

- **Core**: Foundational services (cert-manager, Traefik, storage)
- **Applications**: Main lilnas services (apps, equations, bots)
- **Media**: Media management stack (Sonarr, Radarr, Emby)
- **Monitoring**: Observability stack (Prometheus, Grafana)
- **Development**: Testing and development environment

### Storage Strategy

- **SSD Tier**: High-performance storage for databases and photos
- **HDD Tier**: Cost-effective storage for media files and backups

## Directory Structure

```
k8s/
├── apps/                 # Application deployments (TODO)
├── cert-manager/         # SSL certificate management
│   └── letsencrypt-issuers.yaml
├── charts/               # Helm charts
│   └── minio/           # MinIO object storage
├── ci-cd/               # CI/CD integration (GitHub Actions)
│   ├── github-actions-rbac.yaml
│   ├── github-actions-rbac-extended.yaml
│   ├── setup-service-account.sh
│   └── README.md
├── core/                 # Core infrastructure documentation
│   └── README.md
├── namespaces/           # Namespace definitions
│   └── lilnas-namespaces.yaml
├── scripts/              # Utility scripts
│   └── verify-infrastructure.sh
├── secrets/              # Secret templates and deployment scripts
│   ├── ghcr-secret-template.yaml
│   └── deploy-ghcr-secret.sh
├── storage/              # Storage classes and persistent volumes
│   ├── storage-classes.yaml
│   ├── persistent-volumes.yaml
│   └── README.md
└── README.md            # This file
```

## Current Status

### ✅ Deployed Infrastructure

- **k3s cluster** with Traefik ingress controller
- **cert-manager** with Let's Encrypt ClusterIssuers
- **Storage tiers** with 4 storage classes and 12 persistent volumes
- **Namespaces** for logical organization
- **Container registry access** via GHCR secrets

### 🚧 Pending Implementation

- **Application deployments** (Phase 2 of k8s migration)
- **Monitoring stack** (Prometheus, Grafana)
- **Media services** (Sonarr, Radarr, Emby)
- **Development environment** setup

## Quick Start

### Prerequisites

- k3s cluster installed and running
- kubectl configured with cluster access
- GitHub Personal Access Token for container registry

### Deployment Order

1. **Apply namespaces**:

   ```bash
   kubectl apply -f namespaces/lilnas-namespaces.yaml
   ```

2. **Deploy storage resources**:

   ```bash
   kubectl apply -f storage/storage-classes.yaml
   kubectl apply -f storage/persistent-volumes.yaml
   ```

3. **Configure cert-manager** (if not already done):

   ```bash
   kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
   kubectl apply -f cert-manager/letsencrypt-issuers.yaml
   ```

4. **Deploy GHCR secrets**:
   ```bash
   export GITHUB_TOKEN=ghp_your_token_here
   ./secrets/deploy-ghcr-secret.sh
   ```

### Verification

```bash
# Check all components
kubectl get namespaces | grep lilnas
kubectl get storageclass
kubectl get pv
kubectl get clusterissuers
kubectl get secrets --all-namespaces | grep ghcr-secret
```

## Component Documentation

- **[Storage Architecture](storage/README.md)** - Detailed storage configuration
- **[Core Infrastructure](core/README.md)** - cert-manager and Traefik setup
- **[CI/CD Integration](ci-cd/README.md)** - GitHub Actions Kubernetes access
- **[Secrets Management](secrets/)** - Container registry authentication

## Monitoring

### Health Checks

```bash
# Check cluster status
kubectl cluster-info

# Check node health
kubectl get nodes

# Check core pods
kubectl get pods -n cert-manager
kubectl get pods -n kube-system | grep traefik
```

### Resource Usage

```bash
# Check storage usage
kubectl get pv
kubectl get pvc --all-namespaces

# Check namespace resource usage
kubectl top nodes
kubectl top pods --all-namespaces
```

## Troubleshooting

### Common Issues

1. **Namespace not found**: Apply namespace manifests first
2. **PV not binding**: Check storage class and node selector
3. **Image pull errors**: Verify GHCR secrets are deployed
4. **Certificate issues**: Check ClusterIssuer status and DNS

### Useful Commands

```bash
# Debug pod issues
kubectl describe pod <pod-name> -n <namespace>

# Check events
kubectl get events --all-namespaces --sort-by=.metadata.creationTimestamp

# Check logs
kubectl logs <pod-name> -n <namespace>
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
