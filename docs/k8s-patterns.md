# Kubernetes Patterns and Templates

This document provides reusable patterns and templates for common Kubernetes resources in the LilNAS project. Copy and adapt these templates for new services.

## Table of Contents

- [Service Template Structure](#service-template-structure)
- [Deployment Patterns](#deployment-patterns)
- [Service Patterns](#service-patterns)
- [ConfigMap and Secret Patterns](#configmap-and-secret-patterns)
- [Ingress Patterns](#ingress-patterns)
- [Job and CronJob Patterns](#job-and-cronjob-patterns)
- [StatefulSet Patterns](#statefulset-patterns)
- [Kustomization Templates](#kustomization-templates)
- [Helm Chart Templates](#helm-chart-templates)

## Service Template Structure

When creating a new service, use this directory structure:

```
k8s/
└── {category}/           # core, apps, etc.
    └── {service-name}/
        ├── base/         # Base manifests
        │   ├── deployment.yaml
        │   ├── service.yaml
        │   ├── configmap.yaml
        │   ├── ingress.yaml
        │   └── kustomization.yaml
        ├── overlays/     # Environment-specific
        │   ├── dev/
        │   │   └── kustomization.yaml
        │   └── prod/
        │       └── kustomization.yaml
        └── scripts/      # Service-specific scripts
            └── setup.sh
```

## Deployment Patterns

### Basic Web Service Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {service-name}
  namespace: {namespace}
  labels:
    app.kubernetes.io/name: {service-name}
    app.kubernetes.io/instance: {service-name}
    app.kubernetes.io/version: "1.0.0"
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: lilnas
    app.kubernetes.io/managed-by: kustomize
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: {service-name}
      app.kubernetes.io/instance: {service-name}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {service-name}
        app.kubernetes.io/instance: {service-name}
        app.kubernetes.io/version: "1.0.0"
        app.kubernetes.io/component: api
        app.kubernetes.io/part-of: lilnas
    spec:
      serviceAccountName: {service-name}
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      containers:
      - name: {service-name}
        image: ghcr.io/lilnas/{service-name}:latest
        imagePullPolicy: IfNotPresent
        ports:
        - name: http
          containerPort: 8080
          protocol: TCP
        envFrom:
        - configMapRef:
            name: {service-name}-config
        - secretRef:
            name: {service-name}-secrets
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "500m"
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
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop: ["ALL"]
        volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: cache
          mountPath: /app/cache
      volumes:
      - name: tmp
        emptyDir: {}
      - name: cache
        emptyDir: {}
```

### Background Worker Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {service-name}-worker
  namespace: {namespace}
  labels:
    app.kubernetes.io/name: {service-name}
    app.kubernetes.io/instance: {service-name}-worker
    app.kubernetes.io/version: "1.0.0"
    app.kubernetes.io/component: worker
    app.kubernetes.io/part-of: lilnas
    app.kubernetes.io/managed-by: kustomize
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: {service-name}
      app.kubernetes.io/instance: {service-name}-worker
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {service-name}
        app.kubernetes.io/instance: {service-name}-worker
        app.kubernetes.io/version: "1.0.0"
        app.kubernetes.io/component: worker
        app.kubernetes.io/part-of: lilnas
    spec:
      serviceAccountName: {service-name}
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      containers:
      - name: worker
        image: ghcr.io/lilnas/{service-name}:latest
        imagePullPolicy: IfNotPresent
        command: ["node", "worker.js"]
        envFrom:
        - configMapRef:
            name: {service-name}-config
        - secretRef:
            name: {service-name}-secrets
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "512Mi"
            cpu: "1000m"
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop: ["ALL"]
```

## Service Patterns

### ClusterIP Service (Internal)

```yaml
apiVersion: v1
kind: Service
metadata:
  name: { service-name }
  namespace: { namespace }
  labels:
    app.kubernetes.io/name: { service-name }
    app.kubernetes.io/instance: { service-name }
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: lilnas
    app.kubernetes.io/managed-by: kustomize
spec:
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: http
      protocol: TCP
  selector:
    app.kubernetes.io/name: { service-name }
    app.kubernetes.io/instance: { service-name }
```

### Headless Service (for StatefulSets)

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {service-name}-headless
  namespace: {namespace}
  labels:
    app.kubernetes.io/name: {service-name}
    app.kubernetes.io/instance: {service-name}
    app.kubernetes.io/component: database
    app.kubernetes.io/part-of: lilnas
    app.kubernetes.io/managed-by: kustomize
spec:
  type: ClusterIP
  clusterIP: None
  ports:
  - name: tcp
    port: 5432
    targetPort: tcp
    protocol: TCP
  selector:
    app.kubernetes.io/name: {service-name}
    app.kubernetes.io/instance: {service-name}
```

## ConfigMap and Secret Patterns

### Application ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {service-name}-config
  namespace: {namespace}
  labels:
    app.kubernetes.io/name: {service-name}
    app.kubernetes.io/instance: {service-name}
    app.kubernetes.io/component: config
    app.kubernetes.io/part-of: lilnas
    app.kubernetes.io/managed-by: kustomize
data:
  # Logging configuration
  LOG_LEVEL: "info"
  LOG_FORMAT: "json"

  # Server configuration
  SERVER_PORT: "8080"
  SERVER_HOST: "0.0.0.0"

  # Application settings
  ENABLE_METRICS: "true"
  METRICS_PORT: "9090"

  # Feature flags
  FEATURE_X_ENABLED: "true"
  FEATURE_Y_ENABLED: "false"

  # External service URLs
  API_BASE_URL: "https://api.lilnas.io"
  STORAGE_ENDPOINT: "http://minio.lilnas-core:9000"
```

### Secret Template

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: {service-name}-secrets
  namespace: {namespace}
  labels:
    app.kubernetes.io/name: {service-name}
    app.kubernetes.io/instance: {service-name}
    app.kubernetes.io/component: config
    app.kubernetes.io/part-of: lilnas
    app.kubernetes.io/managed-by: manual
type: Opaque
stringData:
  # Database credentials
  DATABASE_URL: "postgresql://user:password@postgres:5432/dbname"

  # API keys
  API_KEY: "your-api-key-here"
  SECRET_KEY: "your-secret-key-here"

  # OAuth credentials
  OAUTH_CLIENT_ID: "client-id"
  OAUTH_CLIENT_SECRET: "client-secret"
```

### External Secret Reference

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: {service-name}-secrets
  namespace: {namespace}
  labels:
    app.kubernetes.io/name: {service-name}
    app.kubernetes.io/instance: {service-name}
    app.kubernetes.io/component: config
    app.kubernetes.io/part-of: lilnas
    app.kubernetes.io/managed-by: external-secrets
  annotations:
    kubernetes.io/description: "Managed by external-secrets operator"
type: Opaque
data: {}  # Data populated by external-secrets operator
```

## Ingress Patterns

### Public Service Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {service-name}
  namespace: {namespace}
  labels:
    app.kubernetes.io/name: {service-name}
    app.kubernetes.io/instance: {service-name}
    app.kubernetes.io/component: ingress
    app.kubernetes.io/part-of: lilnas
    app.kubernetes.io/managed-by: kustomize
  annotations:
    # Traefik configuration
    traefik.ingress.kubernetes.io/router.tls: "true"
    traefik.ingress.kubernetes.io/router.entrypoints: websecure

    # Certificate management
    cert-manager.io/cluster-issuer: "letsencrypt-prod"

    # Optional: Rate limiting
    traefik.ingress.kubernetes.io/router.middlewares: lilnas-core-ratelimit@kubernetescrd
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

### API Ingress with Path-based Routing

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {service-name}-api
  namespace: {namespace}
  labels:
    app.kubernetes.io/name: {service-name}
    app.kubernetes.io/instance: {service-name}-api
    app.kubernetes.io/component: ingress
    app.kubernetes.io/part-of: lilnas
    app.kubernetes.io/managed-by: kustomize
  annotations:
    traefik.ingress.kubernetes.io/router.tls: "true"
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    cert-manager.io/cluster-issuer: "letsencrypt-prod"

    # API-specific middleware
    traefik.ingress.kubernetes.io/router.middlewares: |
      lilnas-core-cors@kubernetescrd,
      lilnas-core-api-ratelimit@kubernetescrd
spec:
  ingressClassName: traefik
  tls:
  - hosts:
    - api.lilnas.io
    secretName: api-lilnas-io-tls
  rules:
  - host: api.lilnas.io
    http:
      paths:
      - path: /{service}
        pathType: Prefix
        backend:
          service:
            name: {service-name}
            port:
              number: 80
```

## Job and CronJob Patterns

### Database Migration Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {service-name}-migrate-{timestamp}
  namespace: {namespace}
  labels:
    app.kubernetes.io/name: {service-name}
    app.kubernetes.io/instance: {service-name}-migrate
    app.kubernetes.io/version: "1.0.0"
    app.kubernetes.io/component: migration
    app.kubernetes.io/part-of: lilnas
    app.kubernetes.io/managed-by: kustomize
spec:
  ttlSecondsAfterFinished: 86400  # Clean up after 24 hours
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {service-name}
        app.kubernetes.io/instance: {service-name}-migrate
        app.kubernetes.io/component: migration
        app.kubernetes.io/part-of: lilnas
    spec:
      restartPolicy: Never
      serviceAccountName: {service-name}
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      containers:
      - name: migrate
        image: ghcr.io/lilnas/{service-name}:latest
        imagePullPolicy: IfNotPresent
        command: ["npm", "run", "migrate"]
        envFrom:
        - configMapRef:
            name: {service-name}-config
        - secretRef:
            name: {service-name}-secrets
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop: ["ALL"]
```

### Backup CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: {service-name}-backup
  namespace: {namespace}
  labels:
    app.kubernetes.io/name: {service-name}
    app.kubernetes.io/instance: {service-name}-backup
    app.kubernetes.io/version: "1.0.0"
    app.kubernetes.io/component: backup
    app.kubernetes.io/part-of: lilnas
    app.kubernetes.io/managed-by: kustomize
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      ttlSecondsAfterFinished: 86400
      template:
        metadata:
          labels:
            app.kubernetes.io/name: {service-name}
            app.kubernetes.io/instance: {service-name}-backup
            app.kubernetes.io/component: backup
            app.kubernetes.io/part-of: lilnas
        spec:
          restartPolicy: Never
          serviceAccountName: {service-name}
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            fsGroup: 1000
          containers:
          - name: backup
            image: ghcr.io/lilnas/backup-tools:latest
            imagePullPolicy: IfNotPresent
            command: ["/scripts/backup.sh"]
            args: ["{service-name}"]
            envFrom:
            - secretRef:
                name: backup-credentials
            resources:
              requests:
                memory: "512Mi"
                cpu: "200m"
              limits:
                memory: "1Gi"
                cpu: "1000m"
            volumeMounts:
            - name: backup-scripts
              mountPath: /scripts
            securityContext:
              allowPrivilegeEscalation: false
              readOnlyRootFilesystem: true
              capabilities:
                drop: ["ALL"]
          volumes:
          - name: backup-scripts
            configMap:
              name: backup-scripts
              defaultMode: 0755
```

## StatefulSet Patterns

### Database StatefulSet

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {service-name}-db
  namespace: {namespace}
  labels:
    app.kubernetes.io/name: {service-name}-db
    app.kubernetes.io/instance: {service-name}-db
    app.kubernetes.io/version: "14.5"
    app.kubernetes.io/component: database
    app.kubernetes.io/part-of: lilnas
    app.kubernetes.io/managed-by: kustomize
spec:
  serviceName: {service-name}-db-headless
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: {service-name}-db
      app.kubernetes.io/instance: {service-name}-db
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {service-name}-db
        app.kubernetes.io/instance: {service-name}-db
        app.kubernetes.io/version: "14.5"
        app.kubernetes.io/component: database
        app.kubernetes.io/part-of: lilnas
    spec:
      serviceAccountName: {service-name}
      securityContext:
        runAsNonRoot: true
        runAsUser: 999
        fsGroup: 999
      containers:
      - name: postgres
        image: postgres:14.5-alpine
        imagePullPolicy: IfNotPresent
        ports:
        - name: tcp
          containerPort: 5432
          protocol: TCP
        env:
        - name: POSTGRES_DB
          value: {service-name}
        - name: PGDATA
          value: /var/lib/postgresql/data/pgdata
        envFrom:
        - secretRef:
            name: {service-name}-db-secrets
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - postgres
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - postgres
          initialDelaySeconds: 5
          periodSeconds: 5
        volumeMounts:
        - name: data
          mountPath: /var/lib/postgresql/data
        securityContext:
          allowPrivilegeEscalation: false
          capabilities:
            drop: ["ALL"]
  volumeClaimTemplates:
  - metadata:
      name: data
      labels:
        app.kubernetes.io/name: {service-name}-db
        app.kubernetes.io/instance: {service-name}-db
        app.kubernetes.io/component: storage
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: fast-ssd
      resources:
        requests:
          storage: 10Gi
```

## Kustomization Templates

### Base Kustomization

```yaml
# base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: lilnas-apps

resources:
- deployment.yaml
- service.yaml
- configmap.yaml
- ingress.yaml

commonLabels:
  app.kubernetes.io/name: {service-name}
  app.kubernetes.io/part-of: lilnas
  app.kubernetes.io/managed-by: kustomize

configMapGenerator:
- name: {service-name}-config
  behavior: merge
  literals:
  - LOG_LEVEL=info

secretGenerator:
- name: {service-name}-secrets
  behavior: merge
  envs:
  - secrets.env

images:
- name: ghcr.io/lilnas/{service-name}
  newTag: latest

replicas:
- name: {service-name}
  count: 1
```

### Development Overlay

```yaml
# overlays/dev/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: lilnas-dev

bases:
- ../../base

commonLabels:
  environment: dev

configMapGenerator:
- name: {service-name}-config
  behavior: merge
  literals:
  - LOG_LEVEL=debug
  - ENABLE_DEBUG=true

patchesStrategicMerge:
- |-
  apiVersion: apps/v1
  kind: Deployment
  metadata:
    name: {service-name}
  spec:
    replicas: 1
    template:
      spec:
        containers:
        - name: {service-name}
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "200m"

patchesJson6902:
- target:
    group: networking.k8s.io
    version: v1
    kind: Ingress
    name: {service-name}
  patch: |-
    - op: replace
      path: /spec/rules/0/host
      value: {service}.dev.lilnas.io
    - op: replace
      path: /spec/tls/0/hosts/0
      value: {service}.dev.lilnas.io
    - op: replace
      path: /metadata/annotations/cert-manager.io~1cluster-issuer
      value: letsencrypt-staging
```

### Production Overlay

```yaml
# overlays/prod/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: lilnas-apps

bases:
- ../../base

commonLabels:
  environment: prod

configMapGenerator:
- name: {service-name}-config
  behavior: merge
  literals:
  - LOG_LEVEL=warn
  - ENABLE_METRICS=true

replicas:
- name: {service-name}
  count: 3

patchesStrategicMerge:
- |-
  apiVersion: apps/v1
  kind: Deployment
  metadata:
    name: {service-name}
  spec:
    template:
      spec:
        containers:
        - name: {service-name}
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "1Gi"
              cpu: "1000m"

patchesJson6902:
- target:
    group: networking.k8s.io
    version: v1
    kind: Ingress
    name: {service-name}
  patch: |-
    - op: add
      path: /metadata/annotations/traefik.ingress.kubernetes.io~1router.middlewares
      value: lilnas-core-ratelimit@kubernetescrd
```

## Helm Chart Templates

### Chart.yaml Template

```yaml
apiVersion: v2
name: { service-name }
description: A Helm chart for {service-name} service
type: application
version: 0.1.0
appVersion: '1.0.0'
keywords:
  - lilnas
  - { service-type }
home: https://github.com/lilnas/{service-name}
sources:
  - https://github.com/lilnas/{service-name}
maintainers:
  - name: Infrastructure Team
    email: infra@lilnas.io
dependencies: [] # Add any chart dependencies here
```

### Values.yaml Structure

```yaml
# Default values for {service-name}
# This is a YAML-formatted file.
# Declare variables to be passed into your templates.

replicaCount: 1

image:
  repository: ghcr.io/lilnas/{service-name}
  pullPolicy: IfNotPresent
  # Overrides the image tag whose default is the chart appVersion.
  tag: ""

imagePullSecrets: []
nameOverride: ""
fullnameOverride: ""

serviceAccount:
  # Specifies whether a service account should be created
  create: true
  # Annotations to add to the service account
  annotations: {}
  # The name of the service account to use.
  name: ""

podAnnotations: {}

podSecurityContext:
  runAsNonRoot: true
  runAsUser: 1000
  fsGroup: 1000

securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
    - ALL

service:
  type: ClusterIP
  port: 80
  targetPort: 8080

ingress:
  enabled: true
  className: "traefik"
  annotations:
    traefik.ingress.kubernetes.io/router.tls: "true"
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: {service}.lilnas.io
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: {service}-lilnas-io-tls
      hosts:
        - {service}.lilnas.io

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi

autoscaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
  targetMemoryUtilizationPercentage: 80

nodeSelector: {}

tolerations: []

affinity: {}

# Application configuration
config:
  logLevel: info
  serverPort: "8080"
  # Add more configuration here

# Secrets configuration (actual values provided separately)
secrets:
  # List secret keys that will be created
  # databaseUrl: ""
  # apiKey: ""

# Health check configuration
healthcheck:
  liveness:
    path: /health
    initialDelaySeconds: 30
    periodSeconds: 10
    timeoutSeconds: 5
    failureThreshold: 3
  readiness:
    path: /ready
    initialDelaySeconds: 5
    periodSeconds: 5
    timeoutSeconds: 3
    failureThreshold: 3

# Persistence configuration
persistence:
  enabled: false
  storageClass: ""
  accessMode: ReadWriteOnce
  size: 1Gi
  # existingClaim: ""

# Additional volumes and mounts
volumes: []
volumeMounts: []
```

### Deployment Template with Helpers

```yaml
{{- define "{service-name}.deployment" -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "{service-name}.fullname" . }}
  labels:
    {{- include "{service-name}.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "{service-name}.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      {{- with .Values.podAnnotations }}
      annotations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      labels:
        {{- include "{service-name}.selectorLabels" . | nindent 8 }}
    spec:
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      serviceAccountName: {{ include "{service-name}.serviceAccountName" . }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
      - name: {{ .Chart.Name }}
        securityContext:
          {{- toYaml .Values.securityContext | nindent 12 }}
        image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
        imagePullPolicy: {{ .Values.image.pullPolicy }}
        ports:
        - name: http
          containerPort: {{ .Values.service.targetPort }}
          protocol: TCP
        envFrom:
        - configMapRef:
            name: {{ include "{service-name}.fullname" . }}-config
        {{- if .Values.secrets }}
        - secretRef:
            name: {{ include "{service-name}.fullname" . }}-secrets
        {{- end }}
        livenessProbe:
          httpGet:
            path: {{ .Values.healthcheck.liveness.path }}
            port: http
          initialDelaySeconds: {{ .Values.healthcheck.liveness.initialDelaySeconds }}
          periodSeconds: {{ .Values.healthcheck.liveness.periodSeconds }}
          timeoutSeconds: {{ .Values.healthcheck.liveness.timeoutSeconds }}
          failureThreshold: {{ .Values.healthcheck.liveness.failureThreshold }}
        readinessProbe:
          httpGet:
            path: {{ .Values.healthcheck.readiness.path }}
            port: http
          initialDelaySeconds: {{ .Values.healthcheck.readiness.initialDelaySeconds }}
          periodSeconds: {{ .Values.healthcheck.readiness.periodSeconds }}
          timeoutSeconds: {{ .Values.healthcheck.readiness.timeoutSeconds }}
          failureThreshold: {{ .Values.healthcheck.readiness.failureThreshold }}
        resources:
          {{- toYaml .Values.resources | nindent 12 }}
        volumeMounts:
        {{- if .Values.persistence.enabled }}
        - name: data
          mountPath: /data
        {{- end }}
        {{- with .Values.volumeMounts }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      volumes:
      {{- if .Values.persistence.enabled }}
      - name: data
        persistentVolumeClaim:
          claimName: {{ .Values.persistence.existingClaim | default (include "{service-name}.fullname" .) }}
      {{- end }}
      {{- with .Values.volumes }}
      {{- toYaml . | nindent 6 }}
      {{- end }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
{{- end -}}
```

## Usage Examples

### Creating a New Service

1. **Choose the appropriate pattern** based on your service type
2. **Copy the template** to your service directory
3. **Replace placeholders** with actual values:

   - `{service-name}`: Your service name (e.g., `user-api`)
   - `{namespace}`: Target namespace (e.g., `lilnas-apps`)
   - `{timestamp}`: Current timestamp for unique names
   - `{service}`: Short service name for URLs

4. **Customize as needed**:
   - Adjust resource limits based on requirements
   - Add service-specific environment variables
   - Configure health check paths
   - Add necessary volumes

### Pattern Selection Guide

| Service Type      | Pattern to Use            | Key Considerations                     |
| ----------------- | ------------------------- | -------------------------------------- |
| REST API          | Basic Web Service         | HTTP endpoints, health checks          |
| GraphQL API       | Basic Web Service         | Single endpoint, websocket support     |
| Background Worker | Worker Deployment         | No ingress, queue processing           |
| Database          | StatefulSet               | Persistent storage, ordered deployment |
| Cache             | StatefulSet or Deployment | Consider persistence needs             |
| Batch Job         | Job Pattern               | One-time execution, cleanup            |
| Scheduled Task    | CronJob Pattern           | Regular execution, concurrency         |

### Environment-Specific Adjustments

**Development**:

- Lower resource limits
- Debug logging enabled
- Staging certificates
- Single replica

**Production**:

- Higher resource limits
- Structured logging
- Production certificates
- Multiple replicas
- Autoscaling enabled

## Best Practices Checklist

When using these patterns:

- [ ] Replace all placeholders with actual values
- [ ] Set appropriate resource requests and limits
- [ ] Configure health checks with correct paths
- [ ] Add all required environment variables
- [ ] Use secrets for sensitive data
- [ ] Apply all required labels
- [ ] Set security contexts
- [ ] Configure persistence if needed
- [ ] Document service-specific details
- [ ] Test in development environment first

## Additional Resources

- [Kubernetes API Reference](https://kubernetes.io/docs/reference/kubernetes-api/)
- [Kustomize Documentation](https://kustomize.io/)
- [Helm Documentation](https://helm.sh/docs/)
- [LilNAS K8s Best Practices](@docs/k8s-best-practices.md)
