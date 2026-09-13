#!/usr/bin/env bash
# build_wsl.sh — Build aegis program inside WSL2 Ubuntu
# Usage: wsl -- bash /mnt/c/Users/USER/Downloads/Aegis/build_wsl.sh
set -e

export PATH="/root/.avm/bin:/root/.local/share/solana/install/active_release/bin:/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

echo "=== Environment Info ==="
echo "Anchor: $(anchor --version)"
echo "Solana: $(solana --version)"
echo "Rustc:  $(rustc --version)"
echo "Cargo:  $(cargo --version)"
echo "========================"

cd /mnt/c/Users/USER/Downloads/Aegis

# Enforce Cargo.lock version 3 (Solana SBF toolchain compatibility)
sed -i 's/^version = 4/version = 3/' Cargo.lock

# Use /root/target to avoid Windows NTFS I/O bottleneck
export CARGO_TARGET_DIR="/root/target"
mkdir -p /root/target

# Fetch new dependencies (jupiter-cpi git crate)
echo "=== Fetching dependencies (includes jupiter-cpi) ==="
cargo fetch

# Build the program
# --no-idl: skip IDL proc_macro generation (buggy with Rust 1.98)
# IDL is maintained manually via the patch below
echo "=== Building aegis program ==="
anchor build --no-idl

# Copy compiled artifacts to Windows-accessible target dir
mkdir -p target/deploy target/idl target/types
cp -r /root/target/deploy/* target/deploy/ 2>/dev/null || true

echo ""
echo "BUILD SUCCESS"
echo "Binary: target/deploy/aegis.so"
echo ""
echo "NOTE: IDL must be manually kept in sync with Rust source changes."
echo "Run 'anchor test --skip-build' after build to execute the test suite."

