# equations

LaTeX equation rendering service for the lilnas ecosystem.

## TL;DR

```bash
# Development deployment
./deploy.sh -e dev

# Production deployment with secrets
./deploy.sh -e prod \
  --api-token 'your-api-token' \
  --s3-access-key 'your-access-key' \
  --s3-secret-key 'your-secret-key'
```

## Introduction

This chart deploys a LaTeX equation rendering service on a Kubernetes cluster using the Helm package manager. The service provides secure LaTeX compilation with Docker sandbox isolation, rate limiting, and MinIO storage integration for rendered equations.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.2.0+
- MinIO or S3-compatible storage (deployed separately)
- Docker runtime with LaTeX packages support

## Installing the Chart

### Using the deployment script (recommended)

The easiest way to deploy is using the provided deployment script:

```bash
# Development deployment (uses default test credentials)
./deploy.sh -e dev

# Production deployment with secrets via CLI flags
./deploy.sh -e prod \
  --api-token 'your-api-token' \
  --s3-access-key 'your-access-key' \
  --s3-secret-key 'your-secret-key'

# Production deployment with secrets via environment variables
export EQUATIONS_API_TOKEN='your-api-token'
export EQUATIONS_S3_ACCESS_KEY='your-access-key'
export EQUATIONS_S3_SECRET_KEY='your-secret-key'
./deploy.sh -e prod

# Dry run to preview changes
./deploy.sh -e prod --dry-run \
  --api-token 'your-api-token' \
  --s3-access-key 'your-access-key' \
  --s3-secret-key 'your-secret-key'
```

### Using Helm directly

To install the chart with the release name `equations`:

```bash
# Basic installation
helm install equations ./k8s/charts/equations

# With custom values file
helm install equations ./k8s/charts/equations -f values-prod.yaml

# With secrets provided via command line
helm install equations ./k8s/charts/equations \
  -f values-prod.yaml \
  --set auth.apiToken='your-api-token' \
  --set auth.s3AccessKey='your-access-key' \
  --set auth.s3SecretKey='your-secret-key'
```

### Security Note

**Never commit secrets to version control!** The production values file no longer contains hardcoded secrets. You must provide them via:

- CLI flags (`--api-token`, `--s3-access-key`, `--s3-secret-key`)
- Environment variables (`EQUATIONS_API_TOKEN`, `EQUATIONS_S3_ACCESS_KEY`, `EQUATIONS_S3_SECRET_KEY`)
- Helm `--set` flags
- External secret management solutions

## Uninstalling the Chart

To uninstall/delete the `equations` deployment:

```bash
helm delete equations
```

## Configuration

The following table lists the configurable parameters of the equations chart and their default values.

| Parameter                   | Description                                    | Default                 |
| --------------------------- | ---------------------------------------------- | ----------------------- |
| `replicaCount`              | Number of replicas                             | `1`                     |
| `namespace`                 | Kubernetes namespace                           | `lilnas-core`           |
| `image.repository`          | Image repository                               | `lilnas/equations`      |
| `image.tag`                 | Image tag (uses appVersion if not set)         | `""`                    |
| `image.pullPolicy`          | Image pull policy                              | `IfNotPresent`          |
| `service.type`              | Kubernetes service type                        | `ClusterIP`             |
| `service.port`              | Service port                                   | `80`                    |
| `service.targetPort`        | Container port                                 | `8080`                  |
| `serviceAccount.create`     | Create service account                         | `true`                  |
| `serviceAccount.name`       | Service account name                           | `""`                    |
| `config.port`               | Application port                               | `8080`                  |
| `config.minioHost`          | MinIO host                                     | `minio-api.lilnas-core` |
| `config.minioPort`          | MinIO port                                     | `9000`                  |
| `config.nodeEnv`            | Node environment                               | `production`            |
| `auth.apiToken`             | API authentication token (⚠️ Use CLI/env vars) | `""`                    |
| `auth.s3AccessKey`          | S3/MinIO access key (⚠️ Use CLI/env vars)      | `""`                    |
| `auth.s3SecretKey`          | S3/MinIO secret key (⚠️ Use CLI/env vars)      | `""`                    |
| `existingSecret`            | Use existing secret                            | `""`                    |
| `ingress.enabled`           | Enable ingress                                 | `true`                  |
| `ingress.className`         | Ingress class                                  | `traefik`               |
| `ingress.host`              | Ingress hostname                               | `equations.lilnas.io`   |
| `ingress.tls.enabled`       | Enable TLS                                     | `true`                  |
| `ingress.tls.issuer`        | Certificate issuer                             | `letsencrypt-prod`      |
| `resources.requests.memory` | Memory request                                 | `256Mi`                 |
| `resources.requests.cpu`    | CPU request                                    | `200m`                  |
| `resources.limits.memory`   | Memory limit                                   | `1Gi`                   |
| `resources.limits.cpu`      | CPU limit                                      | `1000m`                 |

### Environment-Specific Values

The chart includes environment-specific value files:

- `values-dev.yaml`: Development environment settings (includes test credentials)
- `values-prod.yaml`: Production environment settings (secrets must be provided separately)

### Authentication and Secrets

For security reasons, production secrets are no longer stored in `values-prod.yaml`. You must provide them through one of these methods:

1. **CLI Flags (recommended for scripts)**:

   ```bash
   ./deploy.sh -e prod \
     --api-token 'your-token' \
     --s3-access-key 'your-key' \
     --s3-secret-key 'your-secret'
   ```

2. **Environment Variables (recommended for CI/CD)**:

   ```bash
   export EQUATIONS_API_TOKEN='your-token'
   export EQUATIONS_S3_ACCESS_KEY='your-key'
   export EQUATIONS_S3_SECRET_KEY='your-secret'
   ./deploy.sh -e prod
   ```

3. **Helm --set flags**:

   ```bash
   helm install equations ./k8s/charts/equations \
     -f values-prod.yaml \
     --set auth.apiToken='your-token' \
     --set auth.s3AccessKey='your-key' \
     --set auth.s3SecretKey='your-secret'
   ```

4. **External Secret Management** (recommended for production):
   - Use Kubernetes Secrets
   - Use external secret managers (Vault, AWS Secrets Manager, etc.)
   - Set `existingSecret` to use an existing Kubernetes secret

To deploy with environment-specific values:

```bash
# Development (uses test credentials from values-dev.yaml)
helm install equations ./k8s/charts/equations -f ./k8s/charts/equations/values-dev.yaml

# Production
helm install equations ./k8s/charts/equations -f ./k8s/charts/equations/values-prod.yaml
```

### Using an Existing Secret

If you prefer to manage secrets externally, create a secret with the following keys:

- `API_TOKEN`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`

Then reference it in your values:

```yaml
existingSecret: 'my-equations-secret'
```

## Security Considerations

This service implements comprehensive security measures for safe LaTeX compilation:

- **Input Validation**: Zod schemas block dangerous LaTeX commands
- **Command Injection Prevention**: Uses secure spawn without shell execution
- **Docker Sandbox**: Isolated LaTeX compilation with resource limits
- **Rate Limiting**: Multi-tier throttling (3/min, 20/15min, 50/hour)
- **Resource Monitoring**: Memory, CPU, and file size limits
- **Non-root Execution**: Pod runs with UID 1000
- **Read-only Filesystem**: Enforced with temporary directories as emptyDir volumes
- **Capability Dropping**: All Linux capabilities are dropped
- **Seccomp Profile**: RuntimeDefault security profile applied

### LaTeX Security

The service includes specific protections against LaTeX vulnerabilities:

- Blacklisted dangerous commands (`\input`, `\include`, `\write`, etc.)
- Execution timeout limits to prevent infinite loops
- Memory and disk usage constraints
- Sandboxed compilation environment

## Persistence

This chart uses ephemeral storage for temporary LaTeX compilation files. Rendered equations are stored in MinIO/S3, which should be deployed separately.

## Monitoring

The service exposes a health check endpoint at `/health` which is used for both liveness and readiness probes.

### Health Check Endpoints

- `/health` - Health check endpoint (used by probes)
- `/metrics` - Prometheus metrics endpoint (if enabled)

### View Logs

```bash
# View equations logs
kubectl logs -n lilnas-core -l app=equations -f

# View logs with timestamps
kubectl logs -n lilnas-core -l app=equations --timestamps
```

## Verification

Verify the deployment is running correctly:

```bash
# Check pod status
kubectl get pods -n lilnas-core -l app=equations

# Check service endpoints
kubectl get endpoints -n lilnas-core equations

# View deployment details
kubectl describe deployment equations -n lilnas-core

# Check ingress configuration
kubectl get ingress -n lilnas-core equations-ingress
```

## Troubleshooting

### Common Issues

1. **Pod not starting**:

   - Check secrets are properly configured: `kubectl get secret -n lilnas-core equations`
   - Verify MinIO credentials are correct
   - Check pod logs for specific errors
   - Ensure Docker runtime has LaTeX packages available

2. **LaTeX compilation failures**:

   - Check if LaTeX packages are properly installed in container
   - Verify Docker sandbox configuration
   - Review rate limiting settings
   - Check input validation errors in logs

3. **Cannot connect to service**:

   - Verify ingress is properly configured
   - Check SSL certificate is valid
   - Ensure DNS resolves correctly
   - Test health endpoint directly

4. **Authentication failures**:

   - Verify API token matches client configuration
   - Check environment variables in pod: `kubectl exec -n lilnas-core deploy/equations -- env | grep API`

5. **MinIO connection issues**:
   - Verify MinIO endpoint is reachable from pod
   - Check access key and secret key are correct
   - Ensure bucket exists and has proper permissions

### Debug Commands

```bash
# View logs
kubectl logs -n lilnas-core -l app=equations -f

# Check environment variables
kubectl exec -n lilnas-core deploy/equations -- env

# Test MinIO connectivity from pod
kubectl exec -n lilnas-core deploy/equations -- curl -I http://minio:9000

# Check events
kubectl get events -n lilnas-core --field-selector involvedObject.name=equations

# Port-forward for local testing
kubectl port-forward -n lilnas-core svc/equations 8080:8080

# Test health endpoint locally
curl http://localhost:8080/health

# Test equation rendering (with valid API token)
curl -X POST http://localhost:8080/render \
  -H "Authorization: Bearer your-api-token" \
  -H "Content-Type: application/json" \
  -d '{"equation": "E = mc^2"}'
```

### Client Integration

Configure your applications to use the equations service:

```javascript
// Example API usage
const response = await fetch('https://equations.lilnas.io/render', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer your-api-token',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    equation: 'E = mc^2',
    format: 'svg', // or 'png'
  }),
})

const result = await response.json()
```

### Performance Tuning

1. **Increase replicas** for better availability:

   ```yaml
   replicaCount: 2
   ```

2. **Adjust resource limits** based on LaTeX compilation needs:

   ```yaml
   resources:
     requests:
       cpu: 300m
       memory: 512Mi
     limits:
       cpu: 2000m
       memory: 2Gi
   ```

3. **Configure health check timeouts** for LaTeX processing:

   ```yaml
   livenessProbe:
     initialDelaySeconds: 60
     timeoutSeconds: 15
   readinessProbe:
     initialDelaySeconds: 30
     timeoutSeconds: 10
   ```

4. **Rate limiting configuration** (via environment variables):
   ```yaml
   extraEnv:
     - name: RATE_LIMIT_REQUESTS_PER_MINUTE
       value: '5'
     - name: RATE_LIMIT_REQUESTS_PER_HOUR
       value: '100'
   ```

### LaTeX Packages

The service includes standard LaTeX packages for mathematical typesetting:

- amsmath, amsfonts, amssymb
- mathtools, physics
- tikz, pgfplots
- And many others for comprehensive equation support

For custom package requirements, rebuild the Docker image with additional LaTeX packages installed.
