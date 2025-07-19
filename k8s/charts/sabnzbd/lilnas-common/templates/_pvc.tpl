{{/*
Standard PersistentVolumeClaim template for LilNAS services.

Usage in your chart:
  {{- include "lilnas.pvc" . }}
*/}}
{{- define "lilnas.pvc" -}}
{{- if and .Values.persistence.enabled (not .Values.persistence.existingClaim) -}}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "lilnas.fullname" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "lilnas.labels" . | nindent 4 }}
    {{- with .Values.persistence.labels }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
  annotations:
    {{- include "lilnas.annotations" . | nindent 4 }}
    {{- with .Values.persistence.annotations }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
spec:
  accessModes:
    {{- range .Values.persistence.accessModes }}
    - {{ . }}
    {{- end }}
  {{- if .Values.persistence.storageClass }}
  {{- if (eq "-" .Values.persistence.storageClass) }}
  storageClassName: ""
  {{- else }}
  storageClassName: {{ .Values.persistence.storageClass | quote }}
  {{- end }}
  {{- end }}
  resources:
    requests:
      storage: {{ .Values.persistence.size | quote }}
  {{- with .Values.persistence.selector }}
  selector:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.persistence.dataSource }}
  dataSource:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end -}}
{{- end -}}