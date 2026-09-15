import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { AegisMonitor } from "./monitor";
import { config } from "./config";
import { fetchMultiPoolPrice, MultiPoolPriceResult } from "./price/multiPool";

/**
 * CLI trigger for a recordable demo.
 *
 * The guardian decides on live Jupiter quotes, so against real market data a
 * breach cannot be produced on demand — the entry price is snapshotted on the
 * first poll and only a genuine move of the policy's threshold would trip it.
 * This runner drives the *same* monitor the production loop uses
 * (AegisMonitor.runPass, which reads positions and their policy from chain) and
 * substitutes only the price feed for a scripted one. That substitution is the
 * seam the test suite already uses, and it is printed loudly on every pass so a
 * recording can never imply the drawdown was real.
 *
 * What stays real: the on-chain position, the on-chain policy being enforced, the
 * agent signature, the Jupiter CPI, and the resulting swap on the cloned pools.
 */

interface Options {
  drop: number;
  asset: string | null;
  dryRun: boolean;
  entryOverride: number | null;
  pauseMs: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { drop: 0.12, asset: null, dryRun: false, entryOverride: null, pauseMs: 2500 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--drop") opts.drop = Number(argv[++i]) / 100;
    else if (arg === "--asset") opts.asset = (argv[++i] ?? "").toUpperCase();
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--entry") opts.entryOverride = Number(argv[++i]);
    else if (arg === "--pause") opts.pauseMs = Number(argv[++i]);
  }
  if (!Number.isFinite(opts.drop) || opts.drop <= 0 || opts.drop >= 1) {
    throw new Error("--drop must be a percentage between 1 and 99");
  }
  return opts;
}

/**
 * Fallback entry prices, used only when the live quote is unavailable so the demo
 * still runs. Printed as a warning because the numbers are then illustrative.
 */
const FALLBACK_ENTRY: Record<string, number> = {
  XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W: 514.38, // SPYX
  Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ: 492.1, // QQQX
  Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re: 188.45, // GLDX
};

const AGENT_FIXTURE_PUBKEY = "9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu";

function resolveAgentKeypair(): { keypair: Keypair; note: string } {
  if (process.env.AGENT_KEYPAIR) {
    const raw = process.env.AGENT_KEYPAIR;
    if (raw.startsWith("[")) {
      return { keypair: Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))), note: "from AGENT_KEYPAIR (inline JSON)" };
    }
    if (fs.existsSync(raw)) {
      return {
        keypair: Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(raw, "utf-8")))),
        note: `from AGENT_KEYPAIR (${raw})`,
      };
    }
    throw new Error(`AGENT_KEYPAIR is set but not readable: ${raw}`);
  }
  // The validator's config PDA is initialised with this fixture agent. Its seed is a
  // constant in tests/aegis.ts, so it is localnet-only by construction.
  const seed = Buffer.alloc(32, 2);
  return {
    keypair: Keypair.fromSeed(seed),
    note: "LOCALNET FIXTURE agent (Buffer.alloc(32, 2)) — never use with real funds",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const { keypair: agentKeypair, note: agentNote } = resolveAgentKeypair();
  const monitor = new AegisMonitor({ dryRun: opts.dryRun, agentKeypair });
  const program = (monitor as any).program as anchor.Program;
  const connection: Connection = (monitor as any).connection;

  // Refuse to point this at anything that looks like a live cluster.
  const rpc = config.rpcUrl;
  if (!/127\.0\.0\.1|localhost/.test(rpc)) {
    throw new Error(
      `Refusing to run the demo trigger against a non-local RPC (${rpc}). ` +
        `Set SOLANA_RPC_URL to the local validator; this tool injects prices and must never run on mainnet.`
    );
  }

  console.log("=================================================================");
  console.log(" AEGIS — GUARDIAN TRIGGER (DEMO)");
  console.log("=================================================================");
  console.log(` RPC            : ${rpc}  (cloned-mainnet test validator)`);
  console.log(` Program        : ${config.programId}`);
  console.log(` Agent          : ${agentKeypair.publicKey.toBase58()}`);
  console.log(` Agent key      : ${agentNote}`);
  console.log(` Execution      : ${opts.dryRun ? "DRY RUN (no transaction sent)" : "LIVE DISPATCH (real tx on the local validator)"}`);
  console.log(` Scripted drop  : -${(opts.drop * 100).toFixed(1)}% after the entry snapshot`);
  console.log(" Price feed     : SCRIPTED — the drawdown below is injected, not market data.");
  console.log("                  The position, policy, agent signature and swap are real.");
  console.log("=================================================================");

  // Discover positions the same way the monitor does, so the banner can name the
  // policy that is about to be enforced.
  const positions = await (program.account as any).position.all();
  const rows: { pubkey: string; asset: string; vault: string; drawdown: string; exit: string; target: string }[] = [];
  for (const p of positions) {
    const acc = p.account;
    const asset = acc.assetMint.toBase58();
    if (opts.asset && !asset.toUpperCase().startsWith(opts.asset) && asset !== opts.asset) continue;
    let drawdown = "n/a";
    let exit = "n/a";
    let target = "n/a";
    if (acc.policy) {
      try {
        const pol = await (program.account as any).policy.fetch(acc.policy);
        drawdown = `${(pol.drawdownThresholdBps / 100).toFixed(2)}%`;
        exit = `${(pol.exitPercentBps / 100).toFixed(2)}%`;
        target = pol.targetMint.toBase58().slice(0, 8) + "…";
      } catch {
        /* policy unreadable - monitor will report it */
      }
    }
    rows.push({
      pubkey: p.publicKey.toBase58(),
      asset: asset.slice(0, 6) + "…" + asset.slice(-4),
      vault: acc.amount.toString(),
      drawdown,
      exit,
      target,
    });
  }

  if (rows.length === 0) {
    console.log("\nNo on-chain positions found. Create one first (deposit + policy), then re-run.");
    return;
  }

  console.log("\nOn-chain policies that will be enforced (read from the Policy accounts):");
  for (const r of rows) {
    console.log(`  position ${r.pubkey.slice(0, 10)}…  asset ${r.asset}  vault ${r.vault} atoms  ` +
      `trigger ${r.drawdown} → exit ${r.exit} to ${r.target}`);
  }
  console.log("");

  // Scripted feed. The healthy price for a mint is fetched once from the real
  // multi-pool path (or supplied with --entry), then reused for every later pass
  // so the injected drop is measured against a real starting point.
  const healthyPrice = new Map<string, number>();
  let phase: "entry" | "drop" = "entry";

  monitor.setCustomPriceProvider(async (assetMint, targetMint): Promise<MultiPoolPriceResult> => {
    const mint = assetMint.toBase58();
    if (!healthyPrice.has(mint)) {
      let price = opts.entryOverride;
      if (price === null) {
        const live = await fetchMultiPoolPrice(mint, targetMint.toBase58());
        if (live.status === "OK" && live.priceUsd !== null) {
          price = live.priceUsd;
          console.log(`[DEMO] entry reference ${mint.slice(0, 6)}… from live multi-pool quote: $${price.toFixed(2)}`);
        } else {
          price = FALLBACK_ENTRY[mint] ?? 500;
          console.log(`[DEMO] WARNING live quote unavailable (${live.reason}) — using illustrative entry $${price.toFixed(2)}`);
        }
      }
      healthyPrice.set(mint, price);
    }
    const base = healthyPrice.get(mint)!;
    const price = phase === "entry" ? base : base * (1 - opts.drop);
    return {
      status: "OK",
      priceUsd: price,
      spreadBps: 20,
      whirlpoolPrice: price * 0.999,
      raydiumPrice: price * 1.001,
      reason: `DEMO scripted feed (${phase}) — $${price.toFixed(2)} (spread 20 BPS)`,
    };
  });

  // Pass 1 — healthy price. The monitor snapshots the entry price here.
  console.log("--- PASS 1: healthy price (entry snapshot) ---");
  await monitor.runPass();
  await sleep(opts.pauseMs);

  // Passes 2 and 3 — dropped price. The monitor requires two consecutive breaches
  // before it will dispatch, so the first of these reports poll 1/2 and the second
  // confirms and executes.
  phase = "drop";
  console.log(`\n--- PASS 2: injected -${(opts.drop * 100).toFixed(1)}% (expect BREACH OBSERVED poll 1/2) ---`);
  await monitor.runPass();
  await sleep(opts.pauseMs);

  console.log("\n--- PASS 3: injected price held (expect BREACH CONFIRMED poll 2/2 + dispatch) ---");
  const finalPass = await monitor.runPass();

  console.log("\n=================================================================");
  console.log(" RESULT");
  console.log("=================================================================");
  console.log(` assessed ${finalPass.assessed}, breaches ${finalPass.breaches}, dispatched ${finalPass.dispatched}`);
  if (finalPass.dispatched === 0) {
    console.log(" No transaction was sent. Check the log above: a dispatch failure names its reason.");
  }
  void connection;
}

main().catch((err) => {
  console.error("[DEMO] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
