import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { config } from "./config";
import { getOnChainMultiplierState, OnChainMultiplierState } from "./xstocks/onchain";
import { isInCorporateActionWindow } from "./xstocks/multiplier";
import { fetchMultiPoolPrice, MultiPoolPriceResult } from "./price/multiPool";
import { assessPosition, AssessmentResult } from "./risk/engine";
import { executeSwapAndDeliver, DispatchResult } from "./dispatcher/executor";

// ─── State per monitored position ─────────────────────────────────────────────

export interface PositionState {
  positionPubkey: PublicKey;
  owner: PublicKey;
  assetMint: PublicKey;
  targetMint: PublicKey;
  amount: anchor.BN;
  policyPubkey: PublicKey | null;
  paused: boolean;
  index: anchor.BN;

  policy: {
    drawdown_bps: number;
    oracle_deviation_bps: number;
    exit_bps: number;
    max_slippage_bps: number;
    active: boolean;
    target_mint: PublicKey;
  } | null;

  // Entry price snapshot (multiplier-normalized)
  entryPriceRaw: number | null;
  entryMultiplier: number | null;

  // Previous poll's price for oracle deviation check
  previousPriceRaw: number | null;
  previousMultiplier: number | null;

  // 2-poll persistence counter
  consecutiveBreachCount: number;

  // Custom corporate actions and multiplier overrides for live simulation
  customCorporateActions?: any[];
  customMultiplier?: number;
}

export type CustomPriceProvider = (
  assetMint: PublicKey,
  targetMint: PublicKey
) => Promise<MultiPoolPriceResult>;

// ─── Aegis Risk Guardian Monitor ──────────────────────────────────────────────

export class AegisMonitor {
  private connection: Connection;
  private agentKeypair: Keypair;
  private program: anchor.Program | null = null;
  private positionStates = new Map<string, PositionState>();
  private running = false;
  private customPriceProvider?: CustomPriceProvider;
  private isDryRun: boolean;

  constructor(opts?: {
    connection?: Connection;
    agentKeypair?: Keypair;
    program?: anchor.Program;
    customPriceProvider?: CustomPriceProvider;
    dryRun?: boolean;
  }) {
    this.connection = opts?.connection ?? new Connection(config.rpcUrl, "confirmed");
    this.agentKeypair = opts?.agentKeypair ?? config.agentKeypair;
    this.customPriceProvider = opts?.customPriceProvider;
    this.isDryRun = opts?.dryRun ?? false; // default to active dispatch when constructed directly

    if (opts?.program) {
      this.program = opts.program;
    } else {
      this.initProgram();
    }
  }


  private initProgram() {
    try {
      const idlPath = path.resolve(__dirname, "../../target/idl/aegis.json");
      if (fs.existsSync(idlPath)) {
        const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
        const wallet = new anchor.Wallet(this.agentKeypair);
        const provider = new anchor.AnchorProvider(this.connection, wallet, {
          commitment: "confirmed",
        });
        this.program = new anchor.Program(idl, provider);
      }
    } catch (err) {
      console.warn("[Aegis] Notice: IDL not loaded; running with in-memory state tracking.");
    }
  }

  public setCustomPriceProvider(provider: CustomPriceProvider) {
    this.customPriceProvider = provider;
  }

  public registerPosition(state: PositionState) {
    this.positionStates.set(state.positionPubkey.toBase58(), state);
  }

  public getPositionState(pubkey: PublicKey): PositionState | undefined {
    return this.positionStates.get(pubkey.toBase58());
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

  // ─── Main Monitoring Pass ──────────────────────────────────────────────────

  public async runPass(): Promise<{ assessed: number; breaches: number; dispatched: number }> {
    const positions = await this.fetchOpenPositions();
    console.log(`[Aegis] Pass — ${positions.length} position(s) active`);

    let assessed = 0;
    let breaches = 0;
    let dispatched = 0;

    for (const pos of positions) {
      try {
        const result = await this.assessAndAct(pos);
        if (result.assessed) assessed++;
        if (result.breached) breaches++;
        if (result.dispatched) dispatched++;
      } catch (err: any) {
        console.warn(
          `[Aegis] WARN — skipping position ${pos.positionPubkey.toBase58()}: ${err.message}`
        );
      }
    }

    console.log(
      `[Aegis] Pass complete — ${assessed}/${positions.length} assessed, ${breaches} breach(es), ${dispatched} dispatched`
    );

    return { assessed, breaches, dispatched };
  }

  // ─── Fetch Positions ───────────────────────────────────────────────────────

  private async fetchOpenPositions(): Promise<PositionState[]> {
    if (this.program && this.program.account && (this.program.account as any).position) {
      try {
        const onchainPositions = await (this.program.account as any).position.all();
        for (const onchainPos of onchainPositions) {
          const pubkeyStr = onchainPos.publicKey.toBase58();
          const acc = onchainPos.account;

          let policyData = null;
          let targetMint = new PublicKey(config.usdcMint);

          if (acc.policy) {
            try {
              const polAcc = await (this.program.account as any).policy.fetch(acc.policy);
              policyData = {
                drawdown_bps: polAcc.drawdownThresholdBps,
                oracle_deviation_bps: polAcc.deviationThresholdBps,
                exit_bps: polAcc.exitPercentBps,
                max_slippage_bps: polAcc.maxSlippageBps,
                active: polAcc.mode !== 0,
                target_mint: polAcc.targetMint,
              };
              targetMint = polAcc.targetMint;
            } catch {
              // policy fetch error
            }
          }

          const existing = this.positionStates.get(pubkeyStr);
          if (existing) {
            existing.amount = acc.amount;
            existing.paused = acc.paused;
            existing.targetMint = targetMint;
            if (policyData) existing.policy = policyData;
          } else {
            this.positionStates.set(pubkeyStr, {
              positionPubkey: onchainPos.publicKey,
              owner: acc.owner,
              assetMint: acc.assetMint,
              targetMint,
              amount: acc.amount,
              policyPubkey: acc.policy,
              paused: acc.paused,
              index: acc.index,
              policy: policyData,
              entryPriceRaw: null,
              entryMultiplier: null,
              previousPriceRaw: null,
              previousMultiplier: null,
              consecutiveBreachCount: 0,
            });
          }
        }
      } catch (err: any) {
        // RPC fetch error — continue with cached state
      }
    }

    return Array.from(this.positionStates.values());
  }

  // ─── Assess & Act on Single Position ───────────────────────────────────────

  public async assessAndAct(
    pos: PositionState
  ): Promise<{ assessed: boolean; breached: boolean; dispatched: boolean }> {
    if (!pos.policy || !pos.policy.active) {
      console.log(
        `[Aegis] Position ${pos.positionPubkey.toBase58().slice(0, 8)}… — no active policy, skipping`
      );
      return { assessed: false, breached: false, dispatched: false };
    }

    if (pos.paused) {
      console.log(
        `[Aegis] Position ${pos.positionPubkey.toBase58().slice(0, 8)}… — paused, skipping`
      );
      return { assessed: false, breached: false, dispatched: false };
    }

    // ── 1. On-Chain Multiplier State & Corporate Action Window ─────────────
    let multiplierState: OnChainMultiplierState | null = null;
    try {
      multiplierState = await getOnChainMultiplierState(this.connection, pos.assetMint);
    } catch {
      multiplierState = null;
    }

    const currentMultiplier = pos.customMultiplier ?? multiplierState?.currentMultiplier ?? 1.0;
    const corporateActions = pos.customCorporateActions ?? multiplierState?.actions ?? [];

    // Proactive suspension during the publish-to-activation window (§6)
    if (isInCorporateActionWindow(corporateActions)) {

      console.log(
        `[Aegis] ${pos.positionPubkey.toBase58().slice(0, 8)}… — Corporate action window active — triggers suspended (fail-safe)`
      );
      pos.consecutiveBreachCount = 0;
      return { assessed: true, breached: false, dispatched: false };
    }

    // ── 2. Multi-Pool Price Fetch & Divergence Guard ─────────────────────────
    let priceResult: MultiPoolPriceResult;
    if (this.customPriceProvider) {
      priceResult = await this.customPriceProvider(pos.assetMint, pos.targetMint);
    } else {
      priceResult = await fetchMultiPoolPrice(
        pos.assetMint.toBase58(),
        pos.targetMint.toBase58()
      );
    }

    // Fail-Closed: Skip assessment if price feed is unavailable
    if (priceResult.status === "UNAVAILABLE" || priceResult.priceUsd === null) {
      console.warn(
        `[Aegis] ${pos.positionPubkey.toBase58().slice(0, 8)}… — ${priceResult.reason} — skipping evaluation`
      );
      return { assessed: false, breached: false, dispatched: false };
    }

    // Circuit Breaker: Halt triggers if pool divergence > 150 BPS
    if (priceResult.status === "DIVERGENT") {
      console.warn(
        `[Aegis] ${pos.positionPubkey.toBase58().slice(0, 8)}… — CIRCUIT BREAKER: ${priceResult.reason}`
      );
      pos.consecutiveBreachCount = 0;
      return { assessed: true, breached: false, dispatched: false };
    }

    const currentPriceRaw = priceResult.priceUsd;

    // ── 3. Snapshot Entry Price on First Poll ────────────────────────────────
    if (pos.entryPriceRaw === null) {
      pos.entryPriceRaw = currentPriceRaw;
      pos.entryMultiplier = currentMultiplier;
      console.log(
        `[Aegis] Entry snapshot for ${pos.positionPubkey.toBase58().slice(0, 8)}…: ` +
          `$${currentPriceRaw.toFixed(2)} × ${currentMultiplier} = $${(currentPriceRaw * currentMultiplier).toFixed(2)}`
      );
    }

    // ── 4. Risk Assessment ───────────────────────────────────────────────────
    const assessment = assessPosition({
      policy: pos.policy,
      entryPriceRaw: pos.entryPriceRaw,
      entryMultiplier: pos.entryMultiplier ?? 1.0,
      currentPriceRaw,
      currentMultiplier,
      previousPriceRaw: pos.previousPriceRaw,
      previousMultiplier: pos.previousMultiplier,
      corporateActions,
    });

    // Update previous prices for next poll's oracle-deviation check
    pos.previousPriceRaw = currentPriceRaw;
    pos.previousMultiplier = currentMultiplier;

    console.log(
      `[Aegis] ${pos.positionPubkey.toBase58().slice(0, 8)}… — ${assessment.reason}`
    );

    if (!assessment.breached) {
      pos.consecutiveBreachCount = 0;
      return { assessed: true, breached: false, dispatched: false };
    }

    // ── 5. 2-Poll Temporal Persistence Check ─────────────────────────────────
    pos.consecutiveBreachCount += 1;
    if (pos.consecutiveBreachCount < 2) {
      console.log(
        `[Aegis] BREACH OBSERVED (poll 1/2) for ${pos.positionPubkey.toBase58().slice(0, 8)}…: ` +
          `awaiting 2-poll persistence confirmation before dispatching`
      );
      return { assessed: true, breached: true, dispatched: false };
    }

    console.log(
      `[Aegis] BREACH CONFIRMED (poll 2/2) across consecutive polls! Triggering autonomous swap_and_deliver...`
    );

    // ── 6. Autonomous Dispatcher ─────────────────────────────────────────────
    let dispatched = false;
    if (this.isDryRun) {
      console.log(
        `[Aegis] DRY_RUN=true — swap_and_deliver logged but NOT submitted to network`
      );
    } else if (this.program) {

      const dispatchRes = await executeSwapAndDeliver({
        connection: this.connection,
        program: this.program,
        agentKeypair: this.agentKeypair,
        positionPubkey: pos.positionPubkey,
        positionOwner: pos.owner,
        positionIndex: pos.index,
        assetMint: pos.assetMint,
        targetMint: pos.targetMint,
        exitBps: pos.policy.exit_bps,
        maxSlippageBps: pos.policy.max_slippage_bps,
        vaultAmount: pos.amount,
      });

      if (dispatchRes.success) {
        dispatched = true;
        console.log(
          `[Aegis] DISPATCH SUCCESS! Tx Signature: ${dispatchRes.txSignature}, ` +
            `CU consumed: ${dispatchRes.computeUnits}, Target Delta: +${dispatchRes.actualDelta} atoms`
        );
        pos.consecutiveBreachCount = 0; // Reset after successful exit
      } else {
        console.error(
          `[Aegis] DISPATCH FAILED for position ${pos.positionPubkey.toBase58()}: ${dispatchRes.error}`
        );
      }
    } else {
      console.log(
        `[Aegis] Program instance not initialized — skipping on-chain dispatch`
      );
    }

    return { assessed: true, breached: true, dispatched };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
