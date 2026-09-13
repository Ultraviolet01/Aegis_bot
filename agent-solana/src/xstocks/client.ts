import axios, { AxiosInstance } from "axios";

// ─── Types matching xStocks API v2 responses ───────────────────────────────────

export interface XStockAsset {
  /** Solana mint address for the token. Use this; do not rely on hand-guessed addresses. */
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  underlyingSymbol: string; // e.g. "SPY"
  multiplier: number;       // e.g. 1.0 at launch, 4.032 after a 4-for-1 split
}

export interface OraclePrice {
  mint: string;
  symbol: string;
  /** Issuer-verified price of 1 raw token in USD (before multiplier adjustment). */
  priceUsd: number;
  /** The current multiplier. Multiply priceUsd by multiplier to get the share-equivalent price. */
  multiplier: number;
  timestamp: number; // Unix seconds
}

export interface CorporateAction {
  mint: string;
  symbol: string;
  actionType: "split" | "dividend" | "reverse_split";
  /** New multiplier value that takes effect at activationTime. */
  newMultiplier: number;
  /** Old multiplier value before this action. */
  oldMultiplier: number;
  /** ISO 8601 ex-date string. */
  exDate: string;
  /**
   * Unix timestamp when the multiplier update activates on-chain.
   * Per xStocks docs: always 00:30 UTC the day after exDate.
   * The multiplier is PUBLISHED ON-CHAIN before this time — the agent
   * can read it ahead of activation to proactively suspend risk triggers.
   */
  activationTime: number;
  /** Whether this action has already been applied (activationTime is past). */
  applied: boolean;
  /**
   * True if the multiplier change falls within the ambiguous review band (3%-7%),
   * indicating an unconfirmed classification (e.g. large special dividend vs micro-split).
   */
  needsReview?: boolean;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class XStocksClient {
  private http: AxiosInstance;

  constructor(baseUrl = "https://api.xstocks.fi/api/v2") {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 10_000,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Fetch the verified list of all xStock assets with their Solana mint addresses.
   * Use this to resolve mint addresses — do NOT hardcode addresses.
   */
  async getAssets(): Promise<XStockAsset[]> {
    const res = await this.http.get("/assets");
    return res.data as XStockAsset[];
  }

  /**
   * Fetch the current issuer-verified oracle price for a specific mint.
   *
   * IMPORTANT (§7): This is the PRIMARY price source for drawdown calculations.
   * It is independent of any single DEX pool and bypasses wash-trading risk.
   * DEX pool prices are used only at execution time (Jupiter swap quote).
   */
  async getOraclePrice(mint: string): Promise<OraclePrice | null> {
    try {
      const res = await this.http.get(`/oracles/${mint}`);
      return res.data as OraclePrice;
    } catch (err: any) {
      if (err.response?.status === 404) return null;
      throw err;
    }
  }

  /**
   * Fetch all corporate action events for a specific mint.
   * Used to:
   *   1. Normalise drawdown calculations (§6: a split is NOT a crash)
   *   2. Proactively suspend risk triggers in the publish→activation window
   */
  async getCorporateActions(mint: string): Promise<CorporateAction[]> {
    try {
      const res = await this.http.get(`/corporate-actions/${mint}`);
      return (res.data as CorporateAction[]) ?? [];
    } catch (err: any) {
      if (err.response?.status === 404) return [];
      throw err;
    }
  }

  /**
   * Convenience: get oracle price for a symbol (e.g. "SPYX").
   * Resolves via the assets list — always uses the verified mint address.
   */
  async getOraclePriceBySymbol(symbol: string): Promise<OraclePrice | null> {
    const assets = await this.getAssets();
    const asset = assets.find(
      (a) => a.symbol.toUpperCase() === symbol.toUpperCase()
    );
    if (!asset) return null;
    return this.getOraclePrice(asset.mint);
  }
}
