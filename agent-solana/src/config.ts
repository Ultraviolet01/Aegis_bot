import * as dotenv from "dotenv";
import * as fs from "fs";
import { Keypair, Connection, clusterApiUrl } from "@solana/web3.js";

dotenv.config();

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function loadKeypair(pathOrJson?: string): Keypair {
  if (!pathOrJson) {
    return Keypair.generate();
  }
  // Support either a file path or a raw JSON array of bytes
  if (pathOrJson.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(pathOrJson)));
  }
  if (fs.existsSync(pathOrJson)) {
    const raw = fs.readFileSync(pathOrJson, "utf-8");
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
  return Keypair.generate();
}

export const config = {
  // Solana cluster — use "http://127.0.0.1:8899" or devnet
  rpcUrl: process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899",

  // Agent signing keypair — loaded from file path, raw JSON bytes, or generated fallback
  agentKeypair: loadKeypair(process.env.AGENT_KEYPAIR),

  // The deployed Aegis program ID
  programId: process.env.AEGIS_PROGRAM_ID ?? "C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L",

  // Anthropic API key for the NL policy parser
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",

  // xStocks API base URL (public, no auth required per §6)
  xstocksApiBase: process.env.XSTOCKS_API_BASE ?? "https://api.xstocks.fi/api/v2",

  // Monitoring poll interval in milliseconds (default: every 30 seconds)
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? "30000"),

  // Dry-run mode: when true the agent logs what it would do but does NOT send transactions
  dryRun: process.env.DRY_RUN !== "false",

  // USDC mint address (defaults to mainnet/cloned USDC)
  usdcMint: process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};


export type Config = typeof config;
