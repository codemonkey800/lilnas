# Traefik Forward Auth for lilnas.io

This directory contains the Kubernetes manifests for setting up Traefik Forward Auth with Google OAuth for the lilnas.io domain.

## Overview

The forward auth service provides authentication for all services under the lilnas.io domain using Google OAuth. Only whitelisted email addresses can access protected services.

## Components

- **Secret**: Contains Google OAuth credentials and session secret
- **ConfigMap**: Non-sensitive configuration (whitelist, cookie domain, etc.)
- **Deployment**: Runs the traefik-forward-auth container
- **Service**: Exposes the auth service within the cluster
- **Middleware**: Traefik middleware for authentication
- **Ingress**: Exposes auth.lilnas.io endpoint

## Prerequisites

1. k3s cluster with Traefik ingress controller
2. cert-manager configured with Let's Encrypt
3. Google OAuth application configured with redirect URI: `https://auth.lilnas.io/_oauth`

## Deployment

### 1. Create the secret using kubectl CLI:

```bash
kubectl create secret generic forward-auth-secrets \
  --namespace=lilnas-core \
  --from-literal=google-client-id='YOUR_GOOGLE_CLIENT_ID' \
  --from-literal=google-client-secret='YOUR_GOOGLE_CLIENT_SECRET' \
  --from-literal=secret='YOUR_RANDOM_SESSION_SECRET'
```

**Note:** Replace the placeholder values with your actual credentials:

- `YOUR_GOOGLE_CLIENT_ID`: Your Google OAuth client ID
- `YOUR_GOOGLE_CLIENT_SECRET`: Your Google OAuth client secret
- `YOUR_RANDOM_SESSION_SECRET`: A random string for session encryption (generate with `openssl rand -base64 32`)

Alternatively, you can use the `setup-secret.sh` script to create the secret interactively.

### 2. Apply all remaining resources using Kustomize:

```bash
# After creating the secret, apply all other resources
kubectl apply -k k8s/core/forward-auth/
```

### Or apply individually:

```bash
# Create the secret first (using kubectl command above)
# Then apply the remaining resources:
kubectl apply -f k8s/core/forward-auth/configmap.yaml
kubectl apply -f k8s/core/forward-auth/deployment.yaml
kubectl apply -f k8s/core/forward-auth/service.yaml
kubectl apply -f k8s/core/forward-auth/middleware.yaml
kubectl apply -f k8s/core/forward-auth/ingress.yaml
```

## Configuration

### Whitelisted Users

Edit the `WHITELIST` field in `configmap.yaml` to add/remove authorized email addresses.

### Google OAuth

The OAuth credentials are stored in the `forward-auth-secrets` secret. To update:

```bash
kubectl edit secret forward-auth-secrets -n lilnas-core
```

## Usage

### Protecting a Service

Add this annotation to any Ingress that needs authentication:

```yaml
metadata:
  annotations:
    traefik.ingress.kubernetes.io/router.middlewares: lilnas-core-forward-auth@kubernetescrd
```

### Testing

```bash
# Check pod status
kubectl get pods -n lilnas-core -l app=traefik-forward-auth

# View logs
kubectl logs -n lilnas-core -l app=traefik-forward-auth

# Test authentication
curl -I https://auth.lilnas.io
```

## Troubleshooting

### Pod not starting

- Check logs: `kubectl logs -n lilnas-core -l app=traefik-forward-auth`
- Verify secret exists: `kubectl get secret forward-auth-secrets -n lilnas-core`

### Authentication not working

- Verify middleware exists: `kubectl get middleware -n lilnas-core`
- Check if email is in whitelist
- Ensure Google OAuth redirect URI is correct

### SSL Certificate issues

- Check cert-manager: `kubectl get certificate -n lilnas-core`
- Verify ingress: `kubectl describe ingress traefik-forward-auth -n lilnas-core`

## Security Notes

- **DO NOT** commit secrets to version control
- Rotate the session secret periodically
- Keep the whitelist up to date
- Monitor authentication logs for unauthorized access attempts
