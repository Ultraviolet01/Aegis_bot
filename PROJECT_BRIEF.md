# PROJECT BRIEF: Aegis on Solana — Stocklana Hackathon

This is the ground-truth document for this project. If a future conversation or agent output contradicts this brief, this brief wins unless explicitly revised. Read this in full before writing any code.

---

## 0. Critical Context: Transition to Solana

Aegis previously existed as an X Layer (EVM) project built for OKX's "Build X AI Season" hackathon. That submission is complete and already judged.

This is a **new, separate submission for the Stocklana Hackathon** on Solana. Nothing here preserves compatibility with the X Layer codebase. Solidity, ERC-20, viem/ethers, OKX DEX, and Foundry are **not used anywhere**. This is a from-scratch Solana build using Anchor/Rust, SPL/Token-2022, Jupiter, and Anchor's own test tooling.

---

## 1. What We're Building

**Aegis** — Non-custodial AI risk guardian for tokenized stocks (xStocks) on Solana.

**Tagline:** *"Write your risk limit in plain English. Aegis turns it into on-chain policy and guards your xStock position — non-custodially, 24/7."*

**Core Thesis:** Tokenized stocks on Solana (xStocks) trade 24/7, but retail brokerages close at 4:00 PM EST. Aegis protects equity positions during off-hours, earnings gaps, and weekend macro shocks while maintaining unconditional user sovereignty.

---

## 2. Invariants & Authority Boundary

1. **Withdraw is unconditional**: The user can call `withdraw` at any second. Neither the agent nor a paused state can gate user withdrawals.
2. **Deterministic exit destination**: In `swap_and_deliver`, the destination account is deterministically derived on-chain as the user's Associated Token Account (ATA) for their approved target mint (`USDC`, `SOL/WSOL`, or `USDT`). It is **never** passed as an arbitrary recipient parameter.
3. **Hard policy ceilings**: `exit_bps` and `max_slippage_bps` are clamped on-chain to the user-signed policy parameters. The agent cannot exceed them.

---

## 3. Verified On-Chain Assets (Solana Mainnet)

| Asset | Ticker | Mint Address | Standard | Decimals |
|---|---|---|---|---|
| SP500 xStock | SPYX / SPYx | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | Token-2022 | 8 |
| Wrapped SOL | WSOL | `So11111111111111111111111111111111111111112` | SPL Token | 9 |
| USD Coin | USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | SPL Token | 6 |
| Tether USD | USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | SPL Token | 6 |

---

## 4. Corporate Actions: On-Chain Multiplier Normalisation

Stock splits and dividend adjustments are **not crashes**.
xStocks uses the native **Token-2022 `ScaledUiAmountConfig` extension** (Extension ID 25) stored directly on the Mint account.

- **Current Multiplier**: Read on-chain via `config.multiplier`.
- **Pending Actions**: Published on-chain before activation via `config.newMultiplier` and `config.newMultiplierEffectiveTimestamp`.
- **Classification Logic (`DIVIDEND_THRESHOLD = 0.05`)**:
  - Relative change $< 5\%$: Classified as **`dividend`** (e.g. quarterly reinvestment adjustments like $1.0039 \rightarrow 1.0057$, which is ~0.18%).
  - Relative change $\ge 5\%$: Classified as **`split`** (if multiplier increases) or **`reverse_split`** (if multiplier decreases).
- **Ambiguous Borderline Review Band (`REVIEW_BAND = 0.02`)**:
  - A $2$ percentage point band is established around the $5\%$ threshold, defining an ambiguous zone between **$3\%$ and $7\%$** ($0.03 \le \text{pctChange} \le 0.07$).
  - **Rationale**: Ordinary quarterly equity dividends rarely exceed 1–2%, while standard forward/reverse stock splits are typically $\ge 10\%$ (e.g. 5:4, 4:3, 2:1). However, large special one-off dividends (3–5%) and subtle micro-splits (5–7%) can overlap in magnitude. Purely arithmetic classification without issuer metadata cannot be 100% confident in this zone.
  - **Behavior**: When a multiplier change falls in the $3\% - 7\%$ review band, the engine assigns its best-guess default label but flags the action with **`needsReview: true`**.
  - **Non-blocking Invariant**: The `needsReview` flag is strictly a human-facing transparency signal. It surfaces in the History tab UI with an amber caution badge (`⚠️`, e.g. *"Dividend (unconfirmed — please verify)"*) rather than stating the classification with false certainty. **It never blocks or modifies risk-engine calculations** — price normalisation ($\text{rawPrice} \times \text{multiplier}$) and drawdown math execute identically regardless of `needsReview`.
- **Window Suspension**: During the publish-to-activation window, risk triggers are proactively suspended to prevent spurious false breaches.

---

## 5. Price-Source Architecture & Guarantees

### Empirical Status of External APIs
Live probes against `https://api.xstocks.fi/api/v2` (`/assets`, `/oracles`, `/corporate-actions`) return `HTTP 404 (Cannot GET ...)`. The xStocks REST oracle is currently pre-launch/unmounted.

> [!IMPORTANT]
> **Submission Action Item:** Re-probe `https://api.xstocks.fi/api/v2/oracles` prior to final hackathon submission. If the official REST oracle comes online, plug it into `agent-solana` via `XSTOCKS_API_BASE`.

### Implemented Price Pipeline: Multi-Pool Cross-Check with Divergence Guard
Because single DEX pools were shown in the `mkzung/solana-xstocks-wash-analysis` study to experience wash trading across bot fleets, Aegis implements a **multi-pool cross-checked aggregation**:

1. **Routing Query**: Uses Jupiter Metis router (`api.jup.ag/swap/v1/quote`) to pull deliverable quotes across both the verified Orca Whirlpool (`gef4pD5g...`, $155k TVL) and Raydium CLMM (`4pCZCVE...`).
2. **Divergence Guard (Circuit Breaker)**:
   $$\text{Spread} = \frac{|P_{\text{orca}} - P_{\text{ray}}|}{\min(P_{\text{orca}}, P_{\text{ray}})}$$
   If the spread between the two primary pools exceeds **1.5% (150 BPS)**, the state is flagged as `POOL_DIVERGENCE`. The agent **refuses to trigger a breach**.
3. **2-Poll Temporal Persistence**: Breaches must persist across two consecutive polling intervals (30–60s) to eliminate transient single-block wash spikes.

### Residual Risk Disclosure
This architecture does **not** provide complete off-chain oracle independence from DEX pools. While single-pool wash trading cannot trigger a false exit due to the divergence guard, there remains a **residual risk of coordinated multi-pool manipulation**: if an attacker simultaneously skews liquidity across both Orca and Raydium within the divergence threshold under low liquidity conditions, the cross-check could be temporarily deceived. Full mitigation requires the official xStocks issuer oracle feed once live.

---

## 6. Technology Stack
 
* **Smart Contract**: Anchor 0.30.1 / Rust (`programs/aegis`).
* **Tokens**: SPL Token + Token-2022 (with `ScaledUiAmountConfig`).
* **DEX Execution**: Jupiter v6 / Metis Router (Versioned Transactions `v0` with Address Lookup Tables).
* **Guardian Agent**: Node.js / TypeScript (`agent-solana`).
* **Frontend**: Next.js 15, Solana Wallet Adapter, Recharts backtest simulation.

---

## 7. Testing Scope & Empirical Verification Status

> [!IMPORTANT]
> **Empirical Verification Status**:
> The automated test suite (`tests/aegis.ts`, executed against `solana-test-validator` with mainnet program & account cloning) proves 100% of Aegis program invariants, guardrails, and full atomic settlement on-chain:
> 1. **Unconditional Sovereignty**: User withdrawal can never be blocked by an agent, policy, or paused state.
> 2. **Hard Ceilings**: Max exit percentage (`exit_bps`) and slippage (`max_slippage_bps`) cannot exceed policy limits.
> 3. **Non-Custodial Destination Invariant**: Target token destinations are strictly clamped to the owner's deterministically derived ATA across USDC, WSOL, and USDT, rejecting attacker destinations in 15 on-chain fuzz iterations.
> 4. **Atomic Intermediate ATA Creation**: Idempotently initializes the position PDA's intermediate token account via CPI before swap invocation.
> 5. **Verbatim CPI Route Execution**: Passes Jupiter's exact routing account vector without hardcoded slot assumptions, using position PDA signer authority.
> 6. **Full End-to-End Settlement**: Verified on-chain with real before/after token balance increases (e.g. +770,402,633 USDC atoms delivered to owner ATA).
>
> Live network execution on devnet/mainnet will be captured in the submission demo recording as an operational showcase of the off-chain monitoring agent and frontend.

