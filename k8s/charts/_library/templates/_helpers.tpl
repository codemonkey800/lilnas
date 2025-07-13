{{/*
Common helper templates for LilNAS Helm charts.
This file contains reusable templates that can be imported by other charts.
*/}}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
Usage:
  {{ include "lilnas.fullname" . }}
*/}}
{{- define "lilnas.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
Usage:
  {{ include "lilnas.chart" . }}
*/}}
{{- define "lilnas.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels that should be applied to all resources.
Usage:
  labels:
    {{- include "lilnas.labels" . | nindent 4 }}
*/}}
{{- define "lilnas.labels" -}}
helm.sh/chart: {{ include "lilnas.chart" . }}
{{ include "lilnas.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: lilnas
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
Usage:
  selector:
    matchLabels:
      {{- include "lilnas.selectorLabels" . | nindent 6 }}
*/}}
{{- define "lilnas.selectorLabels" -}}
app.kubernetes.io/name: {{ include "lilnas.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- with .Values.selectorLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Create the name of the service account to use
Usage:
  serviceAccountName: {{ include "lilnas.serviceAccountName" . }}
*/}}
{{- define "lilnas.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "lilnas.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Get the name for a resource.
Usage:
  {{ include "lilnas.name" . }}
*/}}
{{- define "lilnas.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Generate secret name.
Usage:
  {{ include "lilnas.secretName" . }}
*/}}
{{- define "lilnas.secretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else -}}
{{- include "lilnas.fullname" . }}-secrets
{{- end -}}
{{- end }}

{{/*
Generate ConfigMap name.
Usage:
  {{ include "lilnas.configMapName" . }}
*/}}
{{- define "lilnas.configMapName" -}}
{{- if .Values.existingConfigMap -}}
{{- .Values.existingConfigMap -}}
{{- else -}}
{{- include "lilnas.fullname" . }}-config
{{- end -}}
{{- end }}

{{/*
Return the appropriate apiVersion for ingress.
Usage:
  {{ include "lilnas.ingress.apiVersion" . }}
*/}}
{{- define "lilnas.ingress.apiVersion" -}}
{{- if semverCompare ">=1.19-0" .Capabilities.KubeVersion.GitVersion -}}
{{- print "networking.k8s.io/v1" -}}
{{- else -}}
{{- print "networking.k8s.io/v1beta1" -}}
{{- end -}}
{{- end -}}

{{/*
Generate the ingress class name.
Usage:
  ingressClassName: {{ include "lilnas.ingress.className" . }}
*/}}
{{- define "lilnas.ingress.className" -}}
{{- default "traefik" .Values.ingress.className -}}
{{- end -}}

{{/*
Generate standard annotations.
Usage:
  annotations:
    {{- include "lilnas.annotations" . | nindent 4 }}
*/}}
{{- define "lilnas.annotations" -}}
{{- with .Values.commonAnnotations }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Pod security context
Usage:
  securityContext:
    {{- include "lilnas.podSecurityContext" . | nindent 4 }}
*/}}
{{- define "lilnas.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: {{ .Values.podSecurityContext.runAsUser | default 1000 }}
runAsGroup: {{ .Values.podSecurityContext.runAsGroup | default 1000 }}
fsGroup: {{ .Values.podSecurityContext.fsGroup | default 1000 }}
{{- with .Values.podSecurityContext.supplementalGroups }}
supplementalGroups:
{{ toYaml . }}
{{- end }}
{{- with .Values.podSecurityContext.seccompProfile }}
seccompProfile:
{{ toYaml . | indent 2 }}
{{- end }}
{{- end }}

{{/*
Container security context
Usage:
  securityContext:
    {{- include "lilnas.containerSecurityContext" . | nindent 4 }}
*/}}
{{- define "lilnas.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: {{ .Values.containerSecurityContext.readOnlyRootFilesystem | default true }}
capabilities:
  drop:
  - ALL
{{- with .Values.containerSecurityContext.capabilities.add }}
  add:
  {{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Create image pull secrets
Usage:
  {{- include "lilnas.imagePullSecrets" . | nindent 6 }}
*/}}
{{- define "lilnas.imagePullSecrets" -}}
{{- if .Values.imagePullSecrets }}
imagePullSecrets:
{{- range .Values.imagePullSecrets }}
- name: {{ . }}
{{- end }}
{{- else if .Values.image.pullSecrets }}
imagePullSecrets:
{{- range .Values.image.pullSecrets }}
- name: {{ . }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Health check probes
Usage for liveness:
  {{- include "lilnas.livenessProbe" . | nindent 10 }}
Usage for readiness:
  {{- include "lilnas.readinessProbe" . | nindent 10 }}
*/}}
{{- define "lilnas.livenessProbe" -}}
{{- if .Values.livenessProbe.enabled }}
livenessProbe:
  httpGet:
    path: {{ .Values.livenessProbe.path | default "/health" }}
    port: {{ .Values.livenessProbe.port | default "http" }}
  initialDelaySeconds: {{ .Values.livenessProbe.initialDelaySeconds | default 30 }}
  periodSeconds: {{ .Values.livenessProbe.periodSeconds | default 10 }}
  timeoutSeconds: {{ .Values.livenessProbe.timeoutSeconds | default 5 }}
  successThreshold: {{ .Values.livenessProbe.successThreshold | default 1 }}
  failureThreshold: {{ .Values.livenessProbe.failureThreshold | default 3 }}
{{- end }}
{{- end }}

{{- define "lilnas.readinessProbe" -}}
{{- if .Values.readinessProbe.enabled }}
readinessProbe:
  httpGet:
    path: {{ .Values.readinessProbe.path | default "/ready" }}
    port: {{ .Values.readinessProbe.port | default "http" }}
  initialDelaySeconds: {{ .Values.readinessProbe.initialDelaySeconds | default 5 }}
  periodSeconds: {{ .Values.readinessProbe.periodSeconds | default 5 }}
  timeoutSeconds: {{ .Values.readinessProbe.timeoutSeconds | default 3 }}
  successThreshold: {{ .Values.readinessProbe.successThreshold | default 1 }}
  failureThreshold: {{ .Values.readinessProbe.failureThreshold | default 3 }}
{{- end }}
{{- end }}

{{/*
Environment variables from ConfigMap and Secret
Usage:
  envFrom:
    {{- include "lilnas.envFrom" . | nindent 4 }}
*/}}
{{- define "lilnas.envFrom" -}}
{{- if .Values.config }}
- configMapRef:
    name: {{ include "lilnas.configMapName" . }}
{{- end }}
{{- if .Values.secrets }}
- secretRef:
    name: {{ include "lilnas.secretName" . }}
{{- end }}
{{- with .Values.extraEnvFrom }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Volume mounts for common volumes
Usage:
  volumeMounts:
    {{- include "lilnas.volumeMounts" . | nindent 4 }}
*/}}
{{- define "lilnas.volumeMounts" -}}
{{- if .Values.persistence.enabled }}
- name: data
  mountPath: {{ .Values.persistence.mountPath | default "/data" }}
  {{- if .Values.persistence.subPath }}
  subPath: {{ .Values.persistence.subPath }}
  {{- end }}
{{- end }}
{{- if .Values.tmpVolume.enabled }}
- name: tmp
  mountPath: /tmp
{{- end }}
{{- if .Values.cacheVolume.enabled }}
- name: cache
  mountPath: {{ .Values.cacheVolume.mountPath | default "/cache" }}
{{- end }}
{{- with .Values.extraVolumeMounts }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Volumes for common use cases
Usage:
  volumes:
    {{- include "lilnas.volumes" . | nindent 4 }}
*/}}
{{- define "lilnas.volumes" -}}
{{- if .Values.persistence.enabled }}
- name: data
  persistentVolumeClaim:
    claimName: {{ .Values.persistence.existingClaim | default (include "lilnas.fullname" .) }}
{{- end }}
{{- if .Values.tmpVolume.enabled }}
- name: tmp
  emptyDir:
    {{- with .Values.tmpVolume.sizeLimit }}
    sizeLimit: {{ . }}
    {{- end }}
{{- end }}
{{- if .Values.cacheVolume.enabled }}
- name: cache
  emptyDir:
    {{- with .Values.cacheVolume.sizeLimit }}
    sizeLimit: {{ . }}
    {{- end }}
{{- end }}
{{- with .Values.extraVolumes }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Generate resource limits and requests
Usage:
  resources:
    {{- include "lilnas.resources" . | nindent 4 }}
*/}}
{{- define "lilnas.resources" -}}
{{- if .Values.resources }}
{{ toYaml .Values.resources }}
{{- else }}
requests:
  memory: "128Mi"
  cpu: "100m"
limits:
  memory: "256Mi"
  cpu: "500m"
{{- end }}
{{- end }}

{{/*
Generate horizontal pod autoscaler spec
Usage:
  {{- include "lilnas.hpa.spec" . | nindent 2 }}
*/}}
{{- define "lilnas.hpa.spec" -}}
scaleTargetRef:
  apiVersion: apps/v1
  kind: Deployment
  name: {{ include "lilnas.fullname" . }}
minReplicas: {{ .Values.autoscaling.minReplicas | default 1 }}
maxReplicas: {{ .Values.autoscaling.maxReplicas | default 10 }}
metrics:
{{- if .Values.autoscaling.targetCPUUtilizationPercentage }}
- type: Resource
  resource:
    name: cpu
    target:
      type: Utilization
      averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
{{- end }}
{{- if .Values.autoscaling.targetMemoryUtilizationPercentage }}
- type: Resource
  resource:
    name: memory
    target:
      type: Utilization
      averageUtilization: {{ .Values.autoscaling.targetMemoryUtilizationPercentage }}
{{- end }}
{{- with .Values.autoscaling.customMetrics }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Generate node selector
Usage:
  nodeSelector:
    {{- include "lilnas.nodeSelector" . | nindent 4 }}
*/}}
{{- define "lilnas.nodeSelector" -}}
{{- with .Values.nodeSelector }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Generate tolerations
Usage:
  tolerations:
    {{- include "lilnas.tolerations" . | nindent 4 }}
*/}}
{{- define "lilnas.tolerations" -}}
{{- with .Values.tolerations }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Generate affinity rules
Usage:
  affinity:
    {{- include "lilnas.affinity" . | nindent 4 }}
*/}}
{{- define "lilnas.affinity" -}}
{{- if .Values.affinity }}
{{ toYaml .Values.affinity }}
{{- else if .Values.podAntiAffinity }}
podAntiAffinity:
  {{- if eq .Values.podAntiAffinity "hard" }}
  requiredDuringSchedulingIgnoredDuringExecution:
  - topologyKey: kubernetes.io/hostname
    labelSelector:
      matchLabels:
        {{- include "lilnas.selectorLabels" . | nindent 8 }}
  {{- else if eq .Values.podAntiAffinity "soft" }}
  preferredDuringSchedulingIgnoredDuringExecution:
  - weight: 100
    podAffinityTerm:
      topologyKey: kubernetes.io/hostname
      labelSelector:
        matchLabels:
          {{- include "lilnas.selectorLabels" . | nindent 10 }}
  {{- end }}
{{- end }}
{{- end }}