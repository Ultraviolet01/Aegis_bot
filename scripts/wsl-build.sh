#!/usr/bin/env bash
set -e
export PATH="/root/.avm/bin:/root/.local/share/solana/install/active_release/bin:/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
echo "=== Environment Info ==="
echo "Anchor: $(anchor --version)"
echo "Solana: $(solana --version)"
echo "Rustc:  $(rustc --version)"
echo "Cargo:  $(cargo --version)"
echo "========================"
cd /mnt/c/Users/USER/Downloads/Aegis
anchor build
