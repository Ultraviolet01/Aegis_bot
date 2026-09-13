import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { config } from "./config";
import { XStocksClient, OraclePrice, CorporateAction } from "./xstocks/client";
import { assessPosition } from "./risk/engine";

// ─── State per monitored position ─────────────────────────────────────────────

interface PositionState {
  positionPubkey: PublicKey;
  owner: PublicKey;
  assetMint: PublicKey;
  amount: anchor.BN;
  policyPubkey: PublicKey | null;
  paused: boolean;
  index: anchor.BN;

  // Policy params (fetched once per loop, re-fetched if missing)
  policy: {
    drawdown_bps: number;
    oracle_deviation_bps: number;
    exit_bps: number;
    max_slippage_bps: number;
    active: boolean;
  } | null;

  // Entry price snapshot — taken when position was opened (approximated as first poll)
  entryPriceRaw: number | null;
  entryMultiplier: number | null;

  // Previous poll's price for oracle deviation check
  previousPriceRaw: number | null;
  previousMultiplier: number | null;
}

// ─── Monitor ──────────────────────────────────────────────────────────────────

export class AegisMonitor {
  private connection: Connection;
  private agentKeypair: Keypair;
  private xstocks: XStocksClient;
  private positionStates = new Map<string, PositionState>();
  private running = false;

  constructor() {
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.agentKeypair = config.agentKeypair;
    this.xstocks = new XStocksClient(config.xstocksApiBase);
  }

  async start() {
    console.log(`[Aegis] Starting monitor — DRY_RUN=${config.dryRun}`);
    console.log(`[Aegis] Agent: ${this.agentKeypair.publicKey.toBase58()}`);
    console.log(`[Aegis] Program: ${config.programId}`);
    this.running = true;

    while (this.running) {
      try {
        await this.runPass();
      } catch (err) {
        console.error("[Aegis] Uncaught error in monitoring pass:", err);
      }
      await sleep(config.pollIntervalMs);
    }
  }

  stop() {
    this.running = false;
  }

  // ─── Main monitoring pass ──────────────────────────────────────────────────

  private async runPass() {
    const positions = await this.fetchOpenPositions();
    console.log(`[Aegis] Pass — ${positions.length} position(s) found`);

    let assessed = 0;
    for (const pos of positions) {
      try {
        await this.assessAndAct(pos);
        assessed++;
      } catch (err: any) {
        console.warn(
          `[Aegis] WARN — skipping position ${pos.positionPubkey.toBase58()}: ${err.message}`
        );
      }
    }
    console.log(`[Aegis] Pass complete — ${assessed}/${positions.length} assessed`);
  }

  // ─── Fetch all open Aegis positions from the program ──────────────────────

  private async fetchOpenPositions(): Promise<PositionState[]> {
    // NOTE: In production, use program.account.position.all() with Anchor client.
    // This stub returns cached states + would be replaced with real RPC call.
    // TODO: wire full Anchor program client once IDL is generated post-build.
    return Array.from(this.positionStates.values());
  }

  // ─── Assess a single position and trigger swap if breached ────────────────

  private async assessAndAct(pos: PositionState): Promise<void> {
    if (!pos.policy || !pos.policy.active) {
      console.log(`[Aegis] Position ${pos.positionPubkey.toBase58()} — no active policy, skipping`);
      return;
    }
    if (pos.paused) {
      console.log(`[Aegis] Position ${pos.positionPubkey.toBase58()} — paused, skipping`);
      return;
    }

    // ── 1. Fetch oracle price from xStocks API ───────────────────────────────
    // FAIL-CLOSED: if the API fails, we skip assessment, never act on stale data.
    let oracle: OraclePrice | null;
    try {
      oracle = await this.xstocks.getOraclePrice(pos.assetMint.toBase58());
    } catch (err: any) {
      console.warn(`[Aegis] WARN — xStocks oracle fetch failed: ${err.message} — skipping position`);
      return;
    }
    if (!oracle) {
      console.warn(`[Aegis] WARN — no oracle price for mint ${pos.assetMint.toBase58()} — skipping`);
      return;
    }

    // ── 2. Fetch corporate actions ───────────────────────────────────────────
    let corporateActions: CorporateAction[] = [];
    try {
      corporateActions = await this.xstocks.getCorporateActions(pos.assetMint.toBase58());
    } catch {
      // Non-fatal — proceed without corp action data, but log it
      console.warn(`[Aegis] WARN — could not fetch corporate actions for ${pos.assetMint.toBase58()}`);
    }

    // ── 3. Snapshot entry price on first poll ────────────────────────────────
    const state = this.positionStates.get(pos.positionPubkey.toBase58())!;
    if (state.entryPriceRaw === null) {
      state.entryPriceRaw = oracle.priceUsd;
      state.entryMultiplier = oracle.multiplier;
      console.log(
        `[Aegis] Entry price snapshot for ${pos.positionPubkey.toBase58()}: ` +
          `$${oracle.priceUsd} × ${oracle.multiplier} = $${oracle.priceUsd * oracle.multiplier}`
      );
    }

    // ── 4. Assess ────────────────────────────────────────────────────────────
    const result = assessPosition({
      policy: pos.policy,
      entryPriceRaw: state.entryPriceRaw,
      entryMultiplier: state.entryMultiplier!,
      currentPriceRaw: oracle.priceUsd,
      currentMultiplier: oracle.multiplier,
      previousPriceRaw: state.previousPriceRaw,
      previousMultiplier: state.previousMultiplier,
      corporateActions,
    });

    // Update previous price for next poll
    state.previousPriceRaw = oracle.priceUsd;
    state.previousMultiplier = oracle.multiplier;

    console.log(
      `[Aegis] ${pos.positionPubkey.toBase58().slice(0, 8)}… — ${result.reason}`
    );

    if (result.corporateActionSuspension) {
      console.log(`[Aegis] Corporate action window active — triggers suspended`);
      return;
    }

    if (!result.breached) return;

    // ── 5. Breach detected — execute swap_and_deliver ────────────────────────
    console.log(
      `[Aegis] BREACH detected (${result.breachType}) on position ${pos.positionPubkey.toBase58()}`
    );
    await this.executeSwap(pos, oracle.priceUsd * oracle.multiplier);
  }

  // ─── Execute swap_and_deliver instruction ─────────────────────────────────

  private async executeSwap(pos: PositionState, currentPriceUsd: number): Promise<void> {
    if (!pos.policy) return;

    const ownerUsdcAta = await getAssociatedTokenAddress(
      new PublicKey(config.usdcMint),
      pos.owner
    );

    // Estimate quoted output amount (simplified — in production, query Jupiter quote API)
    const exitAmount =
      (pos.amount.toNumber() * pos.policy.exit_bps) / 10_000;
    const quotedOutAmount = Math.floor(exitAmount * currentPriceUsd); // rough USD estimate

    console.log(
      `[Aegis] Swap: exit ${pos.policy.exit_bps / 100}% = ${exitAmount} tokens ` +
        `→ ~${(quotedOutAmount / 1e6).toFixed(2)} USDC → ${ownerUsdcAta.toBase58()}`
    );

    if (config.dryRun) {
      console.log(`[Aegis] DRY_RUN — swap_and_deliver NOT sent`);
      return;
    }

    // TODO: Build and send the swap_and_deliver instruction via Anchor client
    // This requires the IDL generated by `anchor build`. Placeholder:
    console.log(`[Aegis] Sending swap_and_deliver transaction...`);
    // await program.methods.swapAndDeliver(pos.policy.exit_bps, new BN(quotedOutAmount))
    //   .accounts({ ... })
    //   .signers([this.agentKeypair])
    //   .rpc();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
