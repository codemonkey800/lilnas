{{/*
Standard Secret template for LilNAS services.

Usage in your chart:
  {{- include "lilnas.secret" . }}
*/}}
{{- define "lilnas.secret" -}}
{{- if and .Values.secrets (not .Values.existingSecret) -}}
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "lilnas.secretName" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "lilnas.labels" . | nindent 4 }}
    {{- with .Values.secretLabels }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
  annotations:
    {{- include "lilnas.annotations" . | nindent 4 }}
    {{- with .Values.secretAnnotations }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
type: {{ .Values.secretType | default "Opaque" }}
{{- if .Values.secretsBase64Encoded }}
data:
  {{- range $key, $value := .Values.secrets }}
  {{ $key }}: {{ $value }}
  {{- end }}
{{- else }}
stringData:
  {{- range $key, $value := .Values.secrets }}
  {{ $key }}: {{ $value | quote }}
  {{- end }}
{{- end }}
{{- end -}}
{{- end -}}