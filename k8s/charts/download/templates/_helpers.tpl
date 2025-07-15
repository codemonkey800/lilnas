{{/*
Expand the name of the chart.
*/}}
{{- define "download.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "download.fullname" -}}
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
*/}}
{{- define "download.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "download.labels" -}}
helm.sh/chart: {{ include "download.chart" . }}
{{ include "download.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: lilnas
app.kubernetes.io/component: download
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "download.selectorLabels" -}}
app.kubernetes.io/name: {{ include "download.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "download.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "download.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Create the name of the secret to use
*/}}
{{- define "download.secretName" -}}
{{- if .Values.existingSecret }}
{{- .Values.existingSecret }}
{{- else }}
{{- include "download.fullname" . }}-secrets
{{- end }}
{{- end }}

{{/*
Get the image tag
*/}}
{{- define "download.imageTag" -}}
{{- .Values.image.tag | default .Chart.AppVersion }}
{{- end }}

{{/*
Create the name of the persistent volume claim
*/}}
{{- define "download.pvcName" -}}
{{- include "download.fullname" . }}-videos
{{- end }}

{{/*
Return the appropriate apiVersion for autoscaling
*/}}
{{- define "download.autoscaling.apiVersion" -}}
{{- if .Capabilities.APIVersions.Has "autoscaling/v2" -}}
{{- print "autoscaling/v2" -}}
{{- else -}}
{{- print "autoscaling/v2beta2" -}}
{{- end -}}
{{- end -}}

{{/*
Return the appropriate apiVersion for PodDisruptionBudget
*/}}
{{- define "download.pdb.apiVersion" -}}
{{- if .Capabilities.APIVersions.Has "policy/v1" -}}
{{- print "policy/v1" -}}
{{- else -}}
{{- print "policy/v1beta1" -}}
{{- end -}}
{{- end -}}

{{/*
Return the appropriate apiVersion for NetworkPolicy
*/}}
{{- define "download.networkPolicy.apiVersion" -}}
{{- if .Capabilities.APIVersions.Has "networking.k8s.io/v1" -}}
{{- print "networking.k8s.io/v1" -}}
{{- else -}}
{{- print "networking.k8s.io/v1beta1" -}}
{{- end -}}
{{- end -}}

{{/*
Get the container security context
*/}}
{{- define "download.containerSecurityContext" -}}
{{- if .Values.containerSecurityContext.enabled -}}
securityContext:
  {{- omit .Values.containerSecurityContext "enabled" | toYaml | nindent 2 }}
{{- else if .Values.securityContext -}}
securityContext:
  {{- .Values.securityContext | toYaml | nindent 2 }}
{{- end -}}
{{- end -}}

{{/*
Return the MinIO URL for the application
*/}}
{{- define "download.minioUrl" -}}
{{- printf "http://%s:%s" .Values.config.minioHost .Values.config.minioPort -}}
{{- end -}}

{{/*
Get volume mounts for the container
*/}}
{{- define "download.volumeMounts" -}}
{{- if .Values.volumeMounts -}}
volumeMounts:
{{- toYaml .Values.volumeMounts | nindent 2 }}
{{- if and .Values.persistence.enabled (not (include "download.hasVideosVolumeMount" .)) }}
  - name: videos
    mountPath: {{ .Values.persistence.mountPath }}
{{- end }}
{{- else if .Values.persistence.enabled }}
volumeMounts:
  - name: videos
    mountPath: {{ .Values.persistence.mountPath }}
{{- end }}
{{- end }}

{{/*
Check if videos volume mount already exists
*/}}
{{- define "download.hasVideosVolumeMount" -}}
{{- $hasMount := false -}}
{{- range .Values.volumeMounts -}}
  {{- if eq .name "videos" -}}
    {{- $hasMount = true -}}
  {{- end -}}
{{- end -}}
{{- $hasMount -}}
{{- end -}}