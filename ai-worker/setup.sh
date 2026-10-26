#!/usr/bin/env bash
# One-time setup on the EC2 server (Ubuntu 24.04). Run from the copied ai-worker folder:
#   cd ~/ai-worker && sudo bash setup.sh
set -euo pipefail

MODEL="${MODEL:-qwen3.5:4b}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "== Installing Node.js and Ollama"
apt-get update -y
apt-get install -y nodejs curl
command -v ollama >/dev/null || curl -fsSL https://ollama.com/install.sh | sh
systemctl enable --now ollama

echo "== Downloading the model ($MODEL), this takes a few minutes"
ollama pull "$MODEL"

echo "== Installing the worker"
install -d -m 755 /opt/safespace-worker
install -m 644 "$HERE/worker.mjs" /opt/safespace-worker/worker.mjs
install -m 644 "$HERE/safespace-worker.service" /etc/systemd/system/safespace-worker.service

if [ ! -f /etc/safespace-worker.env ]; then
  read -rp "Your Netlify site URL (e.g. https://your-site.netlify.app): " SITE_URL
  read -rsp "Worker key (same as SUMMARY_WORKER_KEY in Netlify): " WORKER_KEY; echo
  umask 077
  cat > /etc/safespace-worker.env <<EOF
SITE_URL=$SITE_URL
WORKER_KEY=$WORKER_KEY
MODEL=$MODEL
SUMMARY_LANGUAGE=English
EOF
fi
chmod 600 /etc/safespace-worker.env

systemctl daemon-reload
systemctl enable safespace-worker.service

echo
echo "Done. Test it now without powering off:"
echo "  sudo bash -c 'set -a; . /etc/safespace-worker.env; FORCE=1 node /opt/safespace-worker/worker.mjs'"
echo "Then stop the server from the AWS console (or: sudo poweroff)."
