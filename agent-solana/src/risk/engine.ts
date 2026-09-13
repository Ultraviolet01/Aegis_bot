import { CorporateAction } from "../xstocks/client";
import { normalizePrice, isInCorporateActionWindow } from "../xstocks/multiplier";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type BreachType = "drawdown" | "oracle_deviation";

export interface PolicySnapshot {
  drawdown_bps: number;
  oracle_deviation_bps: number;
  exit_bps: number;
  max_slippage_bps: number;
}

export interface AssessmentResult {
  breached: boolean;
  breachType?: BreachType;
  /** Descriptive reason — logged on every assessment pass, not just breaches. */
  reason: string;
  /** Entry price used for drawdown calculation (multiplier-normalized). */
  entryPriceNormalized?: number;
  /** Current price used for drawdown calculation (multiplier-normalized). */
  currentPriceNormalized?: number;
  /** Drawdown percentage computed (0–1). */
  drawdownPct?: number;
  /** Oracle deviation percentage computed (0–1). */
  oracleDeviationPct?: number;
  /** If true, risk assessment was suspended due to a pending corporate action. */
  corporateActionSuspension?: boolean;
}

// ─── Risk Engine ───────────────────────────────────────────────────────────────

/**
 * Assess whether a position has breached its policy.
 *
 * This function is deliberately STATELESS — it takes all inputs as parameters
 * so it can be unit-tested without mocking network calls.
 *
 * Drawdown computation note (§6):
 *   All prices are multiplier-normalized before comparison. Without this, a
 *   stock split is mathematically indistinguishable from a crash. The
 *   xStocks Oracles API provides both priceUsd and multiplier; we normalize
 *   both the entry price snapshot and the current price the same way.
 *
 * Corporate action suspension (§6 bonus):
 *   If we are in the publish→activation window for an upcoming split or
 *   dividend, we SUSPEND risk triggers entirely for that poll cycle. This
 *   prevents a false breach from the transient anomaly the new multiplier
 *   can create before it activates.
 */
export function assessPosition(params: {
  policy: PolicySnapshot;
  /** Raw entry price (from when the position was opened), in USD. */
  entryPriceRaw: number;
  entryMultiplier: number;
  /** Current raw price from xStocks Oracles API. */
  currentPriceRaw: number;
  currentMultiplier: number;
  /** Previous poll's current price (raw). Used for oracle deviation check. */
  previousPriceRaw: number | null;
  previousMultiplier: number | null;
  corporateActions: CorporateAction[];
  nowMs?: number;
}): AssessmentResult {
  const {
    policy,
    entryPriceRaw,
    entryMultiplier,
    currentPriceRaw,
    currentMultiplier,
    previousPriceRaw,
    previousMultiplier,
    corporateActions,
    nowMs = Date.now(),
  } = params;

  // ── Corporate action suspension ───────────────────────────────────────────
  if (isInCorporateActionWindow(corporateActions, nowMs)) {
    return {
      breached: false,
      reason: "Corporate action window — risk triggers suspended",
      corporateActionSuspension: true,
    };
  }

  // ── Normalize prices using current multipliers ────────────────────────────
  const entryPriceNorm = normalizePrice(entryPriceRaw, entryMultiplier);
  const currentPriceNorm = normalizePrice(currentPriceRaw, currentMultiplier);

  // ── Drawdown check ────────────────────────────────────────────────────────
  if (entryPriceNorm <= 0) {
    return { breached: false, reason: "Entry price is zero or negative — skipping" };
  }

  const drawdownPct = (entryPriceNorm - currentPriceNorm) / entryPriceNorm;
  const drawdownThreshold = policy.drawdown_bps / 10_000;

  if (drawdownPct >= drawdownThreshold) {
    return {
      breached: true,
      breachType: "drawdown",
      reason: `Drawdown ${(drawdownPct * 100).toFixed(2)}% >= policy threshold ${(drawdownThreshold * 100).toFixed(2)}%`,
      entryPriceNormalized: entryPriceNorm,
      currentPriceNormalized: currentPriceNorm,
      drawdownPct,
    };
  }

  // ── Oracle deviation check (consecutive-poll jump) ────────────────────────
  if (previousPriceRaw !== null && previousMultiplier !== null) {
    const previousPriceNorm = normalizePrice(previousPriceRaw, previousMultiplier);
    if (previousPriceNorm > 0) {
      const deviationPct = Math.abs(currentPriceNorm - previousPriceNorm) / previousPriceNorm;
      const deviationThreshold = policy.oracle_deviation_bps / 10_000;

      if (deviationPct >= deviationThreshold) {
        return {
          breached: true,
          breachType: "oracle_deviation",
          reason: `Oracle deviation ${(deviationPct * 100).toFixed(2)}% >= policy threshold ${(deviationThreshold * 100).toFixed(2)}%`,
          currentPriceNormalized: currentPriceNorm,
          oracleDeviationPct: deviationPct,
        };
      }
    }
  }

  return {
    breached: false,
    reason: `No breach — drawdown ${(drawdownPct * 100).toFixed(2)}% below ${(drawdownThreshold * 100).toFixed(2)}% threshold`,
    entryPriceNormalized: entryPriceNorm,
    currentPriceNormalized: currentPriceNorm,
    drawdownPct,
  };
}
