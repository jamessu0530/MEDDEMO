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

{{/* 語音辨識、AI 模型、embedding、語音問答：金鑰從 Secret、參數從 ConfigMap（values.yaml 的 config）。
     envFrom 遇到同名的鍵以後面的為準，ConfigMap 放後面，參數就一律以 values.yaml 為準 */}}
{{- define "meddemo.aiEnvFrom" -}}
- secretRef:
    name: {{ .Values.secrets.ai }}
    optional: true
- configMapRef:
    name: meddemo-config
{{- end }}

{{/* ConfigMap 改了 pod 不會自己重讀；把內容的雜湊放進 pod 範本，values.yaml 的 config 一改，pod 就重建 */}}
{{- define "meddemo.configChecksum" -}}
checksum/config: {{ include (print .Template.BasePath "/config.yaml") . | sha256sum }}
{{- end }}
