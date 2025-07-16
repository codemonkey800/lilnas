# Dashcam Helm Chart

A Helm chart for deploying the lilnas dashcam video viewer - a static frontend application built with Vite + React for browsing and viewing dashcam video files.

## Overview

The dashcam service is a lightweight static web application that provides:
- Video file browsing and playback interface
- Responsive design for mobile and desktop viewing
- Direct access to dashcam video files
- Public accessibility (no authentication required)

## Prerequisites

- Kubernetes cluster with Helm 3.x
- Traefik ingress controller
- cert-manager for TLS certificate management
- Access to `ghcr.io/codemonkey800/lilnas-dashcam` container image

## Installation

### Quick Start

```bash
# Deploy to production
./deploy.sh

# Or deploy with explicit environment
./deploy.sh prod
```

### Manual Installation

```bash
# Update dependencies
helm dependency update

# Install the chart
helm install dashcam . \
  --namespace lilnas-apps \
  --create-namespace \
  --values values.yaml \
  --values values-prod.yaml
```

## Configuration

### Values Files

- `values.yaml` - Base configuration for all environments
- `values-prod.yaml` - Production-specific overrides

### Key Configuration Options

#### Image Configuration
```yaml
image:
  repository: ghcr.io/codemonkey800/lilnas-dashcam
  tag: "latest"
  pullPolicy: Always
```

#### Service Configuration
```yaml
service:
  type: ClusterIP
  port: 80
  targetPort: 80  # nginx serves on port 80
```

#### Ingress Configuration (Public Access)
```yaml
ingress:
  enabled: true
  className: traefik
  hosts:
    - host: dashcam.lilnas.io
      paths:
        - path: /
          pathType: Prefix
  tls:
    - hosts:
        - dashcam.lilnas.io
      secretName: dashcam-lilnas-io-tls
```

**Note**: The dashcam service is configured for public access without authentication. The `forward-auth` middleware is intentionally not applied.

#### Resource Configuration
```yaml
resources:
  requests:
    memory: "64Mi"
    cpu: "50m"
  limits:
    memory: "128Mi"
    cpu: "200m"
```

#### Security Configuration
```yaml
podSecurityContext:
  runAsNonRoot: true
  runAsUser: 101  # nginx user
  runAsGroup: 101
  fsGroup: 101

containerSecurityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
```

## Scripts

### deploy.sh
Deploys the chart to the specified environment:
```bash
./deploy.sh [environment]
```

### test-render.sh
Tests chart rendering without deployment:
```bash
./test-render.sh [environment]
```

### uninstall.sh
Removes the deployment from the cluster:
```bash
./uninstall.sh
```

## Deployment

### Production Deployment

```bash
# Test the chart first
./test-render.sh prod

# Deploy to production
./deploy.sh prod
```

The service will be available at: `https://dashcam.lilnas.io`

## Monitoring

### Check Deployment Status
```bash
# Check Helm release
helm status dashcam -n lilnas-apps

# Check Kubernetes resources
kubectl get all -n lilnas-apps -l app.kubernetes.io/name=dashcam

# Check ingress
kubectl get ingress -n lilnas-apps -l app.kubernetes.io/name=dashcam
```

### View Logs
```bash
# View application logs
kubectl logs -n lilnas-apps deployment/dashcam -f

# View recent logs
kubectl logs -n lilnas-apps deployment/dashcam --tail=100
```

### Resource Usage
```bash
# Check resource usage
kubectl top pods -n lilnas-apps -l app.kubernetes.io/name=dashcam
```

## Troubleshooting

### Common Issues

1. **Pod not starting**
   - Check image availability: `kubectl describe pod -n lilnas-apps <pod-name>`
   - Verify image pull secrets are configured

2. **Service not accessible**
   - Check ingress configuration: `kubectl describe ingress -n lilnas-apps dashcam`
   - Verify DNS configuration for `dashcam.lilnas.io`
   - Check cert-manager certificate: `kubectl get certificate -n lilnas-apps`

3. **TLS certificate issues**
   - Check cert-manager logs: `kubectl logs -n cert-manager deployment/cert-manager`
   - Verify ClusterIssuer: `kubectl get clusterissuer letsencrypt-prod`

### Debug Commands

```bash
# Check pod events
kubectl describe pod -n lilnas-apps <pod-name>

# Check service endpoints
kubectl get endpoints -n lilnas-apps dashcam

# Check ingress events
kubectl describe ingress -n lilnas-apps dashcam

# Check certificate status
kubectl describe certificate -n lilnas-apps dashcam-lilnas-io-tls
```

## Architecture

### Components

- **Deployment**: Single replica nginx container serving static files
- **Service**: ClusterIP service exposing port 80
- **Ingress**: Public ingress with TLS termination
- **ServiceAccount**: Minimal service account for pod

### Security

- Read-only root filesystem
- Non-root user (nginx user ID 101)
- Dropped capabilities
- Security context enforcement
- No persistent storage (stateless)

### Volumes

- `tmp`: EmptyDir for temporary files
- `nginx-cache`: EmptyDir for nginx cache
- `nginx-run`: EmptyDir for nginx runtime files

## Maintenance

### Updating

```bash
# Update to latest image
helm upgrade dashcam . \
  --namespace lilnas-apps \
  --values values.yaml \
  --values values-prod.yaml \
  --set image.tag=latest
```

### Scaling

The dashcam service is designed as a single-replica deployment since it's a static site. If needed, you can scale:

```bash
# Scale to multiple replicas
kubectl scale deployment dashcam -n lilnas-apps --replicas=2
```

### Backup

No backup is required as the service serves static files built into the container image.

## Development

### Local Testing

```bash
# Test chart rendering
helm template dashcam . \
  --values values.yaml \
  --values values-prod.yaml \
  --debug

# Lint the chart
helm lint . --values values.yaml --values values-prod.yaml
```

### Chart Dependencies

This chart depends on the `lilnas-common` library chart for shared templates and helpers.

## Contributing

1. Test changes with `./test-render.sh`
2. Update documentation if needed
3. Follow lilnas Helm chart conventions
4. Test deployment in development environment first

## License

This chart is part of the lilnas project. See the main project repository for license information.