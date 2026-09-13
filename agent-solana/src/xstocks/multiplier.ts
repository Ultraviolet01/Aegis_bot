import { CorporateAction } from "./client";

/**
 * Normalise a raw token price using the asset's current multiplier.
 *
 * xStocks tokens never change their raw on-chain count — only the multiplier
 * changes on splits/dividends. A 4-for-1 split quadruples the multiplier, so
 * the share-equivalent price of 1 raw token also quadruples.
 *
 * Without this, a split looks mathematically identical to a crash to a naive
 * price-only agent — this function ensures drawdown is calculated against the
 * SHARE-EQUIVALENT value, not the raw token price.
 *
 * @param rawPriceUsd  The priceUsd field from the xStocks Oracles API.
 * @param multiplier   The current multiplier from the same API response.
 * @returns            The share-equivalent price (what 1 "adjusted share" is worth in USD).
 */
export function normalizePrice(rawPriceUsd: number, multiplier: number): number {
  if (multiplier <= 0) throw new Error("Multiplier must be positive");
  return rawPriceUsd * multiplier;
}

/**
 * Check if we are currently within the "corporate action window" —
 * the period between when xStocks PUBLISHES the new multiplier on-chain
 * and when it ACTIVATES (00:30 UTC the day after ex-date).
 *
 * During this window, the agent should SUSPEND risk triggers proactively,
 * not just interpret them correctly after the fact. A legitimate split
 * publishing its new multiplier can transiently look like unusual price
 * movement before the activation timestamp is reached.
 *
 * Per §6: "the multiplier is PUBLISHED ON-CHAIN before activation" —
 * we have real lead time here, not a race condition.
 *
 * @param actions     The full corporate action list for this mint.
 * @param nowMs       Current time in milliseconds (defaults to Date.now()).
 * @param windowMs    How far ahead of activationTime to start suspending (default: 2 hours).
 * @returns           True if risk triggers should be suppressed.
 */
export function isInCorporateActionWindow(
  actions: CorporateAction[],
  nowMs: number = Date.now(),
  windowMs: number = 2 * 60 * 60 * 1000 // 2 hours
): boolean {
  const nowSec = nowMs / 1000;
  for (const action of actions) {
    if (action.applied) continue; // already activated, normal operation resumes
    const activationSec = action.activationTime;
    const windowStartSec = activationSec - windowMs / 1000;
    if (nowSec >= windowStartSec && nowSec < activationSec) {
      return true;
    }
  }
  return false;
}

/**
 * Baseline threshold: relative changes < 5% are classified as dividends.
 * Regular quarterly equity dividends rarely exceed 1-2%, while stock splits
 * are almost always >= 10% (e.g. 5:4, 4:3, 2:1).
 */
export const DIVIDEND_THRESHOLD = 0.05;

/**
 * Review band width (+/- 2 percentage points around the 5% threshold).
 * Relative changes between 3% and 7% (0.03 <= pctChange <= 0.07) fall in the ambiguous
 * borderline zone where a large special dividend or a small micro-split could overlap.
 * In this zone, needsReview is set to true for UI transparency.
 */
export const REVIEW_BAND = 0.02;

export interface ActionClassification {
  actionType: "split" | "dividend" | "reverse_split";
  needsReview: boolean;
  pctChange: number;
}

/**
 * Classifies a corporate action based on multiplier magnitude, flagging ambiguous
 * borderline cases (3% - 7%) with needsReview: true without blocking risk calculations.
 */
export function classifyCorporateAction(
  oldMultiplier: number,
  newMultiplier: number
): ActionClassification {
  const pctChange = Math.abs((newMultiplier - oldMultiplier) / oldMultiplier);
  const minReview = DIVIDEND_THRESHOLD - REVIEW_BAND; // 0.03 (3%)
  const maxReview = DIVIDEND_THRESHOLD + REVIEW_BAND; // 0.07 (7%)
  const EPSILON = 1e-7;

  const needsReview =
    pctChange >= minReview - EPSILON && pctChange <= maxReview + EPSILON;

  let actionType: "split" | "dividend" | "reverse_split";
  if (pctChange < DIVIDEND_THRESHOLD) {
    actionType = "dividend";
  } else if (newMultiplier > oldMultiplier) {
    actionType = "split";
  } else {
    actionType = "reverse_split";
  }

  return { actionType, needsReview, pctChange };
}

/**
 * Get the most recent pending corporate action for this mint, if any.
 * Returns undefined if there is no upcoming action.
 */
export function getPendingAction(
  actions: CorporateAction[]
): CorporateAction | undefined {
  const now = Date.now() / 1000;
  return actions
    .filter((a) => !a.applied && a.activationTime > now)
    .sort((a, b) => a.activationTime - b.activationTime)[0];
}

