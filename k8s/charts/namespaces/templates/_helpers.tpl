{{/*
Expand the name of the chart.
*/}}
{{- define "namespaces.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "namespaces.fullname" -}}
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
{{- define "namespaces.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "namespaces.labels" -}}
helm.sh/chart: {{ include "namespaces.chart" . }}
{{ include "namespaces.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "namespaces.selectorLabels" -}}
app.kubernetes.io/name: {{ include "namespaces.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Merge labels for a namespace
Combines global default labels with namespace-specific labels
*/}}
{{- define "namespaces.namespaceLabels" -}}
{{- $namespace := .namespace }}
{{- $global := .global }}
{{- $projectName := .projectName }}
{{- $labels := dict }}
{{- if $global.defaultLabels }}
{{- $labels = merge $labels $global.defaultLabels }}
{{- end }}
{{- if $namespace.labels }}
{{- $labels = merge $labels $namespace.labels }}
{{- end }}
{{- $labels = merge $labels (dict "name" $namespace.name) }}
{{- if $projectName }}
{{- $labels = merge $labels (dict "project" $projectName) }}
{{- end }}
{{- toYaml $labels }}
{{- end }}

{{/*
Merge annotations for a namespace
Combines global default annotations with namespace-specific annotations
*/}}
{{- define "namespaces.namespaceAnnotations" -}}
{{- $namespace := .namespace }}
{{- $global := .global }}
{{- $annotations := dict }}
{{- if $global.defaultAnnotations }}
{{- $annotations = merge $annotations $global.defaultAnnotations }}
{{- end }}
{{- if $namespace.annotations }}
{{- $annotations = merge $annotations $namespace.annotations }}
{{- end }}
{{- if $annotations }}
{{- toYaml $annotations }}
{{- end }}
{{- end }}