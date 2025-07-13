{{/*
Standard ingress template for LilNAS services.

Usage in your chart:
  {{- include "lilnas.ingress" . }}
*/}}
{{- define "lilnas.ingress" -}}
{{- if .Values.ingress.enabled -}}
apiVersion: {{ include "lilnas.ingress.apiVersion" . }}
kind: Ingress
metadata:
  name: {{ include "lilnas.fullname" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "lilnas.labels" . | nindent 4 }}
    {{- with .Values.ingress.labels }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
  annotations:
    {{- include "lilnas.annotations" . | nindent 4 }}
    {{- if not (hasKey .Values.ingress.annotations "traefik.ingress.kubernetes.io/router.tls") }}
    traefik.ingress.kubernetes.io/router.tls: "true"
    {{- end }}
    {{- if not (hasKey .Values.ingress.annotations "traefik.ingress.kubernetes.io/router.entrypoints") }}
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    {{- end }}
    {{- if not (hasKey .Values.ingress.annotations "cert-manager.io/cluster-issuer") }}
    cert-manager.io/cluster-issuer: {{ .Values.ingress.certManager.clusterIssuer | default "letsencrypt-prod" }}
    {{- end }}
    {{- with .Values.ingress.annotations }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
spec:
  {{- if .Values.ingress.className }}
  ingressClassName: {{ .Values.ingress.className }}
  {{- end }}
  {{- if .Values.ingress.tls }}
  tls:
    {{- range .Values.ingress.tls }}
    - hosts:
        {{- range .hosts }}
        - {{ . | quote }}
        {{- end }}
      {{- if .secretName }}
      secretName: {{ .secretName }}
      {{- end }}
    {{- end }}
  {{- else if .Values.ingress.hosts }}
  tls:
    {{- range .Values.ingress.hosts }}
    {{- if .tls }}
    - hosts:
        - {{ .host | quote }}
      secretName: {{ .tlsSecret | default (printf "%s-tls" (.host | replace "." "-")) }}
    {{- end }}
    {{- end }}
  {{- end }}
  rules:
    {{- if .Values.ingress.hosts }}
    {{- range .Values.ingress.hosts }}
    - host: {{ .host | quote }}
      http:
        paths:
          {{- range .paths }}
          - path: {{ .path }}
            {{- if semverCompare ">=1.19-0" $.Capabilities.KubeVersion.GitVersion }}
            pathType: {{ .pathType | default "Prefix" }}
            {{- end }}
            backend:
              {{- if semverCompare ">=1.19-0" $.Capabilities.KubeVersion.GitVersion }}
              service:
                name: {{ .backend.service.name | default (include "lilnas.fullname" $) }}
                port:
                  {{- if .backend.service.port.number }}
                  number: {{ .backend.service.port.number }}
                  {{- else }}
                  name: {{ .backend.service.port.name | default "http" }}
                  {{- end }}
              {{- else }}
              serviceName: {{ .backend.serviceName | default (include "lilnas.fullname" $) }}
              servicePort: {{ .backend.servicePort | default "http" }}
              {{- end }}
          {{- end }}
    {{- end }}
    {{- else }}
    - http:
        paths:
          - path: {{ .Values.ingress.path | default "/" }}
            {{- if semverCompare ">=1.19-0" .Capabilities.KubeVersion.GitVersion }}
            pathType: {{ .Values.ingress.pathType | default "Prefix" }}
            {{- end }}
            backend:
              {{- if semverCompare ">=1.19-0" .Capabilities.KubeVersion.GitVersion }}
              service:
                name: {{ include "lilnas.fullname" . }}
                port:
                  number: {{ .Values.service.port | default 80 }}
              {{- else }}
              serviceName: {{ include "lilnas.fullname" . }}
              servicePort: {{ .Values.service.port | default 80 }}
              {{- end }}
    {{- end }}
{{- end }}
{{- end }}