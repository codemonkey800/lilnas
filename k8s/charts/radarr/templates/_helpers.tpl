{{/*
Expand the name of the chart.
*/}}
{{- define "radarr.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "radarr.fullname" -}}
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
{{- define "radarr.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "radarr.labels" -}}
helm.sh/chart: {{ include "radarr.chart" . }}
{{ include "radarr.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: lilnas
app.kubernetes.io/component: media-management
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "radarr.selectorLabels" -}}
app.kubernetes.io/name: {{ include "radarr.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "radarr.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "radarr.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Volume mounts for the main container
*/}}
{{- define "radarr.volumeMounts" -}}
{{- if .Values.persistence.config.enabled }}
- name: config
  mountPath: /config
{{- end }}
{{- if .Values.persistence.movies.enabled }}
- name: movies
  mountPath: /movies
{{- end }}
{{- if .Values.persistence.downloads.enabled }}
- name: downloads
  mountPath: /downloads
{{- end }}
{{- if .Values.tmpVolume.enabled }}
- name: tmp
  mountPath: /tmp
{{- end }}
{{- with .Values.volumeMounts }}
{{- toYaml . | nindent 0 }}
{{- end }}
{{- end }}

{{/*
Volumes for the pod
*/}}
{{- define "radarr.volumes" -}}
{{- if .Values.persistence.config.enabled }}
- name: config
  persistentVolumeClaim:
    claimName: {{ .Values.persistence.config.existingClaim | default (printf "%s-config" (include "radarr.fullname" .)) }}
{{- end }}
{{- if .Values.persistence.movies.enabled }}
- name: movies
  persistentVolumeClaim:
    claimName: {{ .Values.persistence.movies.existingClaim | default (printf "%s-movies" (include "radarr.fullname" .)) }}
{{- end }}
{{- if .Values.persistence.downloads.enabled }}
- name: downloads
  persistentVolumeClaim:
    claimName: {{ .Values.persistence.downloads.existingClaim | default (printf "%s-downloads" (include "radarr.fullname" .)) }}
{{- end }}
{{- if .Values.tmpVolume.enabled }}
- name: tmp
  emptyDir:
    {{- if .Values.tmpVolume.sizeLimit }}
    sizeLimit: {{ .Values.tmpVolume.sizeLimit }}
    {{- end }}
{{- end }}
{{- with .Values.volumes }}
{{- toYaml . | nindent 0 }}
{{- end }}
{{- end }}

{{/*
Common annotations
*/}}
{{- define "radarr.annotations" -}}
{{- with .Values.commonAnnotations }}
{{ toYaml . }}
{{- end }}
{{- end }}