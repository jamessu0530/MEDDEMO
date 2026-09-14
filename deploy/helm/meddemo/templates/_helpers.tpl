{{- define "meddemo.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "meddemo.apiImage" -}}
{{ .Values.image.api }}:{{ .Values.image.tag }}
{{- end }}

{{/* 資料庫連線：密碼從 Secret 讀進 POSTGRES_PASSWORD，再代入連線網址。api、worker、seed 共用 */}}
{{- define "meddemo.databaseEnv" -}}
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.database }}
      key: POSTGRES_PASSWORD
- name: DATABASE_URL
  value: postgresql+psycopg://meddemo:$(POSTGRES_PASSWORD)@db:5432/meddemo
{{- end }}

{{- define "meddemo.aiEnvFrom" -}}
- secretRef:
    name: {{ .Values.secrets.ai }}
    optional: true
{{- end }}
