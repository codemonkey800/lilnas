# LilNAS Common Helm Library

This is a Helm library chart that provides common templates and helpers for all LilNAS Helm charts.

## Usage

To use this library in your Helm chart:

1. Add the dependency in your `Chart.yaml`:

```yaml
dependencies:
  - name: lilnas-common
    version: '0.1.0'
    repository: 'file://../../_library'
```

2. Run `helm dependency update` in your chart directory.

3. Use the templates in your chart:

```yaml
# In your deployment.yaml
{{- include "lilnas.deployment" . }}

# In your service.yaml
{{- include "lilnas.service" . }}

# In your ingress.yaml
{{- include "lilnas.ingress" . }}
```

## Available Templates

### Core Templates

- `lilnas.deployment` - Standard deployment template
- `lilnas.service` - Standard service template
- `lilnas.service.headless` - Headless service for StatefulSets
- `lilnas.ingress` - Standard ingress with Traefik and cert-manager
- `lilnas.configmap` - ConfigMap from values
- `lilnas.secret` - Secret from values
- `lilnas.pvc` - PersistentVolumeClaim template

### Helper Functions

#### Naming Helpers

- `lilnas.name` - Chart name
- `lilnas.fullname` - Full resource name
- `lilnas.chart` - Chart name and version
- `lilnas.serviceAccountName` - Service account name
- `lilnas.secretName` - Secret name with external secret support
- `lilnas.configMapName` - ConfigMap name with external support

#### Label Helpers

- `lilnas.labels` - Standard labels including Kubernetes recommended labels
- `lilnas.selectorLabels` - Labels for selectors
- `lilnas.annotations` - Common annotations

#### Security Helpers

- `lilnas.podSecurityContext` - Pod security context
- `lilnas.containerSecurityContext` - Container security context

#### Resource Helpers

- `lilnas.resources` - Resource limits and requests
- `lilnas.envFrom` - Environment from ConfigMap and Secret
- `lilnas.volumeMounts` - Common volume mounts
- `lilnas.volumes` - Common volumes
- `lilnas.imagePullSecrets` - Image pull secrets

#### Health Check Helpers

- `lilnas.livenessProbe` - Liveness probe configuration
- `lilnas.readinessProbe` - Readiness probe configuration

#### Scheduling Helpers

- `lilnas.nodeSelector` - Node selector
- `lilnas.tolerations` - Tolerations
- `lilnas.affinity` - Affinity rules with pod anti-affinity support

#### Autoscaling Helpers

- `lilnas.hpa.spec` - HorizontalPodAutoscaler spec

## Values Structure

Your chart should support these standard values:

```yaml
# Naming
nameOverride: ''
fullnameOverride: ''

# Image configuration
image:
  repository: ghcr.io/lilnas/service
  pullPolicy: IfNotPresent
  tag: '' # Defaults to Chart.appVersion

imagePullSecrets: []

# Deployment configuration
replicaCount: 1
revisionHistoryLimit: 3

# Service account
serviceAccount:
  create: true
  annotations: {}
  name: ''

# Pod configuration
podAnnotations: {}
podLabels: {}
podSecurityContext:
  enabled: true
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000

# Container configuration
containerSecurityContext:
  enabled: true
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL

# Service configuration
service:
  type: ClusterIP
  port: 80
  targetPort: 8080
  annotations: {}
  labels: {}

# Ingress configuration
ingress:
  enabled: true
  className: 'traefik'
  annotations: {}
  hosts:
    - host: service.lilnas.io
      paths:
        - path: /
          pathType: Prefix
  tls: []
  certManager:
    clusterIssuer: letsencrypt-prod

# Resource limits
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi

# Probes
livenessProbe:
  enabled: true
  path: /health
  port: http
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  enabled: true
  path: /ready
  port: http
  initialDelaySeconds: 5
  periodSeconds: 5

# Autoscaling
autoscaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
  targetMemoryUtilizationPercentage: 80

# Persistence
persistence:
  enabled: false
  existingClaim: ''
  storageClass: ''
  accessModes:
    - ReadWriteOnce
  size: 1Gi
  annotations: {}
  labels: {}

# Configuration
config: {} # Will create ConfigMap
secrets: {} # Will create Secret
existingSecret: ''
existingConfigMap: ''

# Additional volumes
tmpVolume:
  enabled: true
  sizeLimit: ''

cacheVolume:
  enabled: false
  mountPath: /cache
  sizeLimit: ''

extraVolumes: []
extraVolumeMounts: []

# Scheduling
nodeSelector: {}
tolerations: []
affinity: {}
podAntiAffinity: '' # "soft", "hard", or empty

# Additional containers
initContainers: []
sidecars: []
```

## Examples

### Basic Web Service

```yaml
# values.yaml
image:
  repository: ghcr.io/lilnas/my-service

config:
  LOG_LEVEL: info
  SERVER_PORT: '8080'

ingress:
  enabled: true
  hosts:
    - host: my-service.lilnas.io
      paths:
        - path: /
          pathType: Prefix
```

### Service with Persistence

```yaml
# values.yaml
persistence:
  enabled: true
  size: 10Gi
  storageClass: fast-ssd

config:
  DATA_DIR: /data
```

### Service with Custom Security

```yaml
# values.yaml
podSecurityContext:
  runAsUser: 2000
  fsGroup: 2000

containerSecurityContext:
  readOnlyRootFilesystem: false # If app needs to write to filesystem
```

## Customization

You can override any part of the templates by:

1. Not including the template and writing your own
2. Using template composition to extend functionality
3. Passing custom values to template functions

Example of extending deployment:

```yaml
# In your deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "lilnas.fullname" . }}
  labels:
    {{- include "lilnas.labels" . | nindent 4 }}
    my-custom-label: my-value
spec:
  # ... rest of standard deployment
  template:
    spec:
      # Add custom volume
      volumes:
        {{- include "lilnas.volumes" . | nindent 8 }}
        - name: custom-config
          configMap:
            name: my-custom-config
```

## Best Practices

1. Always use the standard labels and annotations
2. Set appropriate resource limits
3. Configure health checks
4. Use security contexts
5. Follow the naming conventions
6. Document any deviations from standards
