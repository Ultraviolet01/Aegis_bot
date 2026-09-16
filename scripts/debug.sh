#!/usr/bin/env bash
export PATH="/root/.avm/bin:/root/.local/share/solana/install/active_release/bin:/root/.cargo/bin:$PATH"
echo "Solana CLI path: $(which solana)"
echo "Solana default keypair address: $(solana address 2>&1)"
