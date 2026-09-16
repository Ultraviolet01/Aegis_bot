#!/usr/bin/env bash
set -e

export PATH="/root/.avm/bin:/root/.local/share/solana/install/active_release/bin:/root/.cargo/bin:$PATH"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== Starting Persistent Solana Test Validator ==="
echo "Project root: $PROJECT_ROOT"

LEDGER_DIR="/root/test-ledger"
rm -rf "$LEDGER_DIR"
mkdir -p "$LEDGER_DIR"

echo "Launching solana-test-validator on 0.0.0.0:8899 with clones and fixtures..."

exec solana-test-validator \
  --url https://api.mainnet-beta.solana.com \
  --ledger "$LEDGER_DIR" \
  --reset \
  --bind-address 0.0.0.0 \
  --rpc-port 8899 \
  --bpf-program C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L "$PROJECT_ROOT/target/deploy/aegis.so" \
  --clone JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 \
  --clone 4Ec7ZxZS6Sbdg5UGSLHbAnM7GQHp2eFd4KYWRexAipQT \
  --clone D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf \
  --clone CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK \
  --clone HzD2cCXXT3UQNjMMY6kDv9w6gZ9qquSdfoGXrLL3LXx \
  --clone 9iFER3bpjf1PTTCQCfTRu17EJgvsxo9pVyA9QWwEuX4x \
  --clone 4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw \
  --clone AUhtN1KPdVEQ1mh7gy3oHzjWyqHo5RQx1KEiFJdyqAeN \
  --clone 92aTAYGnUCH28J96EFzD8ELa6ZpdzXw4zqEuX1nD6oD7 \
  --clone 9EF8Jq2brNcdm9nfJz7PnrAELxVGyctjDiinYwEsmY3C \
  --clone F8DJtK4wZAu8qEqbz5cpFCpz8z6gcNSk4AmK9GX87GBQ \
  --clone 9hGdsny7q6d3wYWe9M8qAuEnZaBjA5K43ZmNygkKPxPF \
  --clone 585WvHT4x1pS8hLQXwWLe8Hy2UXpWcvGFazeVhbG8WjC \
  --clone Bdi2v6V8fFcxEwUJEgwK55GLJE3BP3N3q21Bun7DXqLu \
  --clone DrdecJVzkaRsf1TQu1g7iFncaokikVTHqpzPjenjRySY \
  --clone 6truu3rZuiB9rKQg4VYC3Dt3QwV7DgwGqXrYUcrvnDDE \
  --clone FewzDK5G6KngLBg1FAVNQvfaSuedfAjJ15GQbAcwQDda \
  --clone HJt8Tjdsc9ms9i4WCZEzhzr4oyf3ANcdzXrNdLPFqm3M \
  --clone CiQuPAfYp5v82vijk6u7wqFnaZqtGdJfUUSjDKAtT9ML \
  --clone 3EmW8zJDHrfgwpQJAt1oD6nxgQZLUwrCRSKk8Gr3iKRF \
  --clone GfnPjYVcEdwamhGDNRystmEpNJZSBapzsnyDkqnpYFAj \
  --clone bfnAPQbCU6tVz1Uetop624Y51vS7fRv9fMcjCjJkWoU \
  --clone 4imXMzr5Ko4WYJ7H4htiiczVD7J3pYLken17S6pP8VRu \
  --clone ukgnVfbs4VPpkpAMek743SAi4csf27W8K1myEXFHsby \
  --clone FgzUFsCR8pV2xa7n42BjYvZGQLsQvR3Xr12ccdPXrGHd \
  --clone MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr \
  --clone XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W \
  --clone Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ \
  --clone Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re \
  --clone EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --clone Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB \
  --clone So11111111111111111111111111111111111111112 \
  --account 69ZdxZGYkQyM96M4SkMFyPyySUgSkrRVRbVCVfwgsSFs "$PROJECT_ROOT/tests/fixtures/owner_spyx_ata.json" \
  --account 9ZDVEkWcriy72kGxy3SQLSqu6KnrYkDVNZU8ARJewuGN "$PROJECT_ROOT/tests/fixtures/owner_qqqx_ata.json" \
  --account GP27usgz5gfNA36wsnyj1MhANFCZc743us119p9ryjoB "$PROJECT_ROOT/tests/fixtures/vault_spyx_0.json" \
  --account 8WRexwfkLBQMw2Uk4f7GknuUyAhLJGk216CqYUeKr9Xe "$PROJECT_ROOT/tests/fixtures/vault_spyx_1.json" \
  --account 2hp9BvKvmoUXdhe3MHh8gNk5mKa8zbXZE6fF6npNSvA3 "$PROJECT_ROOT/tests/fixtures/vault_spyx_2.json" \
  --account A4p3onkNfE2ZNizGHyBegKuKkuduebmbttFpTsRg7G4Q "$PROJECT_ROOT/tests/fixtures/vault_spyx_3.json" \
  --account 43GWbJjXpKFdBvgtL7ovG4uJdSR3NBRv7iLhUvyL49xr "$PROJECT_ROOT/tests/fixtures/vault_spyx_4.json" \
  --account 8uR3tT9eoZb668zDG3uRVJr5FWYsXSQMtwBTkbvqJyds "$PROJECT_ROOT/tests/fixtures/vault_spyx_5.json" \
  --account CuMS6UKWARmhnDULj1d3F7sV4WwogpFiVcv6o1dUBCwL "$PROJECT_ROOT/tests/fixtures/vault_spyx_6.json" \
  --account 2r62b5D8wAuVieJsrMgX78P2Tf2EhFpNPg6ViLRevUL8 "$PROJECT_ROOT/tests/fixtures/vault_spyx_7.json" \
  --account 94bKAYDLoXsdt9xXPbnPskMk7HbVei3UXcsEsPuNigiH "$PROJECT_ROOT/tests/fixtures/vault_spyx_8.json" \
  --account BNtgJ5Vop8owKtLWxpDQhk52inGgY3nvf7Qym5oa1oek "$PROJECT_ROOT/tests/fixtures/vault_spyx_9.json" \
  --account 8UnSPpVfeLnQtDye6Gnynpu6xBLV3eZLZiASDGM3jCvc "$PROJECT_ROOT/tests/fixtures/vault_spyx_10.json" \
  --account BknUfg8djpWUjC7c29WvPrHNmb3EwfzaehFKesN1KRM1 "$PROJECT_ROOT/tests/fixtures/vault_qqqx_0.json" \
  --account BLf4PN16u8AGMtMqVHr5VmLvHAbv7RBPZqYDH1mYZvej "$PROJECT_ROOT/tests/fixtures/vault_qqqx_1.json" \
  --account BEG2SMrQN3hScTYYSuJsWtVVqQx8PSJ2mhZw2zW8TMDQ "$PROJECT_ROOT/tests/fixtures/vault_qqqx_2.json" \
  --account HYKxNpxHmxB8SNJLURAeziBRKxGG3c6xSqeJww1RM7ND "$PROJECT_ROOT/tests/fixtures/vault_qqqx_3.json" \
  --account 8iiPLFWdjFEiVk1pE5JDRrDvVYvBVHZE5Rp7FjsMvfkH "$PROJECT_ROOT/tests/fixtures/vault_qqqx_4.json" \
  --account FokF5nC2m528p51HX5jQjmhSMmEEpNkrXZ5k9feYPTxR "$PROJECT_ROOT/tests/fixtures/vault_qqqx_5.json" \
  --account BGn9hszWD14kotieQ6frZ1Nc9kGLhGFTfS6nz52Lg3LY "$PROJECT_ROOT/tests/fixtures/vault_qqqx_6.json" \
  --account 35mUShAx1b6SEiAAZbauha677jNdbpxqu18W1kvtjVx1 "$PROJECT_ROOT/tests/fixtures/vault_qqqx_7.json" \
  --account 8Z9HANQTK7LoZVvGDEzCN6yDkJWe8TfYEgBm91AebnTW "$PROJECT_ROOT/tests/fixtures/vault_qqqx_8.json" \
  --account FecSjLy35fE7FXjwFGtxWAfgQcGXFHW5qCqzkMRrsGYD "$PROJECT_ROOT/tests/fixtures/vault_qqqx_9.json" \
  --account C1Qj1UmUdyoE7hjJ82vjVjKQt8hw4gUF1fHwQgVPmD57 "$PROJECT_ROOT/tests/fixtures/vault_qqqx_10.json" \
  --account 5E7Z93GB9HqFJygid4JN49pET5Qt7isWuL2kpV5mX5Nf "$PROJECT_ROOT/tests/fixtures/vault_gldx_0.json" \
  --account 3jwP5HTJ4YiHrDL5xxjmj9bYt8LWFVxY6uW1uZ7xTWKN "$PROJECT_ROOT/tests/fixtures/vault_gldx_1.json" \
  --account B5zsQoDYK6HzppuQmeUBzdfd43WdPoWQ59NEwyxnPFCu "$PROJECT_ROOT/tests/fixtures/vault_gldx_2.json" \
  --account F1yCZsmNhwqGijZvyNKqHTgtsk5SeyLGL2RsBbLaoFjL "$PROJECT_ROOT/tests/fixtures/vault_gldx_3.json" \
  --account 25eKQsq4aQ6vz6eatmRADEJWPmoPkTDJibSJoWu6RMsS "$PROJECT_ROOT/tests/fixtures/vault_gldx_4.json" \
  --account 5HJwSdwmtYtPXwUeyyCWrfE4UcWhgQ37wEJdcvXQa1Vr "$PROJECT_ROOT/tests/fixtures/vault_gldx_5.json" \
  --account H9ufHdhPvaGMFWmMR2zoBBr5zHCLx72SMrw3EiDxMKch "$PROJECT_ROOT/tests/fixtures/vault_gldx_6.json" \
  --account EhPXKvAS2Xqo4NpwyKqANqvrBc81wPPKsDJdxcVHbHRn "$PROJECT_ROOT/tests/fixtures/vault_gldx_7.json" \
  --account 2nnNwHnJ53JqFtYUFTN9phnEXuxWLz4NNLnfvxM97pSP "$PROJECT_ROOT/tests/fixtures/vault_gldx_8.json" \
  --account 2yuhSgEVCJbtR9vgK2BoyBgUkb2bxTuBCNQ8TuFmcDoN "$PROJECT_ROOT/tests/fixtures/vault_gldx_9.json" \
  --account FKSxVFbjSRznh4wpq2S8HbKc7LLGuAu8dKvvtCXBZ55G "$PROJECT_ROOT/tests/fixtures/vault_gldx_10.json" \
  --account AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9 "$PROJECT_ROOT/tests/fixtures/authority.json" \
  --account 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu "$PROJECT_ROOT/tests/fixtures/agent.json" \
  --account GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB "$PROJECT_ROOT/tests/fixtures/owner.json" \
  --account EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1 "$PROJECT_ROOT/tests/fixtures/attacker.json"
