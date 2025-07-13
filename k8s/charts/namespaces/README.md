# namespaces

Namespace management for lilnas Kubernetes cluster. This chart provides a centralized way to manage all namespaces with consistent labeling, annotations, and optional resource quotas and network policies.

## TL;DR

```console
$ helm install namespaces ./namespaces
```

## Introduction

This chart manages the creation and configuration of Kubernetes namespaces for the lilnas project. It provides:

- Centralized namespace management
- Consistent labeling and annotation patterns
- Optional resource quotas per namespace
- Optional network policies
- Environment-specific configurations

## Prerequisites

- Kubernetes 1.19+
- Helm 3.2.0+

## Installing the Chart

To install the chart with the release name `namespaces`:

```console
$ helm install namespaces ./namespaces
```

For specific environments:

```console
# Development environment
$ helm install namespaces ./namespaces -f values-dev.yaml

# Production environment
$ helm install namespaces ./namespaces -f values-prod.yaml
```

## Uninstalling the Chart

To uninstall/delete the `namespaces` deployment:

```console
$ helm delete namespaces
```

**Warning**: This will delete all namespaces managed by this chart and all resources within them. Use with caution!

## Configuration

The following table lists the configurable parameters of the namespaces chart and their default values.

### Global Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.projectName` | Project name used in labels | `lilnas` |
| `global.defaultLabels` | Default labels applied to all namespaces | `{managed-by: helm, project: lilnas}` |
| `global.defaultAnnotations` | Default annotations applied to all namespaces | `{}` |

### Namespace Parameters

Each namespace can be configured with the following structure:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `namespaces.<name>.enabled` | Enable/disable the namespace | `true` |
| `namespaces.<name>.name` | Name of the namespace | varies |
| `namespaces.<name>.labels` | Additional labels for the namespace | varies |
| `namespaces.<name>.annotations` | Annotations for the namespace | varies |

### Pre-defined Namespaces

| Namespace | Name | Description |
|-----------|------|-------------|
| `core` | `lilnas-core` | Core infrastructure services (MinIO, auth, etc.) |
| `apps` | `lilnas-apps` | Main application services |
| `media` | `lilnas-media` | Media management services |
| `monitoring` | `lilnas-monitoring` | Monitoring and observability stack |
| `dev` | `lilnas-dev` | Development and testing environment |

### Resource Quotas

| Parameter | Description | Default |
|-----------|-------------|---------|
| `resourceQuotas.enabled` | Enable resource quotas for all namespaces | `false` |
| `resourceQuotas.spec` | ResourceQuota specification | see values.yaml |

### Network Policies

| Parameter | Description | Default |
|-----------|-------------|---------|
| `networkPolicies.enabled` | Enable network policies for all namespaces | `false` |
| `networkPolicies.defaultPolicy` | Default network policy (`allow-all` or `deny-all`) | `allow-all` |

### Custom Namespaces

| Parameter | Description | Default |
|-----------|-------------|---------|
| `customNamespaces` | Array of additional custom namespaces | `[]` |

## Examples

### Adding a Custom Namespace

```yaml
customNamespaces:
  - name: lilnas-staging
    enabled: true
    labels:
      tier: staging
    annotations:
      description: "Staging environment"
      owner: "devops-team"
```

### Disabling Specific Namespaces

```yaml
namespaces:
  # Disable media namespace
  media:
    enabled: false
  
  # Disable dev namespace in production
  dev:
    enabled: false
```

### Applying Resource Quotas

```yaml
resourceQuotas:
  enabled: true
  spec:
    hard:
      requests.cpu: "50"
      requests.memory: "100Gi"
      persistentvolumeclaims: "10"
```

### Configuring Network Policies

```yaml
networkPolicies:
  enabled: true
  defaultPolicy: deny-all  # Start with zero-trust approach
```

## Migration from Static YAML

To migrate from the static `lilnas-namespaces.yaml` file:

1. **Backup existing namespaces**:
   ```bash
   kubectl get namespaces -l project=lilnas -o yaml > namespaces-backup.yaml
   ```

2. **Install the Helm chart**:
   ```bash
   helm install namespaces ./namespaces --dry-run
   # Review the output, then install
   helm install namespaces ./namespaces
   ```

3. **Verify namespaces**:
   ```bash
   kubectl get namespaces -l project=lilnas
   ```

## Environment-Specific Deployments

### Development Environment

The `values-dev.yaml` file configures:
- All namespaces enabled (including dev)
- No resource quotas for flexibility
- No network policies for easier debugging
- Development environment labels

### Production Environment

The `values-prod.yaml` file configures:
- Dev namespace disabled
- Resource quotas enabled with higher limits
- Network policies enabled (default allow-all)
- Production environment labels
- Criticality annotations for prioritization

## Troubleshooting

### Namespace Already Exists

If namespaces already exist, Helm will not be able to adopt them. You have two options:

1. **Delete and recreate** (if safe):
   ```bash
   kubectl delete namespace <namespace-name>
   helm upgrade --install namespaces ./namespaces
   ```

2. **Import existing namespaces**:
   ```bash
   kubectl label namespace <namespace-name> app.kubernetes.io/managed-by=Helm
   kubectl annotate namespace <namespace-name> meta.helm.sh/release-name=namespaces
   kubectl annotate namespace <namespace-name> meta.helm.sh/release-namespace=default
   ```

### Resource Quota Issues

Check quota usage:
```bash
kubectl describe resourcequota -n <namespace-name>
```

Increase quotas if needed in values file and upgrade:
```bash
helm upgrade namespaces ./namespaces
```

## Security Considerations

1. **Network Policies**: In production, consider implementing more restrictive network policies than the default `allow-all`.

2. **Resource Quotas**: Always enable resource quotas in production to prevent resource exhaustion.

3. **RBAC**: This chart only creates namespaces. RBAC policies should be managed separately.

4. **Namespace Isolation**: Each namespace provides a security boundary. Use them to separate different applications and environments.

## Maintenance

### Updating Labels or Annotations

To update labels or annotations on existing namespaces:

```bash
# Update values file, then:
helm upgrade namespaces ./namespaces
```

### Adding New Namespaces

1. Add to `customNamespaces` in values file
2. Run `helm upgrade namespaces ./namespaces`

### Removing Namespaces

1. Set `enabled: false` for the namespace
2. Run `helm upgrade namespaces ./namespaces`
3. Manually delete the namespace if needed:
   ```bash
   kubectl delete namespace <namespace-name>
   ```

Note: Helm will not delete namespaces to prevent accidental data loss.