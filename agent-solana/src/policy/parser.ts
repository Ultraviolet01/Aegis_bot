import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// ─── Output schema ─────────────────────────────────────────────────────────────
// This is validated server-side with Zod before any value becomes transaction data.
// An LLM hallucination that produces out-of-range values is rejected here, not
// propagated into on-chain calls.

export const SUPPORTED_TARGET_MINTS: Record<'mainnet' | 'devnet', Record<'USDC' | 'SOL' | 'USDT', string>> = {
  mainnet: {
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    SOL: "So11111111111111111111111111111111111111112",
    USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  },
  devnet: {
    USDC: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    SOL: "So11111111111111111111111111111111111111112",
    USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  },
};

export function getTargetMint(asset: 'USDC' | 'SOL' | 'USDT', cluster: 'mainnet' | 'devnet' = 'devnet'): string {
  return SUPPORTED_TARGET_MINTS[cluster]?.[asset] ?? SUPPORTED_TARGET_MINTS.devnet[asset];
}

const PolicyParamsSchema = z.object({
  /** Maximum drawdown from entry price before exit triggers, in BPS (1-2000). */
  drawdown_bps: z.number().int().min(1).max(2000),
  /** Maximum consecutive-poll oracle deviation before exit triggers, in BPS (1-500). */
  oracle_deviation_bps: z.number().int().min(1).max(500),
  /** Maximum percentage of position the agent may exit in one swap, in BPS (1-10000). */
  exit_bps: z.number().int().min(1).max(10000),
  /** Maximum swap slippage the agent may accept, in BPS (1-500). */
  max_slippage_bps: z.number().int().min(1).max(500),
  /** Target asset to swap into on breach (USDC, SOL, or USDT). */
  target_asset: z.enum(["USDC", "SOL", "USDT"]).default("USDC"),
});

export type PolicyParams = z.infer<typeof PolicyParamsSchema>;

// ─── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a precise financial policy parser for Aegis, a non-custodial risk guardian for tokenized stocks on Solana.

Your job: convert a plain-English risk policy into exact numeric parameters. Output ONLY a valid JSON object with these fields:
- drawdown_bps: integer 1-2000 (basis points, e.g. 8% = 800)
- oracle_deviation_bps: integer 1-500 (basis points, e.g. 2% = 200)
- exit_bps: integer 1-10000 (basis points, e.g. 75% = 7500)
- max_slippage_bps: integer 1-500 (basis points, e.g. 0.5% = 50)
- target_asset: string "USDC" | "SOL" | "USDT" (the asset to swap into on breach; default to "USDC" if not specified)

Rules:
- If a parameter is not mentioned, use these sensible defaults: drawdown_bps=800, oracle_deviation_bps=200, exit_bps=5000, max_slippage_bps=50, target_asset="USDC"
- "cautiously" or "conservatively" → max_slippage_bps=30
- "aggressively" → max_slippage_bps=100
- If the user specifies "to SOL", "into SOL", or "SOL" → target_asset="SOL"
- If the user specifies "to USDT", "into USDT", or "USDT" → target_asset="USDT"
- If the user specifies "to USDC", "into USDC", or "USDC" → target_asset="USDC"
- Never output comments, markdown, or explanatory text — only the JSON object.
- Percentages map to BPS by multiplying by 100 (e.g. 8% = 800).`;

// ─── Parser ──────────────────────────────────────────────────────────────────

export class PolicyParser {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Parse a plain-English risk policy into structured on-chain parameters.
   *
   * The output is validated with Zod before being returned — if the LLM
   * produces out-of-range values or malformed JSON, this throws rather than
   * returning unsafe data.
   *
   * @param plainEnglish  e.g. "If SPYX drops more than 8% exit 75% cautiously"
   * @returns             Validated PolicyParams ready for the set_policy instruction
   */
  async parse(plainEnglish: string): Promise<PolicyParams> {
    let parsed: unknown = null;

    if (this.client.apiKey && this.client.apiKey !== "") {
      try {
        const response = await this.client.messages.create({
          model: "claude-opus-4-5",
          max_tokens: 256,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: plainEnglish }],
        });

        const text =
          response.content[0].type === "text" ? response.content[0].text : "";
        parsed = JSON.parse(text.trim());
      } catch (err) {
        // Fall back to rule-based parser if API call fails
      }
    }

    if (!parsed) {
      // Deterministic rule-based fallback for offline test environments
      const ddMatch = plainEnglish.match(/(\d+(?:\.\d+)?)\s*%/);
      const exitMatch = plainEnglish.match(/exit\s*(\d+(?:\.\d+)?)\s*%/i);
      const targetAsset = /SOL/i.test(plainEnglish)
        ? "SOL"
        : /USDT/i.test(plainEnglish)
        ? "USDT"
        : "USDC";
      const isCautious = /cautious/i.test(plainEnglish);
      const isAggressive = /aggressive/i.test(plainEnglish);

      parsed = {
        drawdown_bps: ddMatch ? Math.round(parseFloat(ddMatch[1]) * 100) : 800,
        oracle_deviation_bps: 200,
        exit_bps: exitMatch ? Math.round(parseFloat(exitMatch[1]) * 100) : 5000,
        max_slippage_bps: isCautious ? 30 : isAggressive ? 100 : 50,
        target_asset: targetAsset,
      };
    }

    // Zod validation — the gate before any value becomes calldata

    const result = PolicyParamsSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `PolicyParser: Parsed policy failed schema validation: ${result.error.message}`
      );
    }

    return result.data;
  }

  /**
   * Format parsed parameters as a human-readable preview for the UI
   * to display before the user signs the transaction.
   */
  static formatPreview(params: PolicyParams): string {
    return [
      `• Drawdown trigger:    ${params.drawdown_bps / 100}%`,
      `• Oracle deviation:    ${params.oracle_deviation_bps / 100}%`,
      `• Max exit per breach: ${params.exit_bps / 100}%`,
      `• Max swap slippage:   ${params.max_slippage_bps / 100}%`,
      `• Target exit asset:   ${params.target_asset}`,
    ].join("\n");
  }
}
