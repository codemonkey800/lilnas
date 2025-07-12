# MinIO Helm Chart

A Helm chart for deploying MinIO S3-compatible object storage in the lilnas Kubernetes cluster.

## Overview

This chart deploys MinIO with the following features:

- StatefulSet with persistent storage
- S3 API and admin console services
- Ingress with SSL support
- Automatic bucket initialization
- Environment-specific configurations (dev/prod)

## Prerequisites

- Kubernetes cluster with lilnas infrastructure
- Helm 3.x
- cert-manager (for SSL certificates)
- Traefik ingress controller
- Storage classes configured

## Installation

### Development Environment

```bash
# Install MinIO for development
helm install minio . --values values-dev.yaml

# Or with custom namespace
helm install minio . --values values-dev.yaml --namespace lilnas-core
```

### Production Environment

```bash
# Install MinIO for production
helm install minio . --values values-prod.yaml

# Or with custom release name
helm install storage . --values values-prod.yaml --namespace lilnas-core
```

## Configuration

### Key Configuration Options

| Parameter              | Description            | Default                   |
| ---------------------- | ---------------------- | ------------------------- |
| `auth.rootUser`        | MinIO root username    | `admin`                   |
| `auth.rootPassword`    | MinIO root password    | `password`                |
| `existingSecret`       | Use external secret    | `""`                      |
| `ingress.api.host`     | S3 API hostname        | `storage.lilnas.io`       |
| `ingress.console.host` | Admin console hostname | `storage-admin.lilnas.io` |
| `storage.size`         | Storage size           | `1Ti`                     |
| `storage.className`    | Storage class          | `hdd-storage`             |

### Environment-Specific Values

**Development (`values-dev.yaml`):**

- Uses localhost domains
- Smaller storage allocation (100Gi)
- No SSL/TLS
- Reduced resource limits

**Production (`values-prod.yaml`):**

- Uses lilnas.io domains
- Full storage allocation (1Ti)
- SSL/TLS enabled
- Production resource limits

## Usage Examples

### Basic Installation

```bash
helm install minio .
```

### Custom Configuration

```bash
helm install minio . --set auth.rootUser=myuser --set auth.rootPassword=mypassword
```

### Using External Secrets (Recommended for Production)

For production deployments, it's recommended to use an external secret instead of storing passwords in values files:

1. Create the secret:

```bash
kubectl create secret generic minio-credentials \
  --from-literal=MINIO_ROOT_USER=<username> \
  --from-literal=MINIO_ROOT_PASSWORD=<password> \
  --from-literal=MINIO_BROWSER_REDIRECT_URL=https://storage-admin.lilnas.io \
  --from-literal=MINIO_SERVER_URL=https://storage.lilnas.io \
  -n lilnas-core
```

2. Install MinIO referencing the external secret:

```bash
helm install minio . --values values-prod.yaml --set existingSecret=minio-credentials
```

Or add to your values file:

```yaml
existingSecret: minio-credentials
```

### Upgrade

```bash
helm upgrade minio . --values values-prod.yaml
```

### Uninstall

```bash
helm uninstall minio
```

## Accessing MinIO

### S3 API

- **Development**: `http://storage.localhost`
- **Production**: `https://storage.lilnas.io`

### Admin Console

- **Development**: `http://storage-admin.localhost`
- **Production**: `https://storage-admin.lilnas.io`

## Values File Structure

```yaml
# Authentication
auth:
  rootUser: username
  rootPassword: password

# Ingress configuration
ingress:
  enabled: true
  api:
    host: storage.example.com
  console:
    host: storage-admin.example.com
  tls:
    enabled: true

# Storage configuration
storage:
  className: hdd-storage
  size: 1Ti

# Bucket initialization
initJob:
  enabled: true
  buckets:
    - name: equations
      public: true
    - name: videos
      public: true
```

## Troubleshooting

### Common Issues

1. **Pod stuck in Pending**

   ```bash
   kubectl describe pv
   kubectl get storageclass
   ```

2. **Ingress not working**

   ```bash
   kubectl get ingress -n lilnas-core
   kubectl describe ingress minio-api -n lilnas-core
   ```

3. **SSL certificate issues**
   ```bash
   kubectl get certificates -n lilnas-core
   kubectl describe certificate minio-api-tls -n lilnas-core
   ```

### Debugging Commands

```bash
# Check all resources
helm status minio

# Check pods
kubectl get pods -l app.kubernetes.io/name=minio -n lilnas-core

# Check logs
kubectl logs -l app.kubernetes.io/name=minio -n lilnas-core

# Check init job
kubectl logs job/minio-init -n lilnas-core
```

## Development

### Testing the Chart

```bash
# Validate chart
helm lint .

# Test template rendering
helm template minio . --values values-dev.yaml

# Dry run install
helm install minio . --values values-dev.yaml --dry-run
```

### Updating the Chart

1. Make changes to templates or values
2. Update Chart.yaml version
3. Test with `helm template`
4. Install/upgrade to test

## Security Considerations

- Change default credentials in production
- Use strong passwords
- Review bucket policies
- Enable SSL/TLS in production
- Consider network policies

## Resources

- [MinIO Documentation](https://docs.min.io/)
- [Helm Documentation](https://helm.sh/docs/)
- [Kubernetes Storage](https://kubernetes.io/docs/concepts/storage/)
