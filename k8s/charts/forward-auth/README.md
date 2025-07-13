# forward-auth

OAuth2 forward authentication service for Traefik in lilnas.

## TL;DR

```console
$ helm install forward-auth ./forward-auth -n lilnas-core
```

## Introduction

This chart bootstraps a [traefik-forward-auth](https://github.com/thomseddon/traefik-forward-auth) deployment on a Kubernetes cluster using the Helm package manager.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.2.0+
- An existing Kubernetes secret with OAuth credentials

## Installing the Chart

Before installing, create a secret with your OAuth credentials:

```bash
kubectl create secret generic forward-auth-secrets \
  --from-literal=google-client-id=YOUR_CLIENT_ID \
  --from-literal=google-client-secret=YOUR_CLIENT_SECRET \
  --from-literal=secret=YOUR_RANDOM_SECRET \
  -n lilnas-core
```

To install the chart with the release name `forward-auth`:

```console
$ helm install forward-auth ./forward-auth -n lilnas-core
```

## Uninstalling the Chart

To uninstall/delete the `forward-auth` deployment:

```console
$ helm delete forward-auth -n lilnas-core
```

## Configuration

The following table lists the configurable parameters of the forward-auth chart and their default values.

| Parameter | Description | Default |
| --------- | ----------- | ------- |
| `replicaCount` | Number of replicas | `1` |
| `namespace` | Namespace to deploy into | `lilnas-core` |
| `image.repository` | Image repository | `thomseddon/traefik-forward-auth` |
| `image.tag` | Image tag | `2.1.0` |
| `image.pullPolicy` | Image pull policy | `IfNotPresent` |
| `service.type` | Kubernetes service type | `ClusterIP` |
| `service.port` | Service port | `4181` |
| `oauth.provider` | OAuth provider | `google` |
| `oauth.secret.name` | Name of secret with OAuth credentials | `forward-auth-secrets` |
| `config.authHost` | Auth host | `auth.lilnas.io` |
| `config.cookieDomain` | Cookie domain | `lilnas.io` |
| `config.whitelist` | Whitelisted emails | `jeremyasuncion808@gmail.com,monicamagana366@gmail.com` |
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.host` | Ingress hostname | `auth.lilnas.io` |
| `middleware.enabled` | Create Traefik middleware | `true` |
| `resources` | CPU/Memory resource requests/limits | See values.yaml |

### Using different environments

For development:
```console
$ helm install forward-auth ./forward-auth -f values-dev.yaml -n lilnas-dev
```

For production:
```console
$ helm install forward-auth ./forward-auth -f values-prod.yaml -n lilnas-core
```

## Middleware Usage

The chart creates a Traefik middleware that can be used to protect other services. To use it, add the following annotation to your ingress:

```yaml
traefik.ingress.kubernetes.io/router.middlewares: <namespace>-forward-auth@kubernetescrd
```

Replace `<namespace>` with the namespace where forward-auth is deployed.

## Verification and Health Checks

Verify the deployment is running correctly:

```bash
# Check pod status
kubectl get pods -n lilnas-core -l app.kubernetes.io/name=forward-auth

# Check service endpoints
kubectl get endpoints -n lilnas-core forward-auth

# View deployment details
kubectl describe deployment forward-auth -n lilnas-core

# Check ingress configuration
kubectl get ingress -n lilnas-core forward-auth
```

## Monitoring

### View Logs

```bash
# View forward-auth logs
kubectl logs -n lilnas-core -l app.kubernetes.io/name=forward-auth -f

# View logs for a specific pod
kubectl logs -n lilnas-core <pod-name> -f

# View previous logs if pod restarted
kubectl logs -n lilnas-core <pod-name> --previous
```

### Health Endpoints

The service exposes health check endpoints:
- `/health` - Basic health check
- `/ready` - Readiness check

Test health endpoints:
```bash
# Port-forward to test locally
kubectl port-forward -n lilnas-core svc/forward-auth 4181:4181

# Test health endpoint
curl http://localhost:4181/health
```

## Troubleshooting

### Common Issues

1. **Authentication Loop**:
   - Check cookie domain matches your deployment domain
   - Verify auth secret is correctly set
   - Check browser console for cookie errors

2. **403 Forbidden Errors**:
   - Verify whitelist configuration includes your email/domain
   - Check logs for specific denial reasons
   - Ensure Google OAuth app is properly configured

3. **Middleware Not Working**:
   - Verify middleware annotation is correct: `<namespace>-forward-auth@kubernetescrd`
   - Check that the middleware resource exists: `kubectl get middleware -n <namespace>`
   - Ensure Traefik can reach the forward-auth service

4. **OAuth Errors**:
   - Verify Google Client ID and Secret are correct
   - Check redirect URI matches: `https://auth.yourdomain.com/_oauth`
   - Ensure OAuth consent screen is configured

### Debug Commands

```bash
# Check if secret exists
kubectl get secret -n lilnas-core forward-auth-secrets

# Describe the middleware
kubectl describe middleware forward-auth -n lilnas-core

# Check service discovery
kubectl get svc -n lilnas-core forward-auth

# Test service connectivity from another pod
kubectl run -n lilnas-core test-curl --image=curlimages/curl:latest --rm -it -- \
  curl -v http://forward-auth:4181/health

# Check events for errors
kubectl get events -n lilnas-core --field-selector involvedObject.name=forward-auth
```

### Configuration Validation

Validate your configuration:

```bash
# Check ConfigMap values
kubectl get configmap -n lilnas-core forward-auth -o yaml

# Verify environment variables in pod
kubectl exec -n lilnas-core deploy/forward-auth -- env | grep -E "(DOMAIN|WHITELIST|LOG_LEVEL)"

# Test OAuth configuration
kubectl exec -n lilnas-core deploy/forward-auth -- env | grep -E "(CLIENT_ID|PROVIDERS)"
```

## Security Considerations

1. **Secret Management**: Always use Kubernetes secrets for sensitive data
2. **HTTPS Only**: Ensure auth service is only accessible via HTTPS
3. **Whitelist**: Carefully manage the email/domain whitelist
4. **Cookie Security**: Use secure cookies with appropriate domain scope
5. **Network Policies**: Consider implementing network policies to restrict traffic