# turbo-cache

Turborepo remote cache service for build optimization in the lilnas ecosystem.

## TL;DR

```bash
helm install turbo-cache ./k8s/charts/turbo-cache \
  --namespace lilnas-core \
  --create-namespace \
  --set auth.turboToken=your-token \
  --set auth.s3AccessKey=your-access-key \
  --set auth.s3SecretKey=your-secret-key
```

## Introduction

This chart deploys a Turborepo remote cache service on a Kubernetes cluster using the Helm package manager. The remote cache helps speed up builds by sharing build artifacts across different environments and CI/CD pipelines.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.2.0+
- MinIO or S3-compatible storage (deployed separately)

## Installing the Chart

To install the chart with the release name `turbo-cache`:

```bash
helm install turbo-cache ./k8s/charts/turbo-cache -f values.yaml
```

## Uninstalling the Chart

To uninstall/delete the `turbo-cache` deployment:

```bash
helm delete turbo-cache
```

## Configuration

The following table lists the configurable parameters of the turbo-cache chart and their default values.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of replicas | `1` |
| `namespace` | Kubernetes namespace | `lilnas-core` |
| `image.repository` | Image repository | `ducktors/turborepo-remote-cache` |
| `image.tag` | Image tag (uses appVersion if not set) | `""` |
| `image.pullPolicy` | Image pull policy | `IfNotPresent` |
| `service.type` | Kubernetes service type | `ClusterIP` |
| `service.port` | Service port | `80` |
| `service.targetPort` | Container port | `3000` |
| `serviceAccount.create` | Create service account | `true` |
| `serviceAccount.name` | Service account name | `""` |
| `config.logLevel` | Log level | `info` |
| `config.storageProvider` | Storage provider | `minio` |
| `config.storagePath` | Storage path | `build` |
| `config.s3Endpoint` | S3 endpoint URL | `http://minio.lilnas-core:9000` |
| `config.awsRegion` | AWS region | `us-west-2` |
| `auth.turboToken` | Turbo authentication token | `""` |
| `auth.s3AccessKey` | S3 access key | `""` |
| `auth.s3SecretKey` | S3 secret key | `""` |
| `existingSecret` | Use existing secret | `""` |
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.className` | Ingress class | `traefik` |
| `ingress.host` | Ingress hostname | `turbo.lilnas.io` |
| `ingress.tls.enabled` | Enable TLS | `true` |
| `ingress.tls.issuer` | Certificate issuer | `letsencrypt-prod` |
| `resources.requests.memory` | Memory request | `128Mi` |
| `resources.requests.cpu` | CPU request | `100m` |
| `resources.limits.memory` | Memory limit | `512Mi` |
| `resources.limits.cpu` | CPU limit | `500m` |

### Environment-Specific Values

The chart includes environment-specific value files:

- `values-dev.yaml`: Development environment settings
- `values-prod.yaml`: Production environment settings

To deploy with environment-specific values:

```bash
# Development
helm install turbo-cache ./k8s/charts/turbo-cache -f ./k8s/charts/turbo-cache/values-dev.yaml

# Production
helm install turbo-cache ./k8s/charts/turbo-cache -f ./k8s/charts/turbo-cache/values-prod.yaml
```

### Using an Existing Secret

If you prefer to manage secrets externally, create a secret with the following keys:
- `TURBO_TOKEN`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`

Then reference it in your values:

```yaml
existingSecret: "my-turbo-cache-secret"
```

## Security Considerations

- The pod runs with a non-root user (UID 1000)
- Read-only root filesystem is enforced
- All capabilities are dropped
- Seccomp profile is set to RuntimeDefault
- Temporary directories are mounted as emptyDir volumes

## Persistence

This chart uses ephemeral storage for temporary files and cache. The actual build artifacts are stored in MinIO/S3, which should be deployed separately.

## Monitoring

The service exposes a health check endpoint at `/v8/artifacts/status` which is used for both liveness and readiness probes.

### Health Check Endpoints

- `/v8/artifacts/status` - Health check endpoint (used by probes)

### View Logs

```bash
# View turbo-cache logs
kubectl logs -n lilnas-core -l app=turbo-cache -f

# View logs with timestamps
kubectl logs -n lilnas-core -l app=turbo-cache --timestamps
```

## Verification

Verify the deployment is running correctly:

```bash
# Check pod status
kubectl get pods -n lilnas-core -l app=turbo-cache

# Check service endpoints
kubectl get endpoints -n lilnas-core turbo-cache

# View deployment details
kubectl describe deployment turbo-cache -n lilnas-core

# Check ingress configuration
kubectl get ingress -n lilnas-core turbo-cache-ingress
```

## Troubleshooting

### Common Issues

1. **Pod not starting**:
   - Check secrets are properly configured: `kubectl get secret -n lilnas-core turbo-cache`
   - Verify MinIO/S3 credentials are correct
   - Check pod logs for specific errors

2. **Cannot connect to cache**:
   - Verify ingress is properly configured
   - Check SSL certificate is valid
   - Ensure DNS resolves correctly

3. **Authentication failures**:
   - Verify turbo token matches client configuration
   - Check environment variables in pod: `kubectl exec -n lilnas-core deploy/turbo-cache -- env | grep TURBO`

4. **S3 connection issues**:
   - Verify S3 endpoint is reachable from pod
   - Check access key and secret key are correct
   - Ensure bucket exists and has proper permissions

### Debug Commands

```bash
# View logs
kubectl logs -n lilnas-core -l app=turbo-cache -f

# Check environment variables
kubectl exec -n lilnas-core deploy/turbo-cache -- env

# Test S3 connectivity from pod
kubectl exec -n lilnas-core deploy/turbo-cache -- curl -I http://minio:9000

# Check events
kubectl get events -n lilnas-core --field-selector involvedObject.name=turbo-cache

# Port-forward for local testing
kubectl port-forward -n lilnas-core svc/turbo-cache 3000:3000

# Test health endpoint locally
curl http://localhost:3000/v8/artifacts/status
```

### Client Configuration

Configure your Turborepo projects to use the remote cache:

```json
// .turbo/config.json or turbo.json
{
  "remoteCache": {
    "signature": true
  }
}
```

Set environment variables:
```bash
export TURBO_API="https://turbo.lilnas.io"
export TURBO_TOKEN="your-turbo-token"
export TURBO_TEAM="team_lilnas"
```

### Performance Tuning

1. **Increase replicas** for better availability:
   ```yaml
   replicaCount: 2
   ```

2. **Adjust resource limits** based on usage:
   ```yaml
   resources:
     requests:
       cpu: 200m
       memory: 256Mi
     limits:
       cpu: 1000m
       memory: 1Gi
   ```

3. **Configure horizontal pod autoscaling**:
   ```yaml
   autoscaling:
     enabled: true
     minReplicas: 1
     maxReplicas: 4
     targetCPUUtilizationPercentage: 80
   ```