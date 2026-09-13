export interface PoolPriceQuote {
  dex: "Whirlpool" | "Raydium CLMM";
  outAmount: number; // in target token atomic units
  priceUsd: number;  // normalized to USD assuming 6 decimals for USDC/USDT
}

export type MultiPoolStatus = "OK" | "DIVERGENT" | "UNAVAILABLE";

export interface MultiPoolPriceResult {
  status: MultiPoolStatus;
  priceUsd: number | null;
  spreadBps: number | null;
  whirlpoolPrice: number | null;
  raydiumPrice: number | null;
  reason: string;
}

export const DIVERGENCE_THRESHOLD_BPS = 150; // 1.5% max allowable inter-pool divergence

/**
 * Fetch a quote from Jupiter Metis router for a specific DEX.
 */
async function fetchDexQuote(
  inputMint: string,
  outputMint: string,
  amountAtoms: number,
  dex: string,
  timeoutMs: number = 8000
): Promise<number | null> {
  try {
    const url = new URL("https://api.jup.ag/swap/v1/quote");
    url.searchParams.set("inputMint", inputMint);
    url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount", amountAtoms.toString());
    url.searchParams.set("slippageBps", "50");
    url.searchParams.set("dexes", dex);

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as any;
    if (data && data.outAmount) {
      return Number(data.outAmount);
    }

    return null;
  } catch (err: any) {
    return null;
  }
}


/**
 * Fetch prices across both Orca Whirlpool and Raydium CLMM, calculating
 * the inter-pool divergence spread and enforcing the 150 BPS divergence guard.
 *
 * @param inputMint SPYX or base asset mint
 * @param outputMint Target mint (e.g. USDC)
 * @param inputDecimals Number of decimals for input mint (8 for SPYX)
 * @param outputDecimals Number of decimals for output mint (6 for USDC)
 * @param referenceAmountTokens Base reference amount to quote (default: 1.0 token)
 */
export async function fetchMultiPoolPrice(
  inputMint: string,
  outputMint: string,
  inputDecimals: number = 8,
  outputDecimals: number = 6,
  referenceAmountTokens: number = 1.0
): Promise<MultiPoolPriceResult> {
  const referenceAtoms = Math.floor(referenceAmountTokens * Math.pow(10, inputDecimals));

  try {
    const [whirlpoolOut, raydiumOut] = await Promise.all([
      fetchDexQuote(inputMint, outputMint, referenceAtoms, "Whirlpool"),
      fetchDexQuote(inputMint, outputMint, referenceAtoms, "Raydium CLMM"),
    ]);

    // Fail-Closed: If either primary pool fails to return a quote, fail safe
    if (whirlpoolOut === null || raydiumOut === null) {
      const missing = [];
      if (whirlpoolOut === null) missing.push("Orca Whirlpool");
      if (raydiumOut === null) missing.push("Raydium CLMM");

      return {
        status: "UNAVAILABLE",
        priceUsd: null,
        spreadBps: null,
        whirlpoolPrice: null,
        raydiumPrice: null,
        reason: `Price feed unavailable: quote failed for ${missing.join(", ")} (fail-closed discipline)`,
      };
    }

    const whirlpoolPrice = (whirlpoolOut / Math.pow(10, outputDecimals)) / referenceAmountTokens;
    const raydiumPrice = (raydiumOut / Math.pow(10, outputDecimals)) / referenceAmountTokens;

    const minPrice = Math.min(whirlpoolPrice, raydiumPrice);
    if (minPrice <= 0) {
      return {
        status: "UNAVAILABLE",
        priceUsd: null,
        spreadBps: null,
        whirlpoolPrice,
        raydiumPrice,
        reason: "Invalid non-positive pool price returned",
      };
    }

    const spread = Math.abs(whirlpoolPrice - raydiumPrice) / minPrice;
    const spreadBps = Math.round(spread * 10_000);
    const midPrice = (whirlpoolPrice + raydiumPrice) / 2;

    // Divergence Guard Circuit Breaker
    if (spreadBps > DIVERGENCE_THRESHOLD_BPS) {
      return {
        status: "DIVERGENT",
        priceUsd: midPrice,
        spreadBps,
        whirlpoolPrice,
        raydiumPrice,
        reason: `POOL_DIVERGENCE: spread ${spreadBps} BPS exceeds ${DIVERGENCE_THRESHOLD_BPS} BPS limit (Whirlpool=$${whirlpoolPrice.toFixed(4)}, Raydium=$${raydiumPrice.toFixed(4)})`,
      };
    }

    return {
      status: "OK",
      priceUsd: midPrice,
      spreadBps,
      whirlpoolPrice,
      raydiumPrice,
      reason: `Multi-pool verified: spread ${spreadBps} BPS <= ${DIVERGENCE_THRESHOLD_BPS} BPS (Whirlpool=$${whirlpoolPrice.toFixed(4)}, Raydium=$${raydiumPrice.toFixed(4)})`,
    };
  } catch (err: any) {
    return {
      status: "UNAVAILABLE",
      priceUsd: null,
      spreadBps: null,
      whirlpoolPrice: null,
      raydiumPrice: null,
      reason: `Price feed exception: ${err.message}`,
    };
  }
}
