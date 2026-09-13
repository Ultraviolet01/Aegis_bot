import {
  normalizePrice,
  isInCorporateActionWindow,
  getPendingAction,
  classifyCorporateAction,
  DIVIDEND_THRESHOLD,
  REVIEW_BAND,
} from "../../src/xstocks/multiplier";
import { CorporateAction } from "../../src/xstocks/client";

describe("normalizePrice", () => {
  it("returns raw price when multiplier is 1.0", () => {
    expect(normalizePrice(100, 1.0)).toBeCloseTo(100);
  });

  it("scales correctly for a 4-for-1 split (multiplier 4.0)", () => {
    // Raw token price dropped to $25, but share-equivalent is still $100
    expect(normalizePrice(25, 4.0)).toBeCloseTo(100);
  });

  it("scales correctly for a reverse split (multiplier 0.5)", () => {
    expect(normalizePrice(200, 0.5)).toBeCloseTo(100);
  });

  it("throws on zero or negative multiplier", () => {
    expect(() => normalizePrice(100, 0)).toThrow();
    expect(() => normalizePrice(100, -1)).toThrow();
  });

  it("produces identical output regardless of needsReview flag (risk engine invariant)", () => {
    // A 4% change in multiplier (e.g. 1.0 -> 1.04) triggers needsReview = true in classification
    const classification = classifyCorporateAction(1.0, 1.04);
    expect(classification.needsReview).toBe(true);

    // Regardless of classification.needsReview, normalizePrice executes identical arithmetic
    const normalizedWithoutFlag = normalizePrice(500, 1.04);
    const normalizedWithFlag = normalizePrice(500, 1.04);
    expect(normalizedWithFlag).toBe(normalizedWithoutFlag);
    expect(normalizedWithFlag).toBeCloseTo(520);
  });
});

describe("isInCorporateActionWindow", () => {
  const makeAction = (offsetSec: number, applied = false): CorporateAction => ({
    mint: "mint",
    symbol: "SPYX",
    actionType: "split",
    newMultiplier: 4.0,
    oldMultiplier: 1.0,
    exDate: new Date().toISOString(),
    activationTime: Date.now() / 1000 + offsetSec,
    applied,
  });

  it("returns false when no actions", () => {
    expect(isInCorporateActionWindow([])).toBe(false);
  });

  it("returns true when activation is within the 2h window", () => {
    const action = makeAction(3600); // activates in 1h (within 2h window)
    expect(isInCorporateActionWindow([action], Date.now())).toBe(true);
  });

  it("returns false when activation is more than 2h away", () => {
    const action = makeAction(10800); // activates in 3h (outside 2h window)
    expect(isInCorporateActionWindow([action], Date.now())).toBe(false);
  });

  it("returns false for already-applied actions", () => {
    const action = makeAction(3600, true); // applied=true
    expect(isInCorporateActionWindow([action], Date.now())).toBe(false);
  });

  it("returns false when activation has passed", () => {
    const action = makeAction(-60); // activated 1 minute ago (not applied yet but past)
    // activationTime is in the past → nowSec >= activationSec so condition fails
    expect(isInCorporateActionWindow([action], Date.now())).toBe(false);
  });
});

describe("classifyCorporateAction & review band boundary tests", () => {
  it("verifies the configured threshold and review band constants", () => {
    expect(DIVIDEND_THRESHOLD).toBe(0.05); // 5% baseline
    expect(REVIEW_BAND).toBe(0.02);        // +/- 2% band (3% - 7% ambiguous zone)
  });

  describe("inside the review band (3% - 7%)", () => {
    it("flags a synthetic 4% increase as dividend with needsReview: true", () => {
      // 1.0 -> 1.04 is 4.0% change (falls in [0.03, 0.07], < 0.05 threshold)
      const res = classifyCorporateAction(1.0, 1.04);
      expect(res.pctChange).toBeCloseTo(0.04);
      expect(res.actionType).toBe("dividend");
      expect(res.needsReview).toBe(true);
    });

    it("flags a synthetic 6% increase as split with needsReview: true", () => {
      // 1.0 -> 1.06 is 6.0% change (falls in [0.03, 0.07], >= 0.05 threshold)
      const res = classifyCorporateAction(1.0, 1.06);
      expect(res.pctChange).toBeCloseTo(0.06);
      expect(res.actionType).toBe("split");
      expect(res.needsReview).toBe(true);
    });

    it("flags a synthetic 4% decrease as dividend with needsReview: true", () => {
      // 1.0 -> 0.96 is 4.0% change (< 0.05 threshold)
      const res = classifyCorporateAction(1.0, 0.96);
      expect(res.pctChange).toBeCloseTo(0.04);
      expect(res.actionType).toBe("dividend");
      expect(res.needsReview).toBe(true);
    });

    it("flags a synthetic 6% decrease as reverse_split with needsReview: true", () => {
      // 1.0 -> 0.94 is 6.0% change (>= 0.05 threshold and new < old)
      const res = classifyCorporateAction(1.0, 0.94);
      expect(res.pctChange).toBeCloseTo(0.06);
      expect(res.actionType).toBe("reverse_split");
      expect(res.needsReview).toBe(true);
    });
  });

  describe("boundary tests at the exact edges", () => {
    it("includes exact lower boundary at 3% (needsReview: true)", () => {
      // 1.0 -> 1.03 is 3.0% change
      const res = classifyCorporateAction(1.0, 1.03);
      expect(res.pctChange).toBeCloseTo(0.03);
      expect(res.needsReview).toBe(true);
      expect(res.actionType).toBe("dividend");
    });

    it("excludes just below lower boundary at 2.9% (needsReview: false)", () => {
      // 1.0 -> 1.029 is 2.9% change
      const res = classifyCorporateAction(1.0, 1.029);
      expect(res.pctChange).toBeCloseTo(0.029);
      expect(res.needsReview).toBe(false);
      expect(res.actionType).toBe("dividend");
    });

    it("includes exact upper boundary at 7% (needsReview: true)", () => {
      // 1.0 -> 1.07 is 7.0% change
      const res = classifyCorporateAction(1.0, 1.07);
      expect(res.pctChange).toBeCloseTo(0.07);
      expect(res.needsReview).toBe(true);
      expect(res.actionType).toBe("split");
    });

    it("excludes just above upper boundary at 7.1% (needsReview: false)", () => {
      // 1.0 -> 1.071 is 7.1% change
      const res = classifyCorporateAction(1.0, 1.071);
      expect(res.pctChange).toBeCloseTo(0.071);
      expect(res.needsReview).toBe(false);
      expect(res.actionType).toBe("split");
    });
  });

  describe("outside the review band (clear-cut cases)", () => {
    it("marks clear dividend on lower side (2% change) as needsReview: false", () => {
      // 1.0 -> 1.02 is 2.0% change (< 3%)
      const res = classifyCorporateAction(1.0, 1.02);
      expect(res.pctChange).toBeCloseTo(0.02);
      expect(res.actionType).toBe("dividend");
      expect(res.needsReview).toBe(false);
    });

    it("marks real SPYx dividend (~0.18% change) as dividend with needsReview: false", () => {
      // Real SPYx on-chain values: 1.003909 -> 1.005714
      const res = classifyCorporateAction(1.003909068037305, 1.0057144820876402);
      expect(res.pctChange).toBeLessThan(0.01);
      expect(res.actionType).toBe("dividend");
      expect(res.needsReview).toBe(false);
    });

    it("marks clear split on upper side (8% change) as needsReview: false", () => {
      // 1.0 -> 1.08 is 8.0% change (> 7%)
      const res = classifyCorporateAction(1.0, 1.08);
      expect(res.pctChange).toBeCloseTo(0.08);
      expect(res.actionType).toBe("split");
      expect(res.needsReview).toBe(false);
    });

    it("marks classic 4:1 split as split with needsReview: false", () => {
      // 1.0 -> 4.0 is 300% change
      const res = classifyCorporateAction(1.0, 4.0);
      expect(res.actionType).toBe("split");
      expect(res.needsReview).toBe(false);
    });

    it("marks classic 1:2 reverse split as reverse_split with needsReview: false", () => {
      // 1.0 -> 0.5 is 50% decrease
      const res = classifyCorporateAction(1.0, 0.5);
      expect(res.actionType).toBe("reverse_split");
      expect(res.needsReview).toBe(false);
    });
  });
});

