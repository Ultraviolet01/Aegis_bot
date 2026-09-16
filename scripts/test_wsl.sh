#!/usr/bin/env bash
set -e
export PATH="/root/.avm/bin:/root/.local/share/solana/install/active_release/bin:/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd /mnt/c/Users/USER/Downloads/Aegis
export CARGO_TARGET_DIR="/root/target"
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf >/dev/null 2>&1 || true
killall -9 solana-test-validator 2>/dev/null || true
sleep 1
rm -rf /mnt/c/Users/USER/Downloads/Aegis/.anchor/test-ledger 2>/dev/null || true
anchor test --skip-build 2>&1 | tee /mnt/c/Users/USER/Downloads/Aegis/anchor_test.log
