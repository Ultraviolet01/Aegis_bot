import { getTargetMint, SUPPORTED_TARGET_MINTS, PolicyParser } from "../../src/policy/parser";

describe("PolicyParser — Multi-Asset Exit Support", () => {
  it("resolves correct target mints across clusters", () => {
    // USDC
    expect(getTargetMint("USDC", "mainnet")).toBe(SUPPORTED_TARGET_MINTS.mainnet.USDC);
    expect(getTargetMint("USDC", "devnet")).toBe(SUPPORTED_TARGET_MINTS.devnet.USDC);

    // SOL (WSOL)
    expect(getTargetMint("SOL", "mainnet")).toBe("So11111111111111111111111111111111111111112");
    expect(getTargetMint("SOL", "devnet")).toBe("So11111111111111111111111111111111111111112");

    // USDT
    expect(getTargetMint("USDT", "mainnet")).toBe("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
    expect(getTargetMint("USDT", "devnet")).toBe("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
  });

  it("formats preview with target asset", () => {
    const preview = PolicyParser.formatPreview({
      drawdown_bps: 800,
      oracle_deviation_bps: 200,
      exit_bps: 7500,
      max_slippage_bps: 50,
      target_asset: "SOL",
    });

    expect(preview).toContain("Target exit asset:   SOL");
    expect(preview).toContain("Drawdown trigger:    8%");
    expect(preview).toContain("Max exit per breach: 75%");
  });

  it("defaults to USDC when target asset is USDC", () => {
    const preview = PolicyParser.formatPreview({
      drawdown_bps: 500,
      oracle_deviation_bps: 100,
      exit_bps: 5000,
      max_slippage_bps: 30,
      target_asset: "USDC",
    });

    expect(preview).toContain("Target exit asset:   USDC");
  });
});
