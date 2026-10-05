#!/usr/bin/env bash
# One-time setup for an Oracle Cloud Always Free Ubuntu VM (Ampere A1 or x86).
# Usage on the VM: sudo bash setup.sh   (expects /opt/crg/api.env to exist)
set -euo pipefail

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker "${SUDO_USER:-ubuntu}"
fi

# Oracle's Ubuntu images ship iptables rules that reject everything except SSH.
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 6 -p tcp -m state --state NEW --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save; fi

# Swap gives PyTorch headroom on smaller shapes.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

test -f /opt/crg/api.env || { echo "Missing /opt/crg/api.env"; exit 1; }
chmod 600 /opt/crg/api.env
