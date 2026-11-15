{{- define "retro-board.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "retro-board.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "retro-board.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "retro-board.labels" -}}
helm.sh/chart: {{ include "retro-board.chart" . }}
app.kubernetes.io/name: {{ include "retro-board.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "retro-board.selectorLabels" -}}
app.kubernetes.io/name: {{ include "retro-board.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "retro-board.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "retro-board.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "retro-board.apiImage" -}}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.apiRepository .Values.image.tag -}}
{{- end -}}

{{- define "retro-board.webImage" -}}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.webRepository .Values.image.tag -}}
{{- end -}}

{{- define "retro-board.assertGuards" -}}
{{- range $name, $value := .Values.config.extraEnv -}}
{{- if eq (upper $name) "TESTING" -}}
{{- fail "config.extraEnv must not set TESTING: it disables rate limiting and secret validation" -}}
{{- end -}}
{{- if not (kindIs "string" $value) -}}
{{- fail (printf "config.extraEnv.%s must be a quoted string: an unquoted number renders as 2.097152e+06 and crashes the backend on start" $name) -}}
{{- end -}}
{{- end -}}
{{- if ne (int .Values.api.replicas) 1 -}}
{{- fail "api.replicas must be 1: RetroBoard WS room/timer state is in-process memory (single-worker invariant)" -}}
{{- end -}}
{{- $cors := trim (.Values.config.corsOrigins | toString) -}}
{{- if or (kindIs "invalid" .Values.config.corsOrigins) (eq $cors "") (eq $cors "*") (eq (lower $cors) "null") (eq (lower $cors) "<nil>") -}}
{{- fail "config.corsOrigins must be explicitly set and must not be '*' or 'null'" -}}
{{- end -}}
{{- $tag := .Values.image.tag | toString -}}
{{- if and (not .Values.image.allowMutableTag) (or (eq $tag "latest") (eq $tag "dev") (eq $tag "")) (ne .Values.image.pullPolicy "Always") -}}
{{- fail "image.tag cannot be mutable ('latest'/'dev'/empty) unless image.pullPolicy=Always or image.allowMutableTag=true" -}}
{{- end -}}
{{- if not .Values.secrets.existingSecret -}}
  {{- $secretOrder := list "postgresPassword" "adminLogin" "adminPassword" "workspaceJwtSecret" "adminJwtSecret" -}}
  {{- $secretVals := dict
      "postgresPassword" .Values.secrets.postgresPassword
      "adminLogin" .Values.secrets.adminLogin
      "adminPassword" .Values.secrets.adminPassword
      "workspaceJwtSecret" .Values.secrets.workspaceJwtSecret
      "adminJwtSecret" .Values.secrets.adminJwtSecret
  -}}
  {{- range $k := $secretOrder -}}
    {{- $v := index $secretVals $k -}}
    {{- if or (kindIs "invalid" $v) (eq (trim ($v | toString)) "") -}}
      {{- fail (printf "secrets.%s must be set when secrets.existingSecret is empty" $k) -}}
    {{- end -}}
  {{- end -}}
  {{- if not .Values.secrets.allowDevPlaceholders -}}
    {{- $bad := list "changeme" "change-me" "change-me-workspace-secret" "change-me-admin-secret" "secret" "password" -}}
    {{- range $k := $secretOrder -}}
      {{- $lv := lower (trim ((index $secretVals $k) | toString)) -}}
      {{- if or (has $lv $bad) (hasPrefix "change-me" $lv) (hasPrefix "replace-me" $lv) -}}
        {{- fail (printf "secrets.%s contains a placeholder value; provide real secret or use secrets.existingSecret" $k) -}}
      {{- end -}}
    {{- end -}}
    {{- if lt (len (.Values.secrets.workspaceJwtSecret | toString)) 32 -}}
      {{- fail "secrets.workspaceJwtSecret must be at least 32 characters" -}}
    {{- end -}}
    {{- if lt (len (.Values.secrets.adminJwtSecret | toString)) 32 -}}
      {{- fail "secrets.adminJwtSecret must be at least 32 characters" -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
{{- if .Values.backup.enabled -}}
  {{- if or (eq (trim (.Values.backup.nfs.server | toString)) "") (eq (trim (.Values.backup.nfs.path | toString)) "") -}}
    {{- fail "backup.nfs.server and backup.nfs.path must be non-empty when backup.enabled=true" -}}
  {{- end -}}
{{- end -}}
{{- end -}}
