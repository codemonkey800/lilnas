# cert-manager-issuers

This Helm chart deploys Let's Encrypt ClusterIssuers for cert-manager.

## Prerequisites

- Kubernetes cluster
- cert-manager installed and running
- Traefik ingress controller (or modify the solver configuration)

## Installing the Chart

To install the chart with the release name `cert-manager-issuers`:

```bash
helm install cert-manager-issuers ./k8s/charts/cert-manager-issuers
```

## Uninstalling the Chart

To uninstall/delete the `cert-manager-issuers` deployment:

```bash
helm uninstall cert-manager-issuers
```

## Configuration

The following table lists the configurable parameters of the cert-manager-issuers chart and their default values.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `email` | Email address for Let's Encrypt account registration | `admin@lilnas.io` |
| `staging.enabled` | Enable staging issuer | `true` |
| `staging.name` | Name of the staging issuer | `letsencrypt-staging` |
| `staging.server` | ACME server URL for staging | `https://acme-staging-v02.api.letsencrypt.org/directory` |
| `staging.privateKeySecretRef.name` | Secret name for staging private key | `letsencrypt-staging` |
| `production.enabled` | Enable production issuer | `true` |
| `production.name` | Name of the production issuer | `letsencrypt-prod` |
| `production.server` | ACME server URL for production | `https://acme-v02.api.letsencrypt.org/directory` |
| `production.privateKeySecretRef.name` | Secret name for production private key | `letsencrypt-prod` |
| `solver.type` | Challenge solver type | `http01` |
| `solver.ingress.class` | Ingress class for HTTP01 challenge | `traefik` |

### Specifying Values

Specify each parameter using the `--set key=value[,key=value]` argument to `helm install`. For example:

```bash
helm install cert-manager-issuers ./k8s/charts/cert-manager-issuers \
  --set email=myemail@example.com
```

Alternatively, a YAML file that specifies the values for the parameters can be provided while installing the chart. For example:

```bash
helm install cert-manager-issuers ./k8s/charts/cert-manager-issuers -f values-custom.yaml
```

## Usage

Once installed, the ClusterIssuers can be referenced in your Ingress or Certificate resources:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: example-ingress
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
  - hosts:
    - example.com
    secretName: example-tls
  rules:
  - host: example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: example-service
            port:
              number: 80
```

## Verification

Check that the ClusterIssuers are created and ready:

```bash
# List all ClusterIssuers
kubectl get clusterissuers

# Describe specific issuer for details
kubectl describe clusterissuer letsencrypt-prod
kubectl describe clusterissuer letsencrypt-staging

# Check cert-manager pods are running
kubectl get pods -n cert-manager

# Watch certificate creation in real-time
kubectl get certificates --all-namespaces -w
```

## Troubleshooting

### Certificate Not Issuing

1. **Check ClusterIssuer status**:
   ```bash
   kubectl describe clusterissuer letsencrypt-prod
   ```
   Look for any error messages in the Status section.

2. **Verify DNS configuration**:
   - Ensure your domain's DNS records point to your cluster's public IP
   - Use `nslookup` or `dig` to verify DNS resolution

3. **Check cert-manager logs**:
   ```bash
   kubectl logs -n cert-manager deploy/cert-manager -f
   ```

4. **Verify HTTP-01 challenge**:
   - Ensure port 80 is accessible from the internet
   - Check that Traefik is properly routing traffic

### Let's Encrypt Rate Limits

If you hit rate limits:
1. Switch to staging issuer for testing:
   ```bash
   kubectl annotate ingress <ingress-name> cert-manager.io/cluster-issuer=letsencrypt-staging --overwrite
   ```

2. Check current rate limit status at: https://crt.sh/?q=yourdomain.com

3. Rate limits:
   - Production: 50 certificates per registered domain per week
   - Staging: 30,000 certificates per registered domain per week

### Common Issues

1. **ACME account not registered**:
   - Check email configuration is correct
   - Ensure cert-manager can reach Let's Encrypt servers

2. **Challenge failed**:
   - Verify ingress controller is working
   - Check firewall rules allow HTTP traffic
   - Ensure no conflicting ingress rules

3. **Wrong issuer annotation**:
   - Use `cert-manager.io/cluster-issuer` not `cert-manager.io/issuer`
   - Verify exact issuer name matches deployment

### Debug Commands

```bash
# Get detailed certificate information
kubectl describe certificate <cert-name> -n <namespace>

# Check certificate request status
kubectl get certificaterequest --all-namespaces

# View challenge progress
kubectl describe challenge --all-namespaces

# Check ACME orders
kubectl get orders --all-namespaces
```