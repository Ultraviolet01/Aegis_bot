#!/usr/bin/env bash
set -e
export PATH="/root/.avm/bin:/root/.local/share/solana/install/active_release/bin:/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd /mnt/c/Users/USER/Downloads/Aegis
export CARGO_TARGET_DIR="/root/target"
anchor test --skip-build
