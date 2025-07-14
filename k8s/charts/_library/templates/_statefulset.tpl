{{/*
Standard StatefulSet template for LilNAS services.
This template provides a standardized StatefulSet with persistent storage support.

Usage in your chart:
  {{- include "lilnas.statefulset" . }}

Required values:
  - .Values.statefulset.serviceName (defaults to fullname)
  - .Values.persistence.enabled: true
  - .Values.persistence.size: storage size
  - .Values.persistence.storageClass: storage class name
*/}}
{{- define "lilnas.statefulset" -}}
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {{ include "lilnas.fullname" . }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "lilnas.labels" . | nindent 4 }}
    {{- with .Values.statefulsetLabels }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
  annotations:
    {{- include "lilnas.annotations" . | nindent 4 }}
    {{- with .Values.statefulsetAnnotations }}
    {{ toYaml . | nindent 4 }}
    {{- end }}
spec:
  serviceName: {{ .Values.statefulset.serviceName | default (include "lilnas.fullname" .) }}
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount | default 1 }}
  {{- end }}
  revisionHistoryLimit: {{ .Values.revisionHistoryLimit | default 3 }}
  selector:
    matchLabels:
      {{- include "lilnas.selectorLabels" . | nindent 6 }}
  {{- with .Values.updateStrategy }}
  updateStrategy:
    {{ toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.statefulset.podManagementPolicy }}
  podManagementPolicy: {{ . }}
  {{- end }}
  template:
    metadata:
      annotations:
        {{- if .Values.podAnnotations }}
        {{- toYaml .Values.podAnnotations | nindent 8 }}
        {{- end }}
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
        {{- if .Values.secrets }}
        checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
        {{- end }}
      labels:
        {{- include "lilnas.selectorLabels" . | nindent 8 }}
        {{- with .Values.podLabels }}
        {{ toYaml . | nindent 8 }}
        {{- end }}
    spec:
      {{- include "lilnas.imagePullSecrets" . | nindent 6 }}
      {{- if .Values.serviceAccount.create }}
      serviceAccountName: {{ include "lilnas.serviceAccountName" . }}
      {{- end }}
      {{- if .Values.podSecurityContext.enabled }}
      securityContext:
        {{- include "lilnas.podSecurityContext" . | nindent 8 }}
      {{- end }}
      {{- if .Values.initContainers }}
      initContainers:
        {{- toYaml .Values.initContainers | nindent 8 }}
      {{- end }}
      containers:
      - name: {{ .Chart.Name }}
        {{- if .Values.containerSecurityContext.enabled }}
        securityContext:
          {{- include "lilnas.containerSecurityContext" . | nindent 10 }}
        {{- end }}
        image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
        imagePullPolicy: {{ .Values.image.pullPolicy }}
        {{- with .Values.command }}
        command:
          {{- toYaml . | nindent 10 }}
        {{- end }}
        {{- with .Values.args }}
        args:
          {{- toYaml . | nindent 10 }}
        {{- end }}
        ports:
        - name: http
          containerPort: {{ .Values.service.targetPort | default 8080 }}
          protocol: TCP
        {{- range .Values.extraPorts }}
        - name: {{ .name }}
          containerPort: {{ .containerPort }}
          protocol: {{ .protocol | default "TCP" }}
        {{- end }}
        {{- with .Values.env }}
        env:
          {{- toYaml . | nindent 10 }}
        {{- end }}
        {{- if or .Values.config .Values.secrets .Values.extraEnvFrom }}
        envFrom:
          {{- include "lilnas.envFrom" . | nindent 10 }}
        {{- end }}
        {{- include "lilnas.livenessProbe" . | nindent 8 }}
        {{- include "lilnas.readinessProbe" . | nindent 8 }}
        {{- with .Values.startupProbe }}
        startupProbe:
          {{- toYaml . | nindent 10 }}
        {{- end }}
        resources:
          {{- include "lilnas.resources" . | nindent 10 }}
        {{- if or .Values.persistence.enabled .Values.tmpVolume.enabled .Values.cacheVolume.enabled .Values.extraVolumeMounts }}
        volumeMounts:
          {{- include "lilnas.volumeMounts" . | nindent 10 }}
        {{- end }}
        {{- with .Values.lifecycle }}
        lifecycle:
          {{- toYaml . | nindent 10 }}
        {{- end }}
      {{- with .Values.sidecars }}
      {{- toYaml . | nindent 6 }}
      {{- end }}
      {{- if or .Values.tmpVolume.enabled .Values.cacheVolume.enabled .Values.extraVolumes }}
      volumes:
        {{- if .Values.tmpVolume.enabled }}
        - name: tmp
          emptyDir:
            {{- with .Values.tmpVolume.sizeLimit }}
            sizeLimit: {{ . }}
            {{- end }}
        {{- end }}
        {{- if .Values.cacheVolume.enabled }}
        - name: cache
          emptyDir:
            {{- with .Values.cacheVolume.sizeLimit }}
            sizeLimit: {{ . }}
            {{- end }}
        {{- end }}
        {{- with .Values.extraVolumes }}
        {{ toYaml . | nindent 8 }}
        {{- end }}
      {{- end }}
      {{- if .Values.nodeSelector }}
      nodeSelector:
        {{- include "lilnas.nodeSelector" . | nindent 8 }}
      {{- end }}
      {{- if .Values.tolerations }}
      tolerations:
        {{- include "lilnas.tolerations" . | nindent 8 }}
      {{- end }}
      {{- if or .Values.affinity .Values.podAntiAffinity }}
      affinity:
        {{- include "lilnas.affinity" . | nindent 8 }}
      {{- end }}
      {{- with .Values.topologySpreadConstraints }}
      topologySpreadConstraints:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.priorityClassName }}
      priorityClassName: {{ . }}
      {{- end }}
      {{- with .Values.runtimeClassName }}
      runtimeClassName: {{ . }}
      {{- end }}
      {{- with .Values.schedulerName }}
      schedulerName: {{ . }}
      {{- end }}
      {{- with .Values.hostAliases }}
      hostAliases:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- if .Values.dnsPolicy }}
      dnsPolicy: {{ .Values.dnsPolicy }}
      {{- end }}
      {{- with .Values.dnsConfig }}
      dnsConfig:
        {{- toYaml . | nindent 8 }}
      {{- end }}
  {{- if .Values.persistence.enabled }}
  volumeClaimTemplates:
  - metadata:
      name: {{ .Values.persistence.volumeName | default "data" }}
      {{- with .Values.persistence.labels }}
      labels:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.persistence.annotations }}
      annotations:
        {{- toYaml . | nindent 8 }}
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
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.persistence.dataSource }}
      dataSource:
        {{- toYaml . | nindent 8 }}
      {{- end }}
  {{- range .Values.persistence.extraVolumeClaimTemplates }}
  - metadata:
      name: {{ .name }}
      {{- with .labels }}
      labels:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .annotations }}
      annotations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
    spec:
      accessModes:
        {{- range .accessModes }}
        - {{ . }}
        {{- end }}
      {{- if .storageClass }}
      {{- if (eq "-" .storageClass) }}
      storageClassName: ""
      {{- else }}
      storageClassName: {{ .storageClass | quote }}
      {{- end }}
      {{- end }}
      resources:
        requests:
          storage: {{ .size | quote }}
      {{- with .selector }}
      selector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .dataSource }}
      dataSource:
        {{- toYaml . | nindent 8 }}
      {{- end }}
  {{- end }}
  {{- end }}
{{- end -}}