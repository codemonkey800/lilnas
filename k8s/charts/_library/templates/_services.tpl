{{/*
Multi-service template for LilNAS services that need multiple service endpoints.
This template creates multiple services based on the .Values.services array.

Usage in your chart:
  {{- include "lilnas.services" . }}

Configuration in values.yaml:
  services:
    - name: api              # Service name suffix (e.g., myapp-api)
      port: 9000            # Service port
      targetPort: 9000      # Container port
      protocol: TCP         # Optional, defaults to TCP
      type: ClusterIP       # Optional, defaults to ClusterIP
      labels:               # Optional additional labels
        component: api
      annotations:          # Optional additional annotations
        service.example.com/type: api
    - name: console
      port: 9001
      targetPort: 9001
      type: ClusterIP
      labels:
        component: console

For single service with multiple ports, use the standard lilnas.service template instead.
*/}}
{{- define "lilnas.services" -}}
{{- range .Values.services }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ include "lilnas.fullname" $ }}-{{ .name }}
  namespace: {{ $.Release.Namespace }}
  labels:
    {{- include "lilnas.labels" $ | nindent 4 }}
    {{- with .labels }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
  annotations:
    {{- include "lilnas.annotations" $ | nindent 4 }}
    {{- with .annotations }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
spec:
  type: {{ .type | default "ClusterIP" }}
  {{- if and (eq (.type | default "ClusterIP") "ClusterIP") .clusterIP }}
  clusterIP: {{ .clusterIP }}
  {{- end }}
  {{- if and (eq (.type | default "ClusterIP") "LoadBalancer") .loadBalancerIP }}
  loadBalancerIP: {{ .loadBalancerIP }}
  {{- end }}
  {{- if and (eq (.type | default "ClusterIP") "LoadBalancer") .loadBalancerSourceRanges }}
  loadBalancerSourceRanges:
    {{- toYaml .loadBalancerSourceRanges | nindent 4 }}
  {{- end }}
  {{- if .externalTrafficPolicy }}
  externalTrafficPolicy: {{ .externalTrafficPolicy }}
  {{- end }}
  {{- if .sessionAffinity }}
  sessionAffinity: {{ .sessionAffinity }}
  {{- if .sessionAffinityConfig }}
  sessionAffinityConfig:
    {{- toYaml .sessionAffinityConfig | nindent 4 }}
  {{- end }}
  {{- end }}
  ports:
  - name: {{ .name }}
    port: {{ .port }}
    targetPort: {{ .targetPort | default .port }}
    protocol: {{ .protocol | default "TCP" }}
    {{- if and (or (eq (.type | default "ClusterIP") "NodePort") (eq (.type | default "ClusterIP") "LoadBalancer")) .nodePort }}
    nodePort: {{ .nodePort }}
    {{- end }}
  {{- range .extraPorts }}
  - name: {{ .name }}
    port: {{ .port }}
    targetPort: {{ .targetPort | default .port }}
    protocol: {{ .protocol | default "TCP" }}
    {{- if and (or (eq ($.type | default "ClusterIP") "NodePort") (eq ($.type | default "ClusterIP") "LoadBalancer")) .nodePort }}
    nodePort: {{ .nodePort }}
    {{- end }}
  {{- end }}
  selector:
    {{- include "lilnas.selectorLabels" $ | nindent 4 }}
{{- end }}
{{- end -}}

{{/*
Headless services template for StatefulSets.
Creates headless services for each service defined in .Values.services.

Usage in your chart:
  {{- include "lilnas.services.headless" . }}

Note: Only creates headless services if .Values.services is defined and .Values.headlessServices.enabled is true.
*/}}
{{- define "lilnas.services.headless" -}}
{{- if and .Values.services .Values.headlessServices.enabled }}
{{- range .Values.services }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ include "lilnas.fullname" $ }}-{{ .name }}-headless
  namespace: {{ $.Release.Namespace }}
  labels:
    {{- include "lilnas.labels" $ | nindent 4 }}
    app.kubernetes.io/component: headless
    {{- with .labels }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
  annotations:
    {{- include "lilnas.annotations" $ | nindent 4 }}
    service.alpha.kubernetes.io/tolerate-unready-endpoints: "true"
    {{- with .annotations }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
spec:
  type: ClusterIP
  clusterIP: None
  publishNotReadyAddresses: true
  ports:
  - name: {{ .name }}
    port: {{ .port }}
    targetPort: {{ .targetPort | default .port }}
    protocol: {{ .protocol | default "TCP" }}
  {{- range .extraPorts }}
  - name: {{ .name }}
    port: {{ .port }}
    targetPort: {{ .targetPort | default .port }}
    protocol: {{ .protocol | default "TCP" }}
  {{- end }}
  selector:
    {{- include "lilnas.selectorLabels" $ | nindent 4 }}
{{- end }}
{{- end }}
{{- end -}}