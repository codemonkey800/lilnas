{{/*
Expand the name of the chart.
*/}}
{{- define "tdr-bot.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "tdr-bot.fullname" -}}
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
{{- define "tdr-bot.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "tdr-bot.labels" -}}
helm.sh/chart: {{ include "tdr-bot.chart" . }}
{{ include "tdr-bot.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: lilnas
app.kubernetes.io/component: tdr-bot
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "tdr-bot.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tdr-bot.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "tdr-bot.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "tdr-bot.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Create the name of the secret to use
*/}}
{{- define "tdr-bot.secretName" -}}
{{- if .Values.existingSecret }}
{{- .Values.existingSecret }}
{{- else }}
{{- include "tdr-bot.fullname" . }}-secrets
{{- end }}
{{- end }}

{{/*
Get the image tag
*/}}
{{- define "tdr-bot.imageTag" -}}
{{- .Values.image.tag | default .Chart.AppVersion }}
{{- end }}

{{/*
Return the appropriate apiVersion for autoscaling
*/}}
{{- define "tdr-bot.autoscaling.apiVersion" -}}
{{- if .Capabilities.APIVersions.Has "autoscaling/v2" -}}
{{- print "autoscaling/v2" -}}
{{- else -}}
{{- print "autoscaling/v2beta2" -}}
{{- end -}}
{{- end -}}

{{/*
Return the appropriate apiVersion for PodDisruptionBudget
*/}}
{{- define "tdr-bot.pdb.apiVersion" -}}
{{- if .Capabilities.APIVersions.Has "policy/v1" -}}
{{- print "policy/v1" -}}
{{- else -}}
{{- print "policy/v1beta1" -}}
{{- end -}}
{{- end -}}

{{/*
Return the appropriate apiVersion for NetworkPolicy
*/}}
{{- define "tdr-bot.networkPolicy.apiVersion" -}}
{{- if .Capabilities.APIVersions.Has "networking.k8s.io/v1" -}}
{{- print "networking.k8s.io/v1" -}}
{{- else -}}
{{- print "networking.k8s.io/v1beta1" -}}
{{- end -}}
{{- end -}}

{{/*
Get the container security context
*/}}
{{- define "tdr-bot.containerSecurityContext" -}}
{{- if .Values.containerSecurityContext.enabled -}}
securityContext:
  {{- omit .Values.containerSecurityContext "enabled" | toYaml | nindent 2 }}
{{- else if .Values.securityContext -}}
securityContext:
  {{- .Values.securityContext | toYaml | nindent 2 }}
{{- end -}}
{{- end -}}