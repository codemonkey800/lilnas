{{/*
Standard ConfigMap template for LilNAS services.

Usage in your chart:
  {{- include "lilnas.configmap" . }}
*/}}
{{- define "lilnas.configmap" -}}
{{- if .Values.config -}}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "lilnas.configMapName" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "lilnas.labels" . | nindent 4 }}
    {{- with .Values.configMapLabels }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
  annotations:
    {{- include "lilnas.annotations" . | nindent 4 }}
    {{- with .Values.configMapAnnotations }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
data:
  {{- range $key, $value := .Values.config }}
  {{ $key }}: {{ $value | quote }}
  {{- end }}
{{- end -}}
{{- end -}}