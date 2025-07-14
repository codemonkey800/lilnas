{{/*
Standard service template for LilNAS services.

Usage in your chart:
  {{- include "lilnas.service" . }}
*/}}
{{- define "lilnas.service" -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "lilnas.fullname" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "lilnas.labels" . | nindent 4 }}
    {{- with .Values.service.labels }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
  annotations:
    {{- include "lilnas.annotations" . | nindent 4 }}
    {{- with .Values.service.annotations }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
spec:
  type: {{ .Values.service.type | default "ClusterIP" }}
  {{- if and (eq .Values.service.type "ClusterIP") .Values.service.clusterIP }}
  clusterIP: {{ .Values.service.clusterIP }}
  {{- end }}
  {{- if and (eq .Values.service.type "LoadBalancer") .Values.service.loadBalancerIP }}
  loadBalancerIP: {{ .Values.service.loadBalancerIP }}
  {{- end }}
  {{- if and (eq .Values.service.type "LoadBalancer") .Values.service.loadBalancerSourceRanges }}
  loadBalancerSourceRanges:
    {{- toYaml .Values.service.loadBalancerSourceRanges | nindent 4 }}
  {{- end }}
  {{- if .Values.service.externalTrafficPolicy }}
  externalTrafficPolicy: {{ .Values.service.externalTrafficPolicy }}
  {{- end }}
  {{- if .Values.service.sessionAffinity }}
  sessionAffinity: {{ .Values.service.sessionAffinity }}
  {{- if .Values.service.sessionAffinityConfig }}
  sessionAffinityConfig:
    {{- toYaml .Values.service.sessionAffinityConfig | nindent 4 }}
  {{- end }}
  {{- end }}
  ports:
  - name: http
    port: {{ .Values.service.port | default 80 }}
    targetPort: {{ .Values.service.targetPort | default "http" }}
    protocol: TCP
    {{- if and (or (eq .Values.service.type "NodePort") (eq .Values.service.type "LoadBalancer")) .Values.service.nodePort }}
    nodePort: {{ .Values.service.nodePort }}
    {{- end }}
  {{- range .Values.service.extraPorts }}
  - name: {{ .name }}
    port: {{ .port }}
    targetPort: {{ .targetPort | default .port }}
    protocol: {{ .protocol | default "TCP" }}
    {{- if and (or (eq $.Values.service.type "NodePort") (eq $.Values.service.type "LoadBalancer")) .nodePort }}
    nodePort: {{ .nodePort }}
    {{- end }}
  {{- end }}
  selector:
    {{- include "lilnas.selectorLabels" . | nindent 4 }}
{{- end -}}

{{/*
Headless service template for StatefulSets.

Usage in your chart:
  {{- include "lilnas.service.headless" . }}
*/}}
{{- define "lilnas.service.headless" -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "lilnas.fullname" . }}-headless
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "lilnas.labels" . | nindent 4 }}
    app.kubernetes.io/component: headless
    {{- with .Values.service.labels }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
  annotations:
    {{- include "lilnas.annotations" . | nindent 4 }}
    service.alpha.kubernetes.io/tolerate-unready-endpoints: "true"
    {{- with .Values.service.annotations }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
spec:
  type: ClusterIP
  clusterIP: None
  publishNotReadyAddresses: true
  ports:
  - name: http
    port: {{ .Values.service.port | default 80 }}
    targetPort: {{ .Values.service.targetPort | default "http" }}
    protocol: TCP
  {{- range .Values.service.extraPorts }}
  - name: {{ .name }}
    port: {{ .port }}
    targetPort: {{ .targetPort | default .port }}
    protocol: {{ .protocol | default "TCP" }}
  {{- end }}
  selector:
    {{- include "lilnas.selectorLabels" . | nindent 4 }}
{{- end -}}

{{/*
Enhanced service template with headless service support.
Creates a headless service when .Values.service.headless is true.

Usage in your chart:
  {{- include "lilnas.service.headless" . }}
*/}}
{{- define "lilnas.service.headless" -}}
{{- if .Values.service.headless }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ include "lilnas.fullname" . }}-headless
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "lilnas.labels" . | nindent 4 }}
    app.kubernetes.io/component: headless
    {{- with .Values.service.labels }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
  annotations:
    {{- include "lilnas.annotations" . | nindent 4 }}
    service.alpha.kubernetes.io/tolerate-unready-endpoints: "true"
    {{- with .Values.service.annotations }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
spec:
  type: ClusterIP
  clusterIP: None
  publishNotReadyAddresses: true
  ports:
  - name: http
    port: {{ .Values.service.port | default 80 }}
    targetPort: {{ .Values.service.targetPort | default "http" }}
    protocol: TCP
  {{- range .Values.service.extraPorts }}
  - name: {{ .name }}
    port: {{ .port }}
    targetPort: {{ .targetPort | default .port }}
    protocol: {{ .protocol | default "TCP" }}
  {{- end }}
  selector:
    {{- include "lilnas.selectorLabels" . | nindent 4 }}
{{- end }}
{{- end -}}