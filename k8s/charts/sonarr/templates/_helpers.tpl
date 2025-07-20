{{/*
Standard lilnas helpers - delegate to lilnas-common library
*/}}
{{- define "sonarr.name" -}}
{{- include "lilnas.name" . }}
{{- end }}

{{- define "sonarr.fullname" -}}
{{- include "lilnas.fullname" . }}
{{- end }}

{{- define "sonarr.chart" -}}
{{- include "lilnas.chart" . }}
{{- end }}

{{- define "sonarr.labels" -}}
{{- include "lilnas.labels" . }}
{{- end }}

{{- define "sonarr.selectorLabels" -}}
{{- include "lilnas.selectorLabels" . }}
{{- end }}

{{- define "sonarr.serviceAccountName" -}}
{{- include "lilnas.serviceAccountName" . }}
{{- end }}

{{/*
Sonarr-specific volume mounts
*/}}
{{- define "sonarr.volumeMounts" -}}
- name: config
  mountPath: /config
- name: tv
  mountPath: /tv
- name: downloads
  mountPath: /downloads
{{- if .Values.tmpVolume.enabled }}
- name: tmp
  mountPath: /tmp
{{- end }}
{{- end }}

{{/*
Sonarr-specific volumes
*/}}
{{- define "sonarr.volumes" -}}
- name: config
  persistentVolumeClaim:
    claimName: {{ include "sonarr.fullname" . }}-config
- name: tv
  persistentVolumeClaim:
    claimName: {{ include "sonarr.fullname" . }}-tv
- name: downloads
  persistentVolumeClaim:
    claimName: {{ include "sonarr.fullname" . }}-downloads
{{- if .Values.tmpVolume.enabled }}
- name: tmp
  emptyDir:
    {{- if .Values.tmpVolume.sizeLimit }}
    sizeLimit: {{ .Values.tmpVolume.sizeLimit }}
    {{- end }}
{{- end }}
{{- end }}