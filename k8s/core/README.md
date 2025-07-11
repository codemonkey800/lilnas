# Core Infrastructure

This directory contains the core infrastructure components for the lilnas k8s cluster. These are the foundational services that other applications depend on.

## Components

### cert-manager

SSL certificate management with Let's Encrypt integration.

**Status**: ✅ Deployed
**Installation Method**: kubectl apply
**Configuration**: ClusterIssuers for staging and production

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Apply ClusterIssuers
kubectl apply -f ../cert-manager/letsencrypt-issuers.yaml
```

**Verification**:

```bash
# Check cert-manager pods
kubectl get pods -n cert-manager

# Check ClusterIssuers
kubectl get clusterissuers
```

### Traefik Ingress Controller

HTTP reverse proxy and load balancer for routing external traffic.

**Status**: ✅ Deployed (via k3s)
**Installation Method**: Built-in with k3s
**Configuration**: Default k3s configuration

Traefik is automatically installed and configured by k3s as the default ingress controller.

**Verification**:

```bash
# Check Traefik deployment
kubectl get pods -n kube-system | grep traefik

# Check Traefik service
kubectl get svc -n kube-system | grep traefik
```

**Access**:

- Dashboard: https://lilnas.io/dashboard/ (if configured)
- API: https://lilnas.io/api/rawdata (if configured)

### Storage Classes & Persistent Volumes

Tiered storage configuration for different workload requirements.

**Status**: ✅ Deployed
**Configuration**: Located in `../storage/`

See [Storage README](../storage/README.md) for detailed information.

## Dependencies

### Prerequisites

- k3s cluster installed and running
- kubectl configured with cluster access
- DNS records pointing to the cluster (for Let's Encrypt)

### Installation Order

1. **k3s cluster** (includes Traefik)
2. **cert-manager** (for SSL certificates)
3. **ClusterIssuers** (for Let's Encrypt)
4. **Storage Classes** (for persistent volumes)
5. **Persistent Volumes** (for storage)
6. **Namespaces** (for organization)
7. **Secrets** (for container registry access)

## Monitoring

### Health Checks

```bash
# Check all core components
kubectl get pods -n cert-manager
kubectl get pods -n kube-system | grep traefik

# Check certificates
kubectl get certificates --all-namespaces

# Check ClusterIssuers
kubectl get clusterissuers
```

### Logs

```bash
# cert-manager logs
kubectl logs -n cert-manager -l app=cert-manager

# Traefik logs
kubectl logs -n kube-system -l app.kubernetes.io/name=traefik
```

## Troubleshooting

### Common Issues

#### cert-manager

- **Certificate not issuing**: Check ClusterIssuer status and DNS configuration
- **Let's Encrypt rate limits**: Use staging issuer for testing

#### Traefik

- **Service not accessible**: Check ingress configuration and service endpoints
- **SSL termination issues**: Verify cert-manager is working properly

### Useful Commands

```bash
# Describe ClusterIssuer for troubleshooting
kubectl describe clusterissuer letsencrypt-prod

# Check certificate status
kubectl describe certificate <certificate-name> -n <namespace>

# View Traefik configuration
kubectl get ingress --all-namespaces
```
