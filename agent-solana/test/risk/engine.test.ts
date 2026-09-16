import { assessPosition } from "../../src/risk/engine";
import { CorporateAction } from "../../src/xstocks/client";

const BASE_POLICY = {
  drawdown_bps: 800,        // 8%
  oracle_deviation_bps: 200, // 2%
  exit_bps: 7500,           // 75%
  max_slippage_bps: 50,     // 0.5%
};

describe("Risk Engine — assessPosition", () => {

  // ── No breach ──────────────────────────────────────────────────────────────

  it("returns no breach when price is stable", () => {
    const result = assessPosition({
      policy: BASE_POLICY,
      entryPriceRaw: 100,
      entryMultiplier: 1.0,
      currentPriceRaw: 97,   // 3% drop, below 8% threshold
      currentMultiplier: 1.0,
      previousPriceRaw: 98,
      previousMultiplier: 1.0,
      corporateActions: [],
    });
    expect(result.breached).toBe(false);
    expect(result.drawdownPct).toBeCloseTo(0.03);
  });

  // ── Drawdown breach ────────────────────────────────────────────────────────

  it("triggers drawdown breach at exactly the threshold", () => {
    const result = assessPosition({
      policy: BASE_POLICY,
      entryPriceRaw: 100,
      entryMultiplier: 1.0,
      currentPriceRaw: 92,   // exactly 8% drop
      currentMultiplier: 1.0,
      previousPriceRaw: 95,
      previousMultiplier: 1.0,
      corporateActions: [],
    });
    expect(result.breached).toBe(true);
    expect(result.breachType).toBe("drawdown");
  });

  it("does not trigger drawdown breach at one cent below threshold", () => {
    const result = assessPosition({
      policy: BASE_POLICY,
      entryPriceRaw: 100,
      entryMultiplier: 1.0,
      currentPriceRaw: 92.01, // 7.99% drop — just below 8% threshold
      currentMultiplier: 1.0,
      previousPriceRaw: 92.00, // close to current — oracle deviation stays minimal
      previousMultiplier: 1.0,
      corporateActions: [],
    });
    expect(result.breached).toBe(false);
  });

  // ── Oracle deviation breach ────────────────────────────────────────────────

  it("triggers oracle deviation breach when consecutive-poll jump >= threshold", () => {
    const result = assessPosition({
      policy: BASE_POLICY,
      entryPriceRaw: 100,
      entryMultiplier: 1.0,
      currentPriceRaw: 97,
      currentMultiplier: 1.0,
      previousPriceRaw: 100,  // 3% drop from previous poll >= 2% threshold
      previousMultiplier: 1.0,
      corporateActions: [],
    });
    expect(result.breached).toBe(true);
    expect(result.breachType).toBe("oracle_deviation");
  });

  // ── CORE INVARIANT: splits must NOT trigger drawdown ──────────────────────

  it("INVARIANT: 4-for-1 split does NOT trigger a breach (multiplier normalisation)", () => {
    // Scenario: stock was at $100 with multiplier 1.0.
    // After a 4-for-1 split: multiplier becomes 4.0, raw price becomes ~$25.
    // The share-equivalent price is still ~$100 — no breach.
    const result = assessPosition({
      policy: BASE_POLICY,
      entryPriceRaw: 100,
      entryMultiplier: 1.0,     // entry: 1 token = $100 (1 share = $100)
      currentPriceRaw: 25,      // after split: raw token price is $25
      currentMultiplier: 4.0,   // but multiplier is now 4x
      previousPriceRaw: 100,
      previousMultiplier: 1.0,
      corporateActions: [],
    });
    // normalizedEntry = $100 × 1.0 = $100
    // normalizedCurrent = $25 × 4.0 = $100
    // drawdown = 0% — no breach
    expect(result.breached).toBe(false);
    expect(result.currentPriceNormalized).toBeCloseTo(100);
    expect(result.entryPriceNormalized).toBeCloseTo(100);
  });

  it("INVARIANT: actual 8% crash after a split DOES trigger a breach", () => {
    // After the split, the stock actually drops 8% in share-equivalent terms
    const result = assessPosition({
      policy: BASE_POLICY,
      entryPriceRaw: 100,
      entryMultiplier: 1.0,   // entry: $100/share
      currentPriceRaw: 23,    // $23 × 4 = $92/share = 8% actual drop
      currentMultiplier: 4.0,
      previousPriceRaw: 25,
      previousMultiplier: 4.0,
      corporateActions: [],
    });
    expect(result.breached).toBe(true);
    expect(result.breachType).toBe("drawdown");
    expect(result.currentPriceNormalized).toBeCloseTo(92);
  });

  // ── Corporate action window suspension ────────────────────────────────────

  it("suspends risk triggers in the corporate action window", () => {
    const nowMs = Date.now();
    const activationTime = nowMs / 1000 + 3600; // activates in 1 hour

    const pendingAction: CorporateAction = {
      mint: "some-mint",
      symbol: "SPYX",
      actionType: "split",
      newMultiplier: 4.0,
      oldMultiplier: 1.0,
      exDate: new Date().toISOString(),
      activationTime,
      applied: false,
    };

    const result = assessPosition({
      policy: BASE_POLICY,
      entryPriceRaw: 100,
      entryMultiplier: 1.0,
      currentPriceRaw: 85,   // Would normally trigger an 8%+ breach...
      currentMultiplier: 1.0,
      previousPriceRaw: 100,
      previousMultiplier: 1.0,
      corporateActions: [pendingAction],
      nowMs,
    });
    // ...but the corporate action window suspends all triggers
    expect(result.breached).toBe(false);
    expect(result.corporateActionSuspension).toBe(true);
  });

  it("does NOT suspend after the activation time has passed", () => {
    const nowMs = Date.now();
    const activationTime = nowMs / 1000 - 60; // activated 1 minute ago

    const appliedAction: CorporateAction = {
      mint: "some-mint",
      symbol: "SPYX",
      actionType: "split",
      newMultiplier: 4.0,
      oldMultiplier: 1.0,
      exDate: new Date().toISOString(),
      activationTime,
      applied: true, // already applied
    };

    const result = assessPosition({
      policy: BASE_POLICY,
      entryPriceRaw: 100,
      entryMultiplier: 1.0,
      currentPriceRaw: 85,   // 8%+ breach should now fire
      currentMultiplier: 1.0,
      previousPriceRaw: 100,
      previousMultiplier: 1.0,
      corporateActions: [appliedAction],
      nowMs,
    });
    expect(result.corporateActionSuspension).toBeFalsy();
    expect(result.breached).toBe(true);
  });
});
