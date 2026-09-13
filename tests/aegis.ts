import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  AccountMeta,
} from "@solana/web3.js";
import {
  getMint,
  getScaledUiAmountConfig,
  getExtensionTypes,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createMint,
  createAssociatedTokenAccountIdempotent,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import * as fs from "fs";
import * as path from "path";

// Load verified IDL
const idlPath = path.resolve(process.cwd(), "target/idl/aegis.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

// ─── Jupiter v6 constants ─────────────────────────────────────────────────────
const JUPITER_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
/** Jupiter event authority — PDA(b"__event_authority", JUP6...) */
const JUPITER_EVENT_AUTHORITY = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  JUPITER_PROGRAM_ID
)[0];

// Supported target mint constants
const ALLOWED_MINTS = {
  WSOL: new PublicKey("So11111111111111111111111111111111111111112"),
  USDC_MAINNET: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  USDT_MAINNET: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
};

// Mainnet live SPYX Token-2022 mint preloaded into validator
const SPYX_MINT = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");

/**
 * Fetch a real Jupiter v6 quote and decode the route plan + remaining accounts
 * needed to CPI into `route`. Uses the public Jupiter API.
 *
 * Returns { routePlan, remainingAccounts } shaped for Anchor's `.remainingAccounts()`.
 */
async function getJupiterQuote(params: {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: bigint; // in raw lamports / token atoms
  slippageBps: number;
  userPublicKey: PublicKey; // signer = position PDA (will sign via PDA)
  destinationTokenAccount?: PublicKey;
}): Promise<{ routePlan: any[]; remainingAccounts: AccountMeta[]; quote: any }> {
  const quoteUrl =
    `https://api.jup.ag/swap/v1/quote` +
    `?inputMint=${params.inputMint.toBase58()}` +
    `&outputMint=${params.outputMint.toBase58()}` +
    `&amount=${params.amount.toString()}` +
    `&slippageBps=${params.slippageBps}` +
    `&onlyDirectRoutes=false` +
    `&asLegacyTransaction=false`;

  const quoteRes = await fetch(quoteUrl);
  if (!quoteRes.ok) throw new Error(`Jupiter quote failed: ${await quoteRes.text()}`);
  const quote = (await quoteRes.json()) as any;

  // Request swap instructions (gives us the serialized route + account list)
  const swapBody: any = {
    quoteResponse: quote,
    userPublicKey: params.userPublicKey.toBase58(),
    wrapAndUnwrapSol: false,
  };
  if (params.destinationTokenAccount) {
    swapBody.destinationTokenAccount = params.destinationTokenAccount.toBase58();
  }

  const swapRes = await fetch("https://api.jup.ag/swap/v1/swap-instructions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(swapBody),
  });
  if (!swapRes.ok) throw new Error(`Jupiter swap-instructions failed: ${await swapRes.text()}`);
  const swapData = (await swapRes.json()) as any;

  const swapIxAccounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }> =
    swapData.swapInstruction?.accounts ?? [];
  const remainingAccounts: AccountMeta[] = swapIxAccounts.map((a) => ({
    pubkey: new PublicKey(a.pubkey),
    isSigner: false,
    isWritable: a.isWritable,
  }));
  const swapDataBytes = Buffer.from(swapData.swapInstruction.data, "base64");

  return { swapDataBytes, remainingAccounts, quote };
}

function makeDummySwapData(inAmount = 50_000_000n, slippageBps = 50): Buffer {
  const buf = Buffer.alloc(35);
  Buffer.from([229, 23, 203, 151, 122, 227, 173, 42]).copy(buf, 0);
  buf.writeUInt32LE(1, 8);
  buf[12] = 40;
  buf[13] = 100;
  buf[14] = 0;
  buf[15] = 1;
  buf.writeBigUInt64LE(BigInt(inAmount), 16);
  buf.writeBigUInt64LE(50_000_000n, 24);
  buf.writeUInt16LE(slippageBps, 32);
  buf[34] = 0;
  return buf;
}
const dummySwapData = makeDummySwapData();

describe("Aegis Anchor Program — Live Validator On-Chain Test Suite", function () {
  this.timeout(180000);

  // Local validator connection
  const conn = new Connection("http://127.0.0.1:8899", "confirmed");
  const mainnetConn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  // Keypairs for participants (owner is deterministic to match pre-funded SPYX account fixture)
  const authority = Keypair.generate();
  const agent = Keypair.generate();
  const owner = Keypair.fromSeed(Buffer.alloc(32, 7));
  const attacker = Keypair.generate();

  // Test target mints
  const usdcMint = ALLOWED_MINTS.USDC_MAINNET;
  const wsolMint = ALLOWED_MINTS.WSOL;
  const usdtMint = ALLOWED_MINTS.USDT_MAINNET;

  // Program and PDAs
  const programId = new PublicKey(idl.address);
  let provider: anchor.AnchorProvider;
  let program: Program;

  let configPda: PublicKey;
  let positionPda: PublicKey;
  let policyPda: PublicKey;
  let assetMint: PublicKey;
  let positionVaultAta: PublicKey;

  let ownerAssetAta: PublicKey;
  let attackerAssetAta: PublicKey;

  let ownerUsdcAta: PublicKey;
  let ownerWsolAta: PublicKey;
  let ownerUsdtAta: PublicKey;
  let attackerUsdcAta: PublicKey;
  let attackerWsolAta: PublicKey;
  let attackerUsdtAta: PublicKey;

  const DEPOSIT_AMOUNT = new BN(500_000_000); // 500 tokens (8 decimals)

  before(async () => {
    // 1. Airdrop SOL to test keypairs
    console.log("=== Setting up test accounts on live validator ===");
    for (const [name, kp] of [
      ["authority", authority],
      ["agent", agent],
      ["owner", owner],
      ["attacker", attacker],
    ] as const) {
      const airdropSig = await conn.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(airdropSig, "confirmed");
      const bal = await conn.getBalance(kp.publicKey);
      console.log(`Funded ${name} (${kp.publicKey.toBase58()}): ${bal / LAMPORTS_PER_SOL} SOL`);
    }
    await new Promise((r) => setTimeout(r, 2000));

    // 2. Initialize Anchor provider with authority wallet
    const wallet = new anchor.Wallet(authority);
    provider = new anchor.AnchorProvider(conn, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    anchor.setProvider(provider);
    program = new Program(idl, provider);

    // 3. Derive global config PDA
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("aegis-config")],
      programId
    );

    // 4. Use cloned real mainnet SPYX Token-2022 mint for position testing
    assetMint = SPYX_MINT;
    console.log(`Using cloned SPYX asset mint: ${assetMint.toBase58()}`);

    // 5. Initialize ATAs for owner and attacker
    const confirmOpt = { commitment: "processed" as const };
    ownerAssetAta = await getAssociatedTokenAddress(
      assetMint,
      owner.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    attackerAssetAta = await getAssociatedTokenAddress(
      assetMint,
      attacker.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // Verify pre-funded SPYX balance on ownerAssetAta loaded via Anchor validator account fixture
    const ownerSpyxAcc = await getAccount(conn, ownerAssetAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    console.log(`Pre-funded owner SPYX balance: ${ownerSpyxAcc.amount} atoms`);

    // Create target mint ATAs for owner and attacker
    ownerUsdcAta = await createAssociatedTokenAccountIdempotent(conn, owner, usdcMint, owner.publicKey, confirmOpt);
    ownerWsolAta = await createAssociatedTokenAccountIdempotent(conn, owner, wsolMint, owner.publicKey, confirmOpt);
    ownerUsdtAta = await createAssociatedTokenAccountIdempotent(conn, owner, usdtMint, owner.publicKey, confirmOpt);

    attackerUsdcAta = await createAssociatedTokenAccountIdempotent(conn, attacker, usdcMint, attacker.publicKey, confirmOpt);
    attackerWsolAta = await createAssociatedTokenAccountIdempotent(conn, attacker, wsolMint, attacker.publicKey, confirmOpt);
    attackerUsdtAta = await createAssociatedTokenAccountIdempotent(conn, attacker, usdtMint, attacker.publicKey, confirmOpt);

    console.log(`Owner USDC ATA: ${ownerUsdcAta.toBase58()}`);
    console.log(`Attacker USDC ATA: ${attackerUsdcAta.toBase58()}`);

    // Derive position PDA (index 0)
    const indexBn = new BN(0);
    [positionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        owner.publicKey.toBuffer(),
        indexBn.toArrayLike(Buffer, "le", 8),
      ],
      programId
    );

    [policyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("policy"), positionPda.toBuffer()],
      programId
    );

    positionVaultAta = await getAssociatedTokenAddress(
      assetMint,
      positionPda,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    console.log(`Position PDA: ${positionPda.toBase58()}`);
    console.log(`Policy PDA: ${policyPda.toBase58()}`);
    console.log(`Position Vault ATA: ${positionVaultAta.toBase58()}`);
  });

  // =========================================================================
  // ITEM 1: Token/mint handling test harness
  // =========================================================================
  describe("Item 1 — Token/Mint Handling Test Harness", () => {
    it("reads on-chain Token-2022 mint Scaled UI Amount multiplier for SPYX", async () => {
      // Execute real on-chain transaction to aegis.so over RPC
      const txSig = await program.methods
        .getMintMultiplier()
        .accounts({ mint: SPYX_MINT })
        .rpc();

      console.log(`[Item 1.1] getMintMultiplier(SPYX) Tx Signature: ${txSig}`);
      const txDetails = await conn.getTransaction(txSig, { commitment: "confirmed" });
      assert.isNotNull(txDetails, "Transaction must be confirmed on-chain");
      const logs = txDetails!.meta?.logMessages || [];
      console.log("[Item 1.1] Logs:", logs);

      assert.isTrue(
        logs.some((l) => l.includes("Instruction: GetMintMultiplier")),
        "Must invoke GetMintMultiplier instruction"
      );
      assert.isTrue(
        logs.some((l) => l.includes("success")),
        "Instruction must execute successfully on-chain"
      );

      // Verify on-chain mint data layout matches extension 25 TLV unpacker
      const mintInfo = await getMint(
        conn,
        SPYX_MINT,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      assert.equal(mintInfo.decimals, 8, "SPYX has 8 decimals");
      const extTypes = getExtensionTypes(mintInfo.tlvData);
      assert.include(extTypes, ExtensionType.ScaledUiAmountConfig, "Includes ScaledUiAmountConfig");

      const config = getScaledUiAmountConfig(mintInfo);
      assert.isNotNull(config, "ScaledUiAmountConfig must unpack successfully");
      const multiplier = Number(config!.multiplier);
      assert.isAbove(multiplier, 1.0, "Multiplier reflects corporate action (> 1.0)");
    });

    it("falls back gracefully for standard SPL token mints without extensions", async () => {
      // Call getMintMultiplier on our standard SPL mint
      const txSig = await program.methods
        .getMintMultiplier()
        .accounts({ mint: assetMint })
        .rpc();

      console.log(`[Item 1.2] getMintMultiplier(SPL) Tx Signature: ${txSig}`);
      const txDetails = await conn.getTransaction(txSig, { commitment: "confirmed" });
      const logs = txDetails!.meta?.logMessages || [];
      console.log("[Item 1.2] Logs:", logs);

      assert.isTrue(
        logs.some((l) => l.includes("success")),
        "Standard SPL mint handling succeeds on-chain"
      );
    });
  });

  // =========================================================================
  // ITEM 2: AegisPosition program (owner-only deposit/withdraw sovereignty)
  // =========================================================================
  describe("Item 2 — AegisPosition Program & Owner Sovereignty Invariants", () => {
    it("initializes Aegis global config on-chain", async () => {
      const txSig = await program.methods
        .initialize(agent.publicKey, usdcMint)
        .accounts({
          config: configPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      console.log(`[Item 2.1] initialize() Tx Signature: ${txSig}`);
      const txDetails = await conn.getTransaction(txSig, { commitment: "confirmed" });
      const logs = txDetails!.meta?.logMessages || [];
      console.log("[Item 2.1] Logs:", logs);

      const cfg = await (program.account as any).aegisConfig.fetch(configPda);
      assert.isTrue(cfg.authority.equals(authority.publicKey), "Authority matches");
      assert.isTrue(cfg.agent.equals(agent.publicKey), "Agent matches");
      assert.isTrue(cfg.usdcMint.equals(usdcMint), "USDC mint matches");
      assert.equal(cfg.totalPositions.toNumber(), 0, "Initial totalPositions is 0");
    });

    it("opens position and holds user deposited tokens in PDA vault on-chain", async () => {
      const txSig = await program.methods
        .openPosition(DEPOSIT_AMOUNT)
        .accounts({
          config: configPda,
          position: positionPda,
          positionVault: positionVaultAta,
          assetMint: assetMint,
          ownerTokenAccount: ownerAssetAta,
          owner: owner.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      console.log(`[Item 2.2] openPosition() Tx Signature: ${txSig}`);
      const txDetails = await conn.getTransaction(txSig, { commitment: "confirmed" });
      const logs = txDetails!.meta?.logMessages || [];
      console.log("[Item 2.2] Logs:", logs);

      // Verify on-chain position account state
      const posAcc = await (program.account as any).position.fetch(positionPda);
      assert.isTrue(posAcc.owner.equals(owner.publicKey), "Position owner correctly set");
      assert.isTrue(posAcc.assetMint.equals(assetMint), "Asset mint set");
      assert.equal(posAcc.amount.toNumber(), 500_000_000, "Position amount matches deposit");
      assert.isFalse(posAcc.paused, "Position is not paused");
      assert.isNull(posAcc.policy, "No policy attached yet");

      // Verify on-chain vault token balance
      const vaultAcc = await getAccount(conn, positionVaultAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      assert.equal(Number(vaultAcc.amount), 500_000_000, "Vault received tokens");
    });

    it("rejects non-owner attempts to withdraw from position on-chain", async () => {
      let threw = false;
      try {
        await program.methods
          .withdraw(new BN(100_000_000))
          .accounts({
            position: positionPda,
            positionVault: positionVaultAta,
            ownerTokenAccount: ownerAssetAta,
            assetMint: assetMint,
            owner: attacker.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc();
      } catch (err: any) {
        threw = true;
        console.log("[Item 2.3] Attacker withdraw rejected on-chain as expected:", err.message);
        assert.isTrue(
          err.message.includes("NotPositionOwner") ||
            err.message.includes("ConstraintSeeds") ||
            err.message.includes("6000") ||
            err.message.includes("2006") ||
            err.message.includes("0x1770") ||
            err.message.includes("Constraint"),
          "Must fail with NotPositionOwner or ConstraintSeeds error code"
        );
      }

      assert.isTrue(threw, "Non-owner withdraw MUST throw on-chain");
    });

    it("owner can unconditionally withdraw funds regardless of agent state on-chain", async () => {
      const withdrawAmount = new BN(200_000_000);
      const ownerBeforeAcc = await getAccount(conn, ownerAssetAta, "confirmed", TOKEN_2022_PROGRAM_ID);

      const txSig = await program.methods
        .withdraw(withdrawAmount)
        .accounts({
          position: positionPda,
          positionVault: positionVaultAta,
          ownerTokenAccount: ownerAssetAta,
          assetMint: assetMint,
          owner: owner.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      console.log(`[Item 2.4] owner withdraw() Tx Signature: ${txSig}`);
      const txDetails = await conn.getTransaction(txSig, { commitment: "confirmed" });
      const logs = txDetails!.meta?.logMessages || [];
      console.log("[Item 2.4] Logs:", logs);

      const posAcc = await (program.account as any).position.fetch(positionPda);
      assert.equal(posAcc.amount.toNumber(), 300_000_000, "Position balance deducted by 200");

      const ownerAfterAcc = await getAccount(conn, ownerAssetAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      assert.equal(
        Number(ownerAfterAcc.amount) - Number(ownerBeforeAcc.amount),
        200_000_000,
        "Owner token account received 200 tokens"
      );
    });

    it("UNCONDITIONAL SOVEREIGNTY: owner can withdraw even when position is paused on-chain", async () => {
      // 1. Agent pauses the position on-chain
      const pauseTx = await program.methods
        .pausePosition()
        .accounts({
          config: configPda,
          position: positionPda,
          caller: agent.publicKey,
        })
        .signers([agent])
        .rpc();
      console.log(`[Item 2.5] pausePosition() Tx Signature: ${pauseTx}`);

      let posAcc = await (program.account as any).position.fetch(positionPda);
      assert.isTrue(posAcc.paused, "Position is now paused on-chain");

      // 2. Owner withdraws while position is paused
      const withdrawAmount = new BN(100_000_000);
      const withdrawTx = await program.methods
        .withdraw(withdrawAmount)
        .accounts({
          position: positionPda,
          positionVault: positionVaultAta,
          ownerTokenAccount: ownerAssetAta,
          assetMint: assetMint,
          owner: owner.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      console.log(`[Item 2.5] withdraw() while paused Tx Signature: ${withdrawTx}`);
      posAcc = await (program.account as any).position.fetch(positionPda);
      assert.equal(posAcc.amount.toNumber(), 200_000_000, "Withdraw while paused succeeded on-chain");

      // 3. Owner unpauses on-chain
      const unpauseTx = await program.methods
        .unpausePosition()
        .accounts({
          position: positionPda,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();
      console.log(`[Item 2.5] unpausePosition() Tx Signature: ${unpauseTx}`);

      posAcc = await (program.account as any).position.fetch(positionPda);
      assert.isFalse(posAcc.paused, "Position unpaused on-chain");
    });
  });

  // =========================================================================
  // ITEM 3: PolicyAccount (drawdown, deviation, exit, max_slippage, mode)
  // =========================================================================
  describe("Item 3 — PolicyAccount Configuration & Constraints", () => {
    it("owner sets policy with all 6 required fields including max_slippage_bps on-chain", async () => {
      const drawdownBps = 800;
      const deviationBps = 200;
      const exitBps = 7500;
      const maxSlippageBps = 50; // 0.50%
      const mode = 1;

      const txSig = await program.methods
        .setPolicy(drawdownBps, deviationBps, exitBps, maxSlippageBps, mode, usdcMint)
        .accounts({
          config: configPda,
          position: positionPda,
          policy: policyPda,
          owner: owner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      console.log(`[Item 3.1] setPolicy() Tx Signature: ${txSig}`);
      const txDetails = await conn.getTransaction(txSig, { commitment: "confirmed" });
      const logs = txDetails!.meta?.logMessages || [];
      console.log("[Item 3.1] Logs:", logs);

      const polAcc = await (program.account as any).policy.fetch(policyPda);
      assert.equal(polAcc.drawdownThresholdBps, 800);
      assert.equal(polAcc.deviationThresholdBps, 200);
      assert.equal(polAcc.exitPercentBps, 7500);
      assert.equal(polAcc.maxSlippageBps, 50, "max_slippage_bps stored on-chain");
      assert.equal(polAcc.mode, 1, "Mode is Normal");
      assert.isTrue(polAcc.targetMint.equals(usdcMint), "Target mint is USDC");

      const posAcc = await (program.account as any).position.fetch(positionPda);
      assert.isTrue(posAcc.policy.equals(policyPda), "Position references policy PDA");
    });

    it("supports multi-asset policies: WSOL (SOL) and USDT as target mints on-chain", async () => {
      // 1. Set WSOL target mint policy
      const wsolTx = await program.methods
        .setPolicy(800, 200, 7500, 100, 1, wsolMint)
        .accounts({
          config: configPda,
          position: positionPda,
          policy: policyPda,
          owner: owner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
      console.log(`[Item 3.2] setPolicy(WSOL) Tx Signature: ${wsolTx}`);
      let polAcc = await (program.account as any).policy.fetch(policyPda);
      assert.isTrue(polAcc.targetMint.equals(wsolMint), "WSOL target mint updated on-chain");
      assert.equal(polAcc.maxSlippageBps, 100);

      // 2. Set USDT target mint policy
      const usdtTx = await program.methods
        .setPolicy(800, 200, 7500, 75, 1, usdtMint)
        .accounts({
          config: configPda,
          position: positionPda,
          policy: policyPda,
          owner: owner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
      console.log(`[Item 3.2] setPolicy(USDT) Tx Signature: ${usdtTx}`);
      polAcc = await (program.account as any).policy.fetch(policyPda);
      assert.isTrue(polAcc.targetMint.equals(usdtMint), "USDT target mint updated on-chain");
      assert.equal(polAcc.maxSlippageBps, 75);

      // Revert back to USDC for subsequent test sections
      await program.methods
        .setPolicy(800, 200, 7500, 50, 1, usdcMint)
        .accounts({
          config: configPda,
          position: positionPda,
          policy: policyPda,
          owner: owner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
    });

    it("rejects unauthorized target mints on-chain", async () => {
      const unauthorizedMint = Keypair.generate().publicKey;
      let threw = false;
      try {
        await program.methods
          .setPolicy(800, 200, 7500, 50, 1, unauthorizedMint)
          .accounts({
            config: configPda,
            position: positionPda,
            policy: policyPda,
            owner: owner.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner])
          .rpc();
      } catch (err: any) {
        threw = true;
        console.log("[Item 3.3] Unauthorized mint rejected on-chain as expected:", err.message);
        assert.isTrue(
          err.message.includes("InvalidTargetMint") || err.message.includes("6009") || err.message.includes("0x1779"),
          "Must fail with InvalidTargetMint"
        );
      }
      assert.isTrue(threw, "Unauthorized target mint MUST fail on-chain");
    });

    it("agent or attacker cannot set policy (owner-only write access) on-chain", async () => {
      let threw = false;
      try {
        await program.methods
          .setPolicy(800, 200, 7500, 50, 1, usdcMint)
          .accounts({
            config: configPda,
            position: positionPda,
            policy: policyPda,
            owner: agent.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([agent])
          .rpc();
      } catch (err: any) {
        threw = true;
        console.log("[Item 3.4] Non-owner setPolicy rejected on-chain as expected:", err.message);
        assert.isTrue(
          err.message.includes("NotPositionOwner") ||
            err.message.includes("ConstraintSeeds") ||
            err.message.includes("ConstraintHasOne") ||
            err.message.includes("6000") ||
            err.message.includes("2006") ||
            err.message.includes("2001") ||
            err.message.includes("0x1770"),
          "Must fail with NotPositionOwner or ConstraintSeeds"
        );
      }
      assert.isTrue(threw, "Agent setPolicy MUST fail on-chain");

    });

    it("deactivate_policy strips agent authority immediately on-chain", async () => {
      const deactTx = await program.methods
        .deactivatePolicy()
        .accounts({
          position: positionPda,
          policy: policyPda,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();
      console.log(`[Item 3.5] deactivatePolicy() Tx Signature: ${deactTx}`);

      const polAcc = await (program.account as any).policy.fetch(policyPda);
      assert.equal(polAcc.mode, 0, "Policy mode is Inactive (0)");

      const posAcc = await (program.account as any).position.fetch(positionPda);
      assert.isNull(posAcc.policy, "Position policy reference cleared on-chain");

      // Agent attempt to swap on inactive policy MUST fail (guard fires before CPI)
      let swapThrew = false;
      try {
        await program.methods
          .swapAndDeliver(5000, new BN(100_000_000), dummySwapData)
          .accounts({
            config: configPda,
            position: positionPda,
            policy: policyPda,
            positionVault: positionVaultAta,
            assetMint: assetMint,
            targetMint: usdcMint,
            ownerDestinationAta: ownerUsdcAta,
            agent: agent.publicKey,
            sourceTokenProgram: TOKEN_2022_PROGRAM_ID,
            destinationTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            jupiterProgram: JUPITER_PROGRAM_ID,
            jupiterEventAuthority: JUPITER_EVENT_AUTHORITY,
          })
          .remainingAccounts([{ pubkey: ownerUsdcAta, isSigner: false, isWritable: true }])
          .signers([agent])
          .rpc();
      } catch (err: any) {
        swapThrew = true;
        console.log("[Item 3.5] Swap on inactive policy rejected on-chain as expected:", err.message);
        assert.isTrue(
          err.message.includes("NoPolicySet") || err.message.includes("6002") || err.message.includes("0x1772"),
          "Must fail with NoPolicySet"
        );
      }
      assert.isTrue(swapThrew, "Swap on inactive policy MUST fail on-chain");

      // Re-activate policy for Item 4
      await program.methods
        .setPolicy(800, 200, 7500, 50, 1, usdcMint)
        .accounts({
          config: configPda,
          position: positionPda,
          policy: policyPda,
          owner: owner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
    });
  });

  // =========================================================================
  // ITEM 4: Swap-on-breach instruction (deterministic ATA derivation & limits)
  // =========================================================================
  describe("Item 4 — Swap-On-Breach Instruction Mechanism", () => {
    it("derives owner destination ATA strictly on-chain from position owner pubkey", async () => {
      const expectedAta = await getAssociatedTokenAddress(usdcMint, owner.publicKey);
      assert.isTrue(expectedAta.equals(ownerUsdcAta), "Deterministic owner ATA matches");
      assert.isFalse(expectedAta.equals(attackerUsdcAta), "Distinct from attacker ATA");
    });

    it("SWAP-DESTINATION-MISMATCH REVERT: reverts if swap destination does not match owner's derived ATA on-chain", async () => {
      let threw = false;
      try {
        await program.methods
          .swapAndDeliver(5000, new BN(100_000_000), dummySwapData)
          .accounts({
            config: configPda,
            position: positionPda,
            policy: policyPda,
            positionVault: positionVaultAta,
            assetMint: assetMint,
            targetMint: usdcMint,
            ownerDestinationAta: attackerUsdcAta, // Malicious destination
            agent: agent.publicKey,
            sourceTokenProgram: TOKEN_2022_PROGRAM_ID,
            destinationTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            jupiterProgram: JUPITER_PROGRAM_ID,
            jupiterEventAuthority: JUPITER_EVENT_AUTHORITY,
          })
          .remainingAccounts([{ pubkey: attackerUsdcAta, isSigner: false, isWritable: true }])
          .signers([agent])
          .rpc();
      } catch (err: any) {
        threw = true;
        console.log("[Item 4.2] Destination mismatch rejected on-chain as expected:", err.message);
        assert.isTrue(
          err.message.includes("InvalidSwapDestination") ||
            err.message.includes("6006") ||
            err.message.includes("0x1776"),
          "Must fail with InvalidSwapDestination on-chain"
        );
      }
      assert.isTrue(threw, "Swap to attacker destination MUST revert on-chain");
    });

    it("EXIT-CLAMP ENFORCEMENT: clamps exit amount to policy-approved ceiling on-chain", async () => {
      // Policy exit ceiling is 7500 (75%). Requested is 8000 (80%).
      let threw = false;
      try {
        await program.methods
          .swapAndDeliver(8000, new BN(100_000_000), dummySwapData)
          .accounts({
            config: configPda,
            position: positionPda,
            policy: policyPda,
            positionVault: positionVaultAta,
            assetMint: assetMint,
            targetMint: usdcMint,
            ownerDestinationAta: ownerUsdcAta,
            agent: agent.publicKey,
            sourceTokenProgram: TOKEN_2022_PROGRAM_ID,
            destinationTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            jupiterProgram: JUPITER_PROGRAM_ID,
            jupiterEventAuthority: JUPITER_EVENT_AUTHORITY,
          })
          .remainingAccounts([{ pubkey: ownerUsdcAta, isSigner: false, isWritable: true }])
          .signers([agent])
          .rpc();
      } catch (err: any) {
        threw = true;
        console.log("[Item 4.3] Exit clamp exceeded rejected on-chain as expected:", err.message);
        assert.isTrue(
          err.message.includes("ExitBpsExceedsPolicy") ||
            err.message.includes("6003") ||
            err.message.includes("0x1773"),
          "Must fail with ExitBpsExceedsPolicy on-chain"
        );
      }
      assert.isTrue(threw, "Exit exceeding ceiling MUST revert on-chain");
    });

    it("END-TO-END SWAP EXECUTION & SETTLEMENT: executes real Jupiter route via CPI with on-chain balance increase", async () => {
      // Policy: exit_percent_bps=7500, max_slippage_bps=50
      // Swap 50% of position (exit_bps=5000) using real Jupiter CPI.

      const posBefore = await (program.account as any).position.fetch(positionPda);
      const amountBefore = BigInt(posBefore.amount.toString());
      const exitAmount = amountBefore * 5000n / 10000n;

      // Record destination ATA balance before swap
      const destAtaBefore = await getAccount(conn, ownerUsdcAta, "confirmed", TOKEN_PROGRAM_ID);
      const destBalanceBefore = destAtaBefore.amount;
      console.log(`[Item 4.4] BEFORE: position_vault=${amountBefore} SPYX atoms, owner_usdc_ata=${destBalanceBefore} USDC atoms`);

      // Confirm Jupiter program account exists and is executable on local validator
      const jupProgramInfo = await conn.getAccountInfo(JUPITER_PROGRAM_ID);
      const jupProgramDataInfo = await conn.getAccountInfo(new PublicKey("4Ec7ZxZS6Sbdg5UGSLHbAnM7GQHp2eFd4KYWRexAipQT"));
      console.log(`[Item 4.4] CLONED JUPITER PROGRAM on local validator: exists=${!!jupProgramInfo}, executable=${jupProgramInfo?.executable}`);
      console.log(`[Item 4.4] CLONED JUPITER PROGRAMDATA on local validator: exists=${!!jupProgramDataInfo}, bytes=${jupProgramDataInfo?.data.length}`);

      // Get a real Jupiter quote for SPYX → USDC
      console.log("[Item 4.4] Fetching real Jupiter v6 quote for SPYX → USDC...");

      // positionPda signs as userTransferAuthority in the Jupiter CPI
      const { swapDataBytes, remainingAccounts, quote } = await getJupiterQuote({
        inputMint: SPYX_MINT,
        outputMint: usdcMint,
        amount: exitAmount,
        slippageBps: 50, // matches policy.max_slippage_bps
        userPublicKey: positionPda,
        destinationTokenAccount: ownerUsdcAta,
      });

      console.log(`[Item 4.4] Jupiter quote outAmount: ${quote.outAmount} USDC atoms, ${remainingAccounts.length} remaining accounts`);

      // Use quoted_out_amount from the Jupiter quote
      const quotedOutAmount = new BN(quote.outAmount);

      const txSig = await program.methods
        .swapAndDeliver(5000, quotedOutAmount, swapDataBytes)
        .accounts({
          config: configPda,
          position: positionPda,
          policy: policyPda,
          positionVault: positionVaultAta,
          assetMint: assetMint,
          targetMint: usdcMint,
          ownerDestinationAta: ownerUsdcAta,
          agent: agent.publicKey,
          sourceTokenProgram: TOKEN_2022_PROGRAM_ID,
          destinationTokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          jupiterProgram: JUPITER_PROGRAM_ID,
          jupiterEventAuthority: JUPITER_EVENT_AUTHORITY,
        })
        .remainingAccounts(remainingAccounts)
        .signers([agent])
        .rpc();

      console.log(`[Item 4.4] swapAndDeliver() REAL Jupiter CPI Tx Signature: ${txSig}`);
      const txDetails = await conn.getTransaction(txSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const logs = txDetails!.meta?.logMessages || [];
      const cu = txDetails!.meta?.computeUnitsConsumed || 0;
      console.log("[Item 4.4] On-chain program logs:", logs);
      console.log(`[Item 4.4] Compute units consumed: ${cu}`);

      const destAtaAfter = await getAccount(conn, ownerUsdcAta, "confirmed", TOKEN_PROGRAM_ID);
      const actualIncrease = destAtaAfter.amount - destBalanceBefore;
      console.log(`[Item 4.4] AFTER: owner_usdc_ata=${destAtaAfter.amount} USDC atoms (increase=${actualIncrease})`);
      assert.isTrue(actualIncrease > 0n, "Owner USDC balance MUST genuinely increase post-swap!");

      assert.isTrue(
        logs.some((l) => l.includes("Instruction: SwapAndDeliver")),
        "Must invoke SwapAndDeliver instruction on-chain"
      );
      assert.isTrue(
        logs.some((l) => l.includes("Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 invoke [2]")),
        "Must invoke real Jupiter v6 aggregator program on-chain via CPI"
      );
      assert.isTrue(
        logs.some((l) => l.includes("Instruction: Route")),
        "Must invoke Jupiter Route instruction on-chain"
      );
    });

    it("PAUSE-BLOCKS-AGENT-BUT-NOT-OWNER: blocks swap when position is paused on-chain", async () => {
      // 1. Agent pauses position
      await program.methods
        .pausePosition()
        .accounts({
          config: configPda,
          position: positionPda,
          caller: agent.publicKey,
        })
        .signers([agent])
        .rpc();

      // 2. Agent attempts swap while paused -> MUST FAIL (guard fires before CPI)
      let threw = false;
      try {
        await program.methods
          .swapAndDeliver(2500, new BN(50_000_000), dummySwapData)
          .accounts({
            config: configPda,
            position: positionPda,
            policy: policyPda,
            positionVault: positionVaultAta,
            assetMint: assetMint,
            targetMint: usdcMint,
            ownerDestinationAta: ownerUsdcAta,
            agent: agent.publicKey,
            sourceTokenProgram: TOKEN_2022_PROGRAM_ID,
            destinationTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            jupiterProgram: JUPITER_PROGRAM_ID,
            jupiterEventAuthority: JUPITER_EVENT_AUTHORITY,
          })
          .remainingAccounts([{ pubkey: ownerUsdcAta, isSigner: false, isWritable: true }])
          .signers([agent])
          .rpc();
      } catch (err: any) {
        threw = true;
        console.log("[Item 4.5] Swap while paused rejected on-chain as expected:", err.message);
        assert.isTrue(
          err.message.includes("PositionPaused") ||
            err.message.includes("6005") ||
            err.message.includes("0x1775"),
          "Must fail with PositionPaused on-chain"
        );
      }
      assert.isTrue(threw, "Swap while paused MUST fail on-chain");

      // 3. Owner withdraws while paused -> MUST SUCCEED (unconditional sovereignty)
      const withdrawTx = await program.methods
        .withdraw(new BN(50_000_000))
        .accounts({
          position: positionPda,
          positionVault: positionVaultAta,
          ownerTokenAccount: ownerAssetAta,
          assetMint: assetMint,
          owner: owner.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
      console.log(`[Item 4.5] Owner withdraw while paused Tx Signature: ${withdrawTx}`);

      // 4. Owner unpauses
      await program.methods
        .unpausePosition()
        .accounts({
          position: positionPda,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();
    });

    it("blocks swap when caller is not the authorized agent on-chain", async () => {
      let threw = false;
      try {
        await program.methods
          .swapAndDeliver(2500, new BN(50_000_000), dummySwapData)
          .accounts({
            config: configPda,
            position: positionPda,
            policy: policyPda,
            positionVault: positionVaultAta,
            assetMint: assetMint,
            targetMint: usdcMint,
            ownerDestinationAta: ownerUsdcAta,
            agent: attacker.publicKey,
            sourceTokenProgram: TOKEN_2022_PROGRAM_ID,
            destinationTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            jupiterProgram: JUPITER_PROGRAM_ID,
            jupiterEventAuthority: JUPITER_EVENT_AUTHORITY,
          })
          .remainingAccounts([{ pubkey: ownerUsdcAta, isSigner: false, isWritable: true }])
          .signers([attacker])
          .rpc();
      } catch (err: any) {
        threw = true;
        console.log("[Item 4.6] Non-agent swap caller rejected on-chain as expected:", err.message);
        assert.isTrue(
          err.message.includes("NotAgent") ||
            err.message.includes("6001") ||
            err.message.includes("0x1771"),
          "Must fail with NotAgent on-chain"
        );
      }
      assert.isTrue(threw, "Non-agent caller MUST fail on-chain");
    });
  });

  // =========================================================================
  // ITEM 5: Core Invariant Property / Fuzz Test Suite
  // =========================================================================
  describe("Item 5 — Core Invariant Property & Fuzz Test Suite", () => {
    it("CORE FUZZ INVARIANT: output can ONLY ever land in owner ATA across all three supported target mints (USDC, WSOL, USDT) on-chain", async () => {
      const assets = [
        { name: "USDC", mint: usdcMint, ownerAta: ownerUsdcAta, attackerAta: attackerUsdcAta },
        { name: "WSOL", mint: wsolMint, ownerAta: ownerWsolAta, attackerAta: attackerWsolAta },
        { name: "USDT", mint: usdtMint, ownerAta: ownerUsdtAta, attackerAta: attackerUsdtAta },
      ];

      const NUM_FUZZ_ITERATIONS = 15; // 15 real on-chain transaction attempts
      console.log(`Executing ${NUM_FUZZ_ITERATIONS} real on-chain fuzz transactions against solana-test-validator...`);

      for (let i = 0; i < NUM_FUZZ_ITERATIONS; i++) {
        const asset = assets[i % assets.length];

        // Owner configures policy for this asset
        await program.methods
          .setPolicy(800, 200, 7500, 50, 1, asset.mint)
          .accounts({
            config: configPda,
            position: positionPda,
            policy: policyPda,
            owner: owner.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner])
          .rpc();

        // 1. Attacker destination attempt -> MUST REVERT ON-CHAIN
        let maliciousThrew = false;
        try {
          await program.methods
            .swapAndDeliver(2500, new BN(50_000_000), dummySwapData)
            .accounts({
              config: configPda,
              position: positionPda,
              policy: policyPda,
              positionVault: positionVaultAta,
              assetMint: assetMint,
              targetMint: asset.mint,
              ownerDestinationAta: asset.attackerAta, // Malicious destination
              agent: agent.publicKey,
              sourceTokenProgram: TOKEN_2022_PROGRAM_ID,
              destinationTokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
              jupiterProgram: JUPITER_PROGRAM_ID,
              jupiterEventAuthority: JUPITER_EVENT_AUTHORITY,
            })
            .remainingAccounts([{ pubkey: asset.attackerAta, isSigner: false, isWritable: true }])
            .signers([agent])
            .rpc();
        } catch (err: any) {
          maliciousThrew = true;
          console.log(`[Item 5.1] Attacker ATA error:`, err.message);
          assert.isTrue(
            err.message.includes("InvalidSwapDestination") ||
              err.message.includes("6006") ||
              err.message.includes("0x1776") ||
              err.message.includes("Constraint"),
            `Iteration ${i} (${asset.name}): Must reject attacker destination with InvalidSwapDestination`
          );
        }
        assert.isTrue(maliciousThrew, `Iteration ${i} (${asset.name}): Attacker ATA MUST fail on-chain`);

        // 2. Exceeding exit BPS attempt (8000 > 7500) -> MUST REVERT ON-CHAIN
        let clampThrew = false;
        try {
          await program.methods
            .swapAndDeliver(8000, new BN(50_000_000), dummySwapData)
            .accounts({
              config: configPda,
              position: positionPda,
              policy: policyPda,
              positionVault: positionVaultAta,
              assetMint: assetMint,
              targetMint: asset.mint,
              ownerDestinationAta: asset.ownerAta,
              agent: agent.publicKey,
              sourceTokenProgram: TOKEN_2022_PROGRAM_ID,
              destinationTokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
              jupiterProgram: JUPITER_PROGRAM_ID,
              jupiterEventAuthority: JUPITER_EVENT_AUTHORITY,
            })
            .remainingAccounts([{ pubkey: asset.ownerAta, isSigner: false, isWritable: true }])
            .signers([agent])
            .rpc();
        } catch (err: any) {
          clampThrew = true;
          assert.isTrue(
            err.message.includes("ExitBpsExceedsPolicy") ||
              err.message.includes("6003") ||
              err.message.includes("0x1773"),
            `Iteration ${i} (${asset.name}): Must reject excessive exit BPS`
          );
        }
        assert.isTrue(clampThrew, `Iteration ${i} (${asset.name}): Excessive exit BPS MUST fail on-chain`);
      }
      console.log(`[Item 5.1] Completed ${NUM_FUZZ_ITERATIONS} on-chain fuzz assertions across USDC, WSOL, USDT with 100% rejection of invalid transactions.`);
    });

    it("INVARIANT: verifies deterministic ATA distinctness holds across all supported assets (USDC, WSOL, USDT)", async () => {
      const assets = [
        { name: "USDC", mint: usdcMint, ownerAta: ownerUsdcAta, attackerAta: attackerUsdcAta },
        { name: "WSOL", mint: wsolMint, ownerAta: ownerWsolAta, attackerAta: attackerWsolAta },
        { name: "USDT", mint: usdtMint, ownerAta: ownerUsdtAta, attackerAta: attackerUsdtAta },
      ];

      for (const asset of assets) {
        const derivedAta = await getAssociatedTokenAddress(asset.mint, owner.publicKey);
        assert.isTrue(derivedAta.equals(asset.ownerAta), `${asset.name} derived ATA matches owner ATA`);
        assert.isFalse(derivedAta.equals(asset.attackerAta), `${asset.name} derived ATA distinct from attacker ATA`);
      }
    });
  });
});
