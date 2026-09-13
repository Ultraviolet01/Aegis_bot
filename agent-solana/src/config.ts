import * as dotenv from "dotenv";
import * as fs from "fs";
import { Keypair, Connection, clusterApiUrl } from "@solana/web3.js";

dotenv.config();

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function loadKeypair(pathOrJson: string): Keypair {
  // Support either a file path or a raw JSON array of bytes
  if (pathOrJson.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(pathOrJson)));
  }
  const raw = fs.readFileSync(pathOrJson, "utf-8");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

export const config = {
  // Solana cluster — use "devnet" during development, "mainnet-beta" for production
  rpcUrl: process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet"),

  // Agent signing keypair — loaded from file path or raw JSON bytes in env
  agentKeypair: loadKeypair(required("AGENT_KEYPAIR")),

  // The deployed Aegis program ID
  programId: required("AEGIS_PROGRAM_ID"),

  // Anthropic API key for the NL policy parser
  anthropicApiKey: required("ANTHROPIC_API_KEY"),

  // xStocks API base URL (public, no auth required per §6)
  xstocksApiBase: process.env.XSTOCKS_API_BASE ?? "https://api.xstocks.fi/api/v2",

  // Monitoring poll interval in milliseconds (default: every 30 seconds)
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? "30000"),

  // Dry-run mode: when true the agent logs what it would do but does NOT send transactions
  dryRun: process.env.DRY_RUN !== "false",

  // USDC mint address for the target cluster
  usdcMint: required("USDC_MINT"),
};

export type Config = typeof config;
