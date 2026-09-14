#!/usr/bin/env bash
# 在 care-vm 上安裝 MEDDEMO 專用的 GitHub Actions self-hosted runner，給 CI/CD 的 deploy job 用。
# 做法跟 CARE 一樣，但帳號、目錄、名稱都分開：CARE-infra 的 setup-self-hosted-runner.sh 固定裝在
# /opt/actions-runner，直接拿來裝 MEDDEMO 會蓋掉 CARE 的 runner。
#
# 用法：
#   1. GitHub → jamessu0530/MEDDEMO → Settings → Actions → Runners → New self-hosted runner，
#      複製設定指令裡的 token（一次性，一小時內有效）
#   2. 把這支腳本複製到 VM，執行：sudo bash setup-runner.sh --token <token>
set -euo pipefail

REPO_URL="https://github.com/jamessu0530/MEDDEMO"
RUNNER_USER="meddemo-runner"
RUNNER_NAME="meddemo-gcp-vm"
# deploy job 用 runs-on: [self-hosted, Linux, meddemo] 挑這台
RUNNER_LABELS="self-hosted,Linux,meddemo"
# 跟 care-vm 上 CARE 的 runner 同一版
RUNNER_VERSION="2.337.0"
INSTALL_DIR="/opt/meddemo-runner"
K3S_GROUP="k3s"
SUDOERS_FILE="/etc/sudoers.d/meddemo-runner"

REG_TOKEN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) REG_TOKEN="$2"; shift 2 ;;
    *) echo "未知參數：$1" >&2; exit 1 ;;
  esac
done
[[ -n "$REG_TOKEN" ]] || { echo "請用 --token 給 runner 註冊碼（GitHub 的 New self-hosted runner 頁面）" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || { echo "請用 sudo 執行" >&2; exit 1; }
for cmd in k3s kubectl helm; do
  command -v "$cmd" >/dev/null || { echo "找不到 $cmd：這台 VM 還沒裝好 K3s 與 Helm" >&2; exit 1; }
done
# kubeconfig 要是 0640 root:k3s，runner 加進群組才讀得到；care-vm 由 CARE-infra 的 install-vm-maintenance.sh --fix-kubeconfig 設好
getent group "$K3S_GROUP" >/dev/null || { echo "找不到 $K3S_GROUP 群組：kubeconfig 還不是 0640 root:$K3S_GROUP" >&2; exit 1; }

echo "==> 建立 runner 帳號 ${RUNNER_USER}"
id "$RUNNER_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$RUNNER_USER"
usermod -aG "$K3S_GROUP" "$RUNNER_USER"

echo "==> 設定 sudo：只允許把映像拉進 K3s、清掉沒在用的映像"
# GHCR 是私有的，映像要用 deploy job 的短期 token 先拉進 K3s；K3s 的 containerd 只有 root 能操作
tmp="$(mktemp)"
cat >"$tmp" <<EOF
# 由 MEDDEMO/deploy/setup-runner.sh 產生
${RUNNER_USER} ALL=(root) NOPASSWD: /usr/local/bin/k3s crictl pull *, /usr/local/bin/k3s crictl rmi --prune
EOF
# sudoers 語法錯誤會讓整台機器無法 sudo，先驗證再裝
visudo -cqf "$tmp"
install -m 0440 -o root -g root "$tmp" "$SUDOERS_FILE"
rm -f "$tmp"

echo "==> 下載 actions-runner ${RUNNER_VERSION} 到 ${INSTALL_DIR}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
curl -fsSLO "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
tar xzf "actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
rm -f "actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
chown -R "$RUNNER_USER:$RUNNER_USER" "$INSTALL_DIR"

echo "==> 註冊 runner（labels: ${RUNNER_LABELS}）"
sudo -u "$RUNNER_USER" ./config.sh --url "$REPO_URL" --token "$REG_TOKEN" \
  --name "$RUNNER_NAME" --labels "$RUNNER_LABELS" --unattended --replace

echo "==> 安裝成 systemd 服務"
./svc.sh install "$RUNNER_USER"
./svc.sh start

echo "完成。到 GitHub → MEDDEMO → Settings → Actions → Runners 確認 ${RUNNER_NAME} 是 Idle。"
