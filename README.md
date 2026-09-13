# Aegis — Solana Rebuild (Stocklana Hackathon)

**Non-custodial AI risk guardian for tokenized stocks on Solana.**

> _Write your risk limit in plain English. Aegis turns it into on-chain policy and guards your xStock position — non-custodially, 24/7._

---

## What this is

This is a **from-scratch Solana rebuild** of Aegis for the [Stocklana hackathon](https://stocklana.xyz). It is a new, separate submission on a different chain from the original X Layer project. Nothing in this repo is EVM code.

| Layer | Technology |
|-------|-----------|
| Smart contract | Anchor / Rust |
| Token standard | SPL Token / Token-2022 |
| DEX execution | Jupiter (Metis on-chain routing) |
| Token oracle | xStocks Oracles API (issuer-verified) |
| AI policy parser | Claude claude-opus-4-5 |
| Frontend | Next.js 15 + Solana wallet adapter |
| Agent | TypeScript (Node.js) |

---

## Why Aegis vs. your brokerage

| Problem | Brokerage | Aegis |
|---------|-----------|-------|
| Market hours | Stop-losses only work Mon–Fri 9:30–4 | xStocks trade 24/7 — guardian never sleeps |
| Custody risk | Your assets are the broker's liability | You hold your keys; agent can only swap to your own USDC, SOL, or USDT wallet |
| Counterparty | Can freeze accounts, restrict trading | Smart contract is permissionless; only you can withdraw |
| Transparency | Black-box risk management | Every parameter you set is on-chain, auditable |
| Corporate actions | Manual adjustment required | Multiplier normalisation: splits are not crashes |

---

## Architecture

```
Owner (wallet)
   │
   │  set_policy(drawdown_bps, exit_bps, max_slippage_bps, target_mint)
   │  open_position(xStock token)
   │  withdraw() — ungated, always available
   ▼
Aegis Program (Anchor)
   │
   │  swap_and_deliver(exit_bps, quoted_out_min)  ← agent-only
   │    ├─ Verifies: agent == config.authorized_agent
   │    ├─ Verifies: policy is active
   │    ├─ Verifies: target_mint == policy.target_mint (USDC, SOL/WSOL, USDT)
   │    ├─ Derives destination = owner's ATA for target_mint (non-custodial guarantee)
   │    └─ CPI → Jupiter Router (Metis on-chain routing)
   ▼
Owner's USDC / SOL / USDT wallet (always, never arbitrary recipient)

Agent (TypeScript, off-chain, non-signing except for swap_and_deliver)
   ├─ Polls xStocks Oracles API every 30s (issuer-verified price)
   ├─ Fetches corporate actions (split/dividend awareness)
   ├─ normalizePrice(raw, multiplier) → drawdown calculation
   ├─ isInCorporateActionWindow() → suspend triggers during splits
   └─ On breach → swap_and_deliver (only if policy active, not paused)
```

---

## Non-custodial Invariants

1. **Withdraw is always available** — `withdraw()` is owner-only and can never be blocked by the agent
2. **Swap destination is derived on-chain** — `get_associated_token_address(owner)` in `swap_and_deliver`, never a parameter
3. **Slippage is capped at policy creation** — `max_slippage_bps` set by owner; agent cannot exceed it
4. **No arbitrary recipient** — the only account that ever receives swap output is the owner's own destination ATA (USDC, SOL, or USDT)

---

## Pool Verification (§7)

SPYX and several other xStock tickers were found to have wash-trading across DEX pools by [mkzung/solana-xstocks-wash-analysis](https://github.com/mkzung/solana-xstocks-wash-analysis).

**Our approach:** Use the **xStocks Oracles API** (issuer-verified, wash-trade-resistant) as the primary price source for all drawdown calculations. DEX pool prices are only used at swap execution time for slippage calculation.

See [`POOL_VERIFICATION.md`](./POOL_VERIFICATION.md) for the full analysis.

---

## Multiplier Normalisation (§6)

Without normalisation, a 4-for-1 stock split is mathematically indistinguishable from a 75% crash to a naive price-only agent. Aegis normalises all prices using the xStocks `multiplier` field before computing drawdown:

```
share_equivalent_price = raw_price_usd × multiplier
drawdown = (entry_share_eq - current_share_eq) / entry_share_eq
```

Test coverage: `agent-solana/test/risk/engine.test.ts` → `INVARIANT: 4-for-1 split does NOT trigger a breach` — 20/20 tests passing.

---

## Project Structure

```
Aegis/
├── programs/aegis/src/    # Anchor/Rust smart contract
│   ├── lib.rs             # Instructions: open_position, set_policy, swap_and_deliver, …
│   ├── state.rs           # Account structs: AegisConfig, Position, Policy
│   └── errors.rs          # Custom error codes
├── tests/aegis.ts         # Anchor test suite (invariant tests)
├── agent-solana/          # TypeScript monitoring agent
│   ├── src/
│   │   ├── config.ts      # Configuration (RPC URL, keypair, program ID)
│   │   ├── monitor.ts     # Main monitoring loop
│   │   ├── xstocks/       # xStocks API client + multiplier logic
│   │   ├── risk/          # Risk assessment engine (stateless)
│   │   └── policy/        # Claude NL policy parser
│   └── test/              # Unit tests (20/20 passing)
├── frontend/              # Next.js 15 frontend
│   └── app/
│       ├── page.tsx           # Marketing landing page
│       ├── app/page.tsx       # Dashboard (wallet connect, positions, policies)
│       ├── app/history/page.tsx  # Price chart, backtest, Q&A
│       └── api/               # Server routes: parse-policy, qa, xstocks proxy
├── scripts/
│   └── verify-spyx-pool.mjs  # Pool health verification script
└── POOL_VERIFICATION.md   # Wash-trading analysis and architecture decision
```

---

## Quick Start

### Prerequisites

- Rust (rustup) — installed ✅ (1.98.1)
- Solana CLI — installed ✅ (2.1.0)
- Anchor CLI — install via: `avm install latest && avm use latest`
- Node.js 20+

### Agent

```bash
cd agent-solana
npm install
cp .env.example .env     # fill in AGENT_KEYPAIR, AEGIS_PROGRAM_ID, ANTHROPIC_API_KEY
npm test                 # 20/20 tests should pass
npm run dev              # start monitoring (DRY_RUN=true by default)
```

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev              # http://localhost:3000
```

### Smart Contract

```bash
# After avm install:
avm install latest && avm use latest
anchor build
anchor test              # runs against local validator
anchor deploy --provider.cluster devnet
```

---

## Submission Notes

- **Chain:** Solana Devnet (devnet deploy pending `anchor build`)
- **xStocks API:** API endpoint verification pending launch access (`api.xstocks.fi/api/v2`)
- **Agent tests:** 20/20 passing — all critical invariants covered including split-vs-crash disambiguation
- **Jupiter integration:** Metis on-chain routing wired in `swap_and_deliver` (CPI stub, full wiring post-IDL generation)

