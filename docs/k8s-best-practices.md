# Kubernetes Best Practices for LilNAS

This document outlines the standardized best practices for all Kubernetes resources in the LilNAS project.

## Table of Contents

- [Directory Structure](#directory-structure)
- [Resource Naming Conventions](#resource-naming-conventions)
- [Label Standards](#label-standards)
- [Annotation Standards](#annotation-standards)
- [Configuration Management](#configuration-management)
- [Security Practices](#security-practices)
- [Helm Chart Guidelines](#helm-chart-guidelines)
- [Script Standards](#script-standards)
- [Resource Specifications](#resource-specifications)
- [Ingress Configuration](#ingress-configuration)

## Directory Structure

The k8s directory follows this standardized structure:

```
k8s/
├── namespaces/        # Namespace definitions
├── cert-manager/      # Certificate management resources
├── charts/            # Helm charts for all services
│   ├── minio/        # Object storage service
│   ├── turbo-cache/  # Turbo cache service
│   └── _library/     # Shared Helm templates and helpers
├── core/             # Core infrastructure services
├── apps/             # Application services
├── scripts/          # Management scripts
│   ├── lib/         # Common library functions
│   └── services/    # Service-specific scripts
├── templates/        # Kustomize base templates
└── environments/     # Environment-specific overlays
    ├── dev/         # Development overrides
    └── prod/        # Production overrides
```

## Resource Naming Conventions

### General Rules

- Use lowercase letters, numbers, and hyphens only
- Keep names concise and descriptive
- Use kebab-case for multi-word names
- Avoid redundant prefixes (e.g., use `forward-auth` not `traefik-forward-auth`)

### Specific Patterns

| Resource Type  | Naming Pattern             | Example               |
| -------------- | -------------------------- | --------------------- |
| Namespace      | `lilnas-{category}`        | `lilnas-core`         |
| Deployment     | `{service-name}`           | `turbo-cache`         |
| Service        | `{service-name}`           | `turbo-cache`         |
| ConfigMap      | `{service-name}-config`    | `turbo-cache-config`  |
| Secret         | `{service-name}-secrets`   | `turbo-cache-secrets` |
| Ingress        | `{service-name}`           | `turbo-cache`         |
| TLS Secret     | `{hostname}-tls`           | `turbo-lilnas-io-tls` |
| ServiceAccount | `{service-name}`           | `turbo-cache`         |
| PVC            | `{service-name}-{purpose}` | `minio-data`          |

## Label Standards

All Kubernetes resources MUST include these standard labels:

```yaml
metadata:
  labels:
    # Required labels
    app.kubernetes.io/name: '{service-name}' # e.g., "turbo-cache"
    app.kubernetes.io/instance: '{instance-name}' # e.g., "turbo-cache-prod"
    app.kubernetes.io/version: '{version}' # e.g., "1.0.0"
    app.kubernetes.io/component: '{component}' # e.g., "cache", "api", "worker"
    app.kubernetes.io/part-of: 'lilnas' # Always "lilnas"
    app.kubernetes.io/managed-by: '{tool}' # "helm", "kustomize", or "manual"

    # Optional but recommended
    app.kubernetes.io/created-by: '{team/user}' # e.g., "infrastructure-team"
    environment: '{env}' # "dev", "staging", or "prod"
```

### Label Usage Examples

```yaml
# Deployment example
apiVersion: apps/v1
kind: Deployment
metadata:
  name: turbo-cache
  namespace: lilnas-core
  labels:
    app.kubernetes.io/name: turbo-cache
    app.kubernetes.io/instance: turbo-cache-prod
    app.kubernetes.io/version: '1.2.0'
    app.kubernetes.io/component: cache
    app.kubernetes.io/part-of: lilnas
    app.kubernetes.io/managed-by: helm
    environment: prod
```

## Annotation Standards

Use annotations for metadata that shouldn't be used for selection:

```yaml
metadata:
  annotations:
    # Descriptive annotations
    kubernetes.io/description: 'Brief description of the resource'
    kubernetes.io/documentation: 'https://docs.lilnas.io/services/{service}'

    # Operational annotations
    kubernetes.io/change-cause: 'Updated to version 1.2.0'
    deployed-by: '{username}'
    deployed-at: '{RFC3339 timestamp}'

    # Tool-specific annotations (examples)
    cert-manager.io/cluster-issuer: 'letsencrypt-prod'
    traefik.ingress.kubernetes.io/router.tls: 'true'
```

## Configuration Management

### ConfigMaps

- Store non-sensitive configuration in ConfigMaps
- Use descriptive keys in UPPER_SNAKE_CASE
- Group related configuration together

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {service-name}-config
  namespace: {namespace}
data:
  # Application settings
  LOG_LEVEL: "info"
  SERVER_PORT: "8080"

  # Feature flags
  ENABLE_CACHE: "true"
  CACHE_TTL: "3600"
```

### Secrets

- Store sensitive data in Secrets
- Support external secret providers
- Use consistent key naming

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: {service-name}-secrets
  namespace: {namespace}
type: Opaque
data:
  # Base64 encoded values
  DATABASE_PASSWORD: {base64-encoded-password}
  API_KEY: {base64-encoded-key}
```

### Environment Variables

- Prefer `envFrom` over individual `env` entries
- Use ConfigMaps for configuration
- Use Secrets for sensitive data

```yaml
containers:
- name: app
  envFrom:
  - configMapRef:
      name: {service-name}-config
  - secretRef:
      name: {service-name}-secrets
```

## Security Practices

### Pod Security

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    fsGroup: 1000
  containers:
    - name: app
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ['ALL']
```

### Network Policies

- Define network policies for service isolation
- Use least-privilege access principles
- Document allowed traffic flows

### Secret Management

- Never commit secrets to git
- Use external secret management when possible
- Rotate secrets regularly
- Provide setup scripts for secret creation

## Helm Chart Guidelines

### Chart Structure

```
charts/{service-name}/
├── Chart.yaml           # Chart metadata
├── values.yaml          # Default values
├── values-dev.yaml      # Development overrides
├── values-prod.yaml     # Production overrides
├── templates/
│   ├── _helpers.tpl     # Template helpers
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── ingress.yaml
│   └── NOTES.txt       # Post-install notes
└── README.md           # Chart documentation
```

### Values Organization

```yaml
# values.yaml structure
replicaCount: 1

image:
  repository: ghcr.io/lilnas/{service}
  pullPolicy: IfNotPresent
  tag: '' # Defaults to Chart.appVersion

service:
  type: ClusterIP
  port: 80
  targetPort: 8080

ingress:
  enabled: true
  className: traefik
  annotations: {}
  hosts: []
  tls: []

resources:
  requests:
    memory: '128Mi'
    cpu: '100m'
  limits:
    memory: '256Mi'
    cpu: '500m'

autoscaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 10

# Configuration values
config:
  logLevel: info
  # Add service-specific config

# Secret configuration
secrets:
  # Define secret keys (values provided separately)
```

### Template Helpers

Use consistent helper functions across charts:

```yaml
{{/*
Expand the name of the chart.
*/}}
{{- define "{service}.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "{service}.labels" -}}
helm.sh/chart: {{ include "{service}.chart" . }}
{{ include "{service}.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: lilnas
{{- end }}
```

## Script Standards

### Common Library Usage

All scripts must source the common library:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../lib/common.sh"

# Script implementation
```

### Script Structure

```bash
#!/usr/bin/env bash
#
# Description: Brief description of what the script does
# Usage: script.sh [options] <arguments>
#
# Options:
#   -h, --help        Show this help message
#   -d, --dry-run     Show what would be done without executing
#   -v, --verbose     Enable verbose output
#

set -euo pipefail
```

### Error Handling

- Always use `set -euo pipefail`
- Implement cleanup functions with trap
- Provide meaningful error messages
- Use appropriate exit codes

## Resource Specifications

### Container Resources

All containers MUST specify resource requests and limits:

```yaml
resources:
  requests:
    memory: '128Mi' # Minimum guaranteed memory
    cpu: '100m' # Minimum guaranteed CPU (0.1 core)
  limits:
    memory: '256Mi' # Maximum allowed memory
    cpu: '500m' # Maximum allowed CPU (0.5 core)
```

### Resource Profiles

Define standard profiles for common use cases:

| Profile | CPU Request | CPU Limit | Memory Request | Memory Limit |
| ------- | ----------- | --------- | -------------- | ------------ |
| tiny    | 50m         | 100m      | 64Mi           | 128Mi        |
| small   | 100m        | 500m      | 128Mi          | 256Mi        |
| medium  | 250m        | 1000m     | 512Mi          | 1Gi          |
| large   | 500m        | 2000m     | 1Gi            | 2Gi          |

### Health Checks

Configure appropriate probes:

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: http
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /ready
    port: http
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3
```

## Ingress Configuration

### Standard Ingress Template

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {service-name}
  namespace: {namespace}
  labels:
    {{- include "{service}.labels" . | nindent 4 }}
  annotations:
    # Traefik annotations
    traefik.ingress.kubernetes.io/router.tls: "true"
    traefik.ingress.kubernetes.io/router.entrypoints: websecure

    # Certificate management
    cert-manager.io/cluster-issuer: "letsencrypt-prod"  # or letsencrypt-staging

    # Note: Forward auth middleware not applied by default
    # Add when explicitly needed:
    # traefik.ingress.kubernetes.io/router.middlewares: lilnas-core-forward-auth@kubernetescrd
spec:
  ingressClassName: traefik
  tls:
  - hosts:
    - {service}.lilnas.io
    secretName: {service}-lilnas-io-tls
  rules:
  - host: {service}.lilnas.io
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: {service-name}
            port:
              number: 80
```

### Environment-Specific Domains

- Development: `{service}.dev.lilnas.io`
- Staging: `{service}.staging.lilnas.io`
- Production: `{service}.lilnas.io`

## Migration Guide

When updating existing resources to follow these standards:

1. **Update Labels**: Add all required `app.kubernetes.io/*` labels
2. **Rename Resources**: Follow the naming conventions
3. **Add Annotations**: Include descriptive annotations
4. **Specify Resources**: Add resource requests/limits
5. **Configure Probes**: Add liveness and readiness probes
6. **Update Scripts**: Migrate to use common library
7. **Document Changes**: Update change-cause annotations

## Validation

Use these tools to validate compliance:

- `kubectl label` - Verify labels are present
- `kubectl top` - Monitor resource usage
- Custom validation scripts in `k8s/scripts/validate-standards.sh`

## References

- [Kubernetes Best Practices](https://kubernetes.io/docs/concepts/configuration/overview/)
- [Recommended Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/)
- [Helm Best Practices](https://helm.sh/docs/chart_best_practices/)
- [Resource Management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
