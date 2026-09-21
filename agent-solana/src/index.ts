import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AegisMonitor, PositionState } from "./monitor";
import { config } from "./config";

// Real SPYX Token-2022 mint on Solana mainnet (Tokenized S&P 500 ETF)
const SPYX_MINT = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");

async function main() {
  const monitor = new AegisMonitor({ dryRun: config.dryRun });

  // In standalone / cloud monitoring mode (e.g. Railway worker without a local test validator),
  // register a default SPYX monitored position so the guardian evaluates live Jupiter multi-pool
  // prices and on-chain Token-2022 dividend multipliers 24/7.
  const isCloudOrStandalone =
    process.env.STANDALONE_MODE === "true" ||
    process.env.DEMO_MODE === "true" ||
    (!config.rpcUrl.includes("127.0.0.1") && !config.rpcUrl.includes("localhost"));

  if (isCloudOrStandalone) {
    const usdcMint = new PublicKey(config.usdcMint);
    const demoPositionPubkey = Keypair.fromSeed(Buffer.alloc(32, 101)).publicKey;

    const initialPosition: PositionState = {
      positionPubkey: demoPositionPubkey,
      owner: config.agentKeypair.publicKey,
      assetMint: SPYX_MINT,
      targetMint: usdcMint,
      amount: new anchor.BN(100_000_000), // 1.0 SPYX (~$771)
      policyPubkey: Keypair.fromSeed(Buffer.alloc(32, 201)).publicKey,
      paused: false,
      index: new anchor.BN(1),
      policy: {
        drawdown_bps: 500, // 5.0% stop-loss threshold
        oracle_deviation_bps: 200, // 2.0% oracle deviation
        exit_bps: 10000, // 100% exit to USDC
        max_slippage_bps: 50, // 0.50% max slippage
        active: true,
        target_mint: usdcMint,
      },
      entryPriceRaw: null,
      entryMultiplier: null,
      previousPriceRaw: null,
      previousMultiplier: null,
      consecutiveBreachCount: 0,
    };

    monitor.registerPosition(initialPosition);
    console.log(
      `[Aegis] Standalone mode: monitoring SPYX position (${demoPositionPubkey.toBase58().slice(0, 8)}…) against live Jupiter multi-pool quotes`
    );
  }

  // Graceful shutdown on SIGINT/SIGTERM
  process.on("SIGINT", () => {
    console.log("[Aegis] SIGINT received — shutting down");
    monitor.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    console.log("[Aegis] SIGTERM received — shutting down");
    monitor.stop();
    process.exit(0);
  });

  await monitor.start();
}

main().catch((err) => {
  console.error("[Aegis] Fatal error:", err);
  process.exit(1);
});
