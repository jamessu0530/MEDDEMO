#!/usr/bin/env bash
# 全新 VM 的一次性設定：安裝 K3s 與 Helm。適用 Ubuntu 24.04 LTS。
# MEDDEMO 目前跟 CARE 共用 care-vm，那台都已經裝好，不用跑這支。
#
# 用主控台的「SSH」按鈕登入 VM，執行：
#   curl -fsSL https://raw.githubusercontent.com/jamessu0530/MEDDEMO/main/deploy/bootstrap-vm.sh | sudo bash
# 裝完再用 deploy/setup-runner.sh 註冊 GitHub Actions runner。
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || { echo "請用 sudo 執行" >&2; exit 1; }

# 已經有 K3s 就不動：重跑安裝腳本會用這裡的參數改寫原本的設定並重啟 K3s，跑在上面的其他服務會一起中斷
if command -v k3s >/dev/null 2>&1; then
  echo "這台已經裝了 K3s，不重裝。" >&2
  exit 0
fi

# kubeconfig 以 0640 root:k3s 寫出：runner 帳號加進 k3s 群組就能部署，不必給全面 sudo
getent group k3s >/dev/null || groupadd --system k3s
mkdir -p /etc/rancher/k3s
cat >/etc/rancher/k3s/config.yaml <<EOF
write-kubeconfig-group: "k3s"
write-kubeconfig-mode: "0640"
# GCE 開機初期主機名稱是短名、開機完成才變 FQDN；固定節點名稱，免得 K3s 註冊成兩個節點
node-name: "$(hostname -s)"
EOF

# 保留 K3s 內建的 Traefik：對外入口是 Cloudflare → Traefik → web（Nginx），見 deploy/helm/meddemo/templates/ingress.yaml。
# HTTPS 要另外把 Cloudflare Origin 憑證放進 kube-system，當 Traefik 的預設憑證（care-vm 已經設好）。
# 不裝 Docker：映像檔直接拉進 K3s 自己的 containerd，VM 上不會有兩套映像庫搶磁碟。
curl -sfL https://get.k3s.io | sh -

# 部署流程用 helm upgrade 安裝 chart；版本跟 care-vm 上的一樣
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash -s -- --version v3.22.0

k3s kubectl get nodes
echo "完成。接著用 deploy/setup-runner.sh 註冊 runner，之後的部署都由 GitHub Actions 進行。"
