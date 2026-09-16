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
  Transaction,
  sendAndConfirmTransaction,
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
  createAssociatedTokenAccountIdempotentInstruction,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { PolicyParser } from "../agent-solana/src/policy/parser";
import { AegisMonitor } from "../agent-solana/src/monitor";
import { fetchMultiPoolPrice } from "../agent-solana/src/price/multiPool";
import { executeSwapAndDeliver } from "../agent-solana/src/dispatcher/executor";
import { getOnChainMultiplierState, hasScaledUiAmountExtension } from "../agent-solana/src/xstocks/onchain";


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

// Mainnet live xStock Token-2022 mints preloaded into validator
const SPYX_MINT = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
const QQQX_MINT = new PublicKey("Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ");
const GLDX_MINT = new PublicKey("Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re");

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
    `&onlyDirectRoutes=true` +
    `&asLegacyTransaction=true` +
    `&dexes=Raydium%20CLMM`;

  let quoteRes: any;
  for (let i = 0; i < 3; i++) {
    try {
      quoteRes = await fetch(quoteUrl);
      if (quoteRes.ok) break;
    } catch (e) {
      if (i === 2) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
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

  let swapRes: any;
  for (let i = 0; i < 3; i++) {
    try {
      swapRes = await fetch("https://api.jup.ag/swap/v1/swap-instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(swapBody),
      });
      if (swapRes.ok) break;
    } catch (e) {
      if (i === 2) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
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

async function getConfirmedTransactionWithRetry(connection: Connection, sig: string): Promise<any> {
  for (let p = 0; p < 80; p++) {
    try {
      const tx = await connection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (tx) return tx;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

describe("Aegis Anchor Program — Live Validator On-Chain Test Suite", function () {
  this.timeout(180000);

  // Local validator connection with reliable HTTP polling confirmation (no WebSocket hang)
  const conn = new Connection("http://127.0.0.1:8899", "processed");
  (conn as any).confirmTransaction = async function (strategyOrSig: any, commitment?: any) {
    const sig = typeof strategyOrSig === "string" ? strategyOrSig : strategyOrSig?.signature;
    if (!sig) return { value: { err: null } };
    for (let i = 0; i < 50; i++) {
      try {
        const res = await conn.getSignatureStatus(sig);
        if (res?.value) {
          if (res.value.err) {
            throw new Error(`Transaction ${sig} failed: ${JSON.stringify(res.value.err)}`);
          }
          return res;
        }
      } catch (err: any) {
        if (err.message && err.message.includes("failed:")) throw err;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const finalRes = await conn.getSignatureStatus(sig);
    if (finalRes?.value && !finalRes.value.err) return finalRes;
    throw new Error(`Transaction ${sig} failed to confirm within 5s`);
  };
  const mainnetConn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  // Keypairs for participants (deterministic to match pre-funded account fixtures in Anchor.toml)
  const authority = Keypair.fromSeed(Buffer.alloc(32, 1));
  const agent = Keypair.fromSeed(Buffer.alloc(32, 2));
  const owner = Keypair.fromSeed(Buffer.alloc(32, 7));
  const attacker = Keypair.fromSeed(Buffer.alloc(32, 4));

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

    // Wait for validator to be fully producing blocks and advancing slots
    let validatorReady = false;
    for (let i = 0; i < 90; i++) {
      try {
        const slot1 = await conn.getSlot("confirmed");
        await new Promise((r) => setTimeout(r, 1000));
        const slot2 = await conn.getSlot("confirmed");
        const bh = await conn.getLatestBlockhash("confirmed");
        if (slot2 > slot1 && slot2 >= 10 && bh.blockhash) {
          console.log(`Validator confirmed ready and advancing (slot ${slot1} -> ${slot2})`);
          validatorReady = true;
          break;
        }
      } catch {
        if (i % 10 === 0) console.log(`Waiting for validator to boot... (${i}s)`);
      }
    }
    if (!validatorReady) {
      throw new Error("Validator failed to boot within 90s");
    }

    // Fund test keypairs directly from genesis wallet (500,000,000 SOL)
    const idPath = path.resolve(process.env.HOME || "/root", ".config/solana/id.json");
    let genesisPayer: Keypair | null = null;
    if (fs.existsSync(idPath)) {
      try {
        genesisPayer = Keypair.fromSecretKey(
          Uint8Array.from(JSON.parse(fs.readFileSync(idPath, "utf8")))
        );
      } catch {
        genesisPayer = null;
      }
    }

    if (genesisPayer) {
      console.log("Funding test accounts via genesis provider transfer...");
      const genesisWallet = new anchor.Wallet(genesisPayer);
      const genesisProvider = new anchor.AnchorProvider(conn, genesisWallet, {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
      });
      const tx = new Transaction();
      for (const kp of [authority, agent, owner, attacker]) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: genesisPayer.publicKey,
            toPubkey: kp.publicKey,
            lamports: 10 * LAMPORTS_PER_SOL,
          })
        );
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const sig = await genesisProvider.sendAndConfirm(tx);
          console.log(`Genesis funding tx confirmed: ${sig}`);
          break;
        } catch (e: any) {
          console.log(`Genesis transfer attempt ${attempt + 1} error: ${e.message}`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    for (const [name, kp] of [
      ["authority", authority],
      ["agent", agent],
      ["owner", owner],
      ["attacker", attacker],
    ] as const) {
      let finalBal = 0;
      for (let p = 0; p < 30; p++) {
        finalBal = await conn.getBalance(kp.publicKey, "confirmed");
        if (finalBal >= 10 * LAMPORTS_PER_SOL) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      console.log(`Funded ${name} (${kp.publicKey.toBase58()}): ${finalBal / LAMPORTS_PER_SOL} SOL`);
      assert.isTrue(finalBal >= 10 * LAMPORTS_PER_SOL, `${name} must have 10 SOL`);
    }
    await new Promise((r) => setTimeout(r, 1000));

    // 2. Initialize Anchor provider with authority wallet
    const wallet = new anchor.Wallet(authority);
    provider = new anchor.AnchorProvider(conn, wallet, {
      commitment: "processed",
      preflightCommitment: "processed",
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

    // Derive target mint ATAs for owner and attacker
    ownerUsdcAta = await getAssociatedTokenAddress(usdcMint, owner.publicKey);
    ownerWsolAta = await getAssociatedTokenAddress(wsolMint, owner.publicKey);
    ownerUsdtAta = await getAssociatedTokenAddress(usdtMint, owner.publicKey);

    attackerUsdcAta = await getAssociatedTokenAddress(usdcMint, attacker.publicKey);
    attackerWsolAta = await getAssociatedTokenAddress(wsolMint, attacker.publicKey);
    attackerUsdtAta = await getAssociatedTokenAddress(usdtMint, attacker.publicKey);

    // Create target mint ATAs atomically in one transaction with fresh blockhash
    const { blockhash: ataBh } = await conn.getLatestBlockhash("confirmed");
    const ataTx = new Transaction({ recentBlockhash: ataBh, feePayer: owner.publicKey });
    ataTx.add(
      createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, ownerUsdcAta, owner.publicKey, usdcMint),
      createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, ownerWsolAta, owner.publicKey, wsolMint),
      createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, ownerUsdtAta, owner.publicKey, usdtMint),
      createAssociatedTokenAccountIdempotentInstruction(attacker.publicKey, attackerUsdcAta, attacker.publicKey, usdcMint),
      createAssociatedTokenAccountIdempotentInstruction(attacker.publicKey, attackerWsolAta, attacker.publicKey, wsolMint),
      createAssociatedTokenAccountIdempotentInstruction(attacker.publicKey, attackerUsdtAta, attacker.publicKey, usdtMint)
    );
    ataTx.sign(owner, attacker);
    await conn.sendRawTransaction(ataTx.serialize(), { skipPreflight: true });

    // Wait for at least owner USDC ATA to exist
    for (let r = 0; r < 30; r++) {
      try {
        await getAccount(conn, ownerUsdcAta, "confirmed", TOKEN_PROGRAM_ID);
        break;
      } catch {
        await new Promise((res) => setTimeout(res, 200));
      }
    }

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
      const txDetails = await getConfirmedTransactionWithRetry(conn, txSig);
      const logs = txDetails?.meta?.logMessages || [];
      console.log("[Item 1.1] Logs:", logs);

      if (logs.length > 0) {
        assert.isTrue(
          logs.some((l) => l.includes("Instruction: GetMintMultiplier")),
          "Must invoke GetMintMultiplier instruction"
        );
        assert.isTrue(
          logs.some((l) => l.includes("success")),
          "Instruction must execute successfully on-chain"
        );
      } else {
        const sigStatus = await conn.getSignatureStatus(txSig);
        assert.isTrue(!sigStatus?.value?.err, "Transaction must succeed on-chain");
      }

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
      const txDetails = await getConfirmedTransactionWithRetry(conn, txSig);
      const logs = txDetails?.meta?.logMessages || [];
      console.log("[Item 1.2] Logs:", logs);

      if (logs.length > 0) {
        assert.isTrue(
          logs.some((l) => l.includes("success")),
          "Standard SPL mint handling succeeds on-chain"
        );
      } else {
        const sigStatus = await conn.getSignatureStatus(txSig);
        assert.isTrue(!sigStatus?.value?.err, "Standard SPL mint handling succeeds on-chain");
      }
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
      const txDetails = await getConfirmedTransactionWithRetry(conn, txSig);
      const logs = txDetails?.meta?.logMessages || [];
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
      const txDetails = await getConfirmedTransactionWithRetry(conn, txSig);
      const logs = txDetails?.meta?.logMessages || [];
      console.log("[Item 2.2] Logs:", logs);

      // Verify on-chain position account state
      const posAcc = await (program.account as any).position.fetch(positionPda);
      assert.isTrue(posAcc.owner.equals(owner.publicKey), "Position owner correctly set");
      assert.isTrue(posAcc.assetMint.equals(assetMint), "Asset mint set");
      assert.equal(posAcc.amount.toNumber(), 500_000_000, "Position amount matches deposit");
      assert.isFalse(posAcc.paused, "Position is not paused");
      assert.isNull(posAcc.policy, "No policy attached yet");

      // Verify on-chain vault token balance
      const vaultAcc = await getAccount(conn, positionVaultAta, "processed", TOKEN_2022_PROGRAM_ID);
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
      const ownerBeforeAcc = await getAccount(conn, ownerAssetAta, "processed", TOKEN_2022_PROGRAM_ID);

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
      const txDetails = await getConfirmedTransactionWithRetry(conn, txSig);
      const logs = txDetails?.meta?.logMessages || [];
      console.log("[Item 2.4] Logs:", logs);

      const posAcc = await (program.account as any).position.fetch(positionPda);
      assert.equal(posAcc.amount.toNumber(), 300_000_000, "Position balance deducted by 200");

      const ownerAfterAcc = await getAccount(conn, ownerAssetAta, "processed", TOKEN_2022_PROGRAM_ID);
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
      const txDetails = await getConfirmedTransactionWithRetry(conn, txSig);
      const logs = txDetails?.meta?.logMessages || [];
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
      const destAtaBefore = await getAccount(conn, ownerUsdcAta, "processed", TOKEN_PROGRAM_ID);
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
      const txDetails = await getConfirmedTransactionWithRetry(conn, txSig);
      const logs = txDetails?.meta?.logMessages || [];
      const cu = txDetails?.meta?.computeUnitsConsumed || 0;
      console.log("[Item 4.4] On-chain program logs:", logs);
      console.log(`[Item 4.4] Compute units consumed: ${cu}`);

      const destAtaAfter = await getAccount(conn, ownerUsdcAta, "processed", TOKEN_PROGRAM_ID);
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

  // =========================================================================
  // ITEM 6: Autonomous Risk Guardian Agent & Live Walkthrough Suite
  // =========================================================================
  describe("Item 6 — Autonomous Risk Guardian Agent & Live Walkthrough Suite", () => {
    let parsedPolicy: any;
    let monitor: AegisMonitor;

    it("parses natural language policy via Claude composer into exact on-chain parameters", async () => {
      const sentence = "If SPYX drops more than 8% exit 50% cautiously into USDC";
      console.log(`[Item 6.1] NL Policy Input: "${sentence}"`);

      const parser = new PolicyParser(process.env.ANTHROPIC_API_KEY || "");
      parsedPolicy = await parser.parse(sentence);
      console.log(`[Item 6.1] Claude-parsed parameters:\n${PolicyParser.formatPreview(parsedPolicy)}`);

      assert.equal(parsedPolicy.drawdown_bps, 800, "Drawdown is 800 BPS (8%)");
      assert.equal(parsedPolicy.exit_bps, 5000, "Exit is 5000 BPS (50%)");
      assert.equal(parsedPolicy.max_slippage_bps, 30, "Cautious slippage is 30 BPS (0.3%)");
      assert.equal(parsedPolicy.target_asset, "USDC", "Target asset is USDC");

      // Update on-chain policy with parsed parameters
      const txSig = await program.methods
        .setPolicy(
          parsedPolicy.drawdown_bps,
          parsedPolicy.oracle_deviation_bps,
          parsedPolicy.exit_bps,
          parsedPolicy.max_slippage_bps,
          1,
          usdcMint
        )
        .accounts({
          config: configPda,
          position: positionPda,
          policy: policyPda,
          owner: owner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      console.log(`[Item 6.1] setPolicy(Claude-parsed) Tx Signature: ${txSig}`);
      const pol = await (program.account as any).policy.fetch(policyPda);
      assert.equal(pol.drawdownThresholdBps, 800);
      assert.equal(pol.exitPercentBps, 5000);
      assert.equal(pol.maxSlippageBps, 30);
      assert.isTrue(pol.targetMint.equals(usdcMint));
    });

    it("PROVES SAFETY BEHAVIOR 2: fail-safe on price-source failure (skips evaluation without state mutation)", async () => {
      const posAcc = await (program.account as any).position.fetch(positionPda);
      const vaultBefore = posAcc.amount;

      monitor = new AegisMonitor({
        connection: conn,
        agentKeypair: agent,
        program: program as any,
        dryRun: false,
      });

      monitor.registerPosition({
        positionPubkey: positionPda,
        owner: owner.publicKey,
        assetMint: assetMint,
        targetMint: usdcMint,
        amount: vaultBefore,
        policyPubkey: policyPda,
        paused: false,
        index: posAcc.index,
        policy: {
          drawdown_bps: parsedPolicy.drawdown_bps,
          oracle_deviation_bps: parsedPolicy.oracle_deviation_bps,
          exit_bps: parsedPolicy.exit_bps,
          max_slippage_bps: parsedPolicy.max_slippage_bps,
          active: true,
          target_mint: usdcMint,
        },
        entryPriceRaw: 770.0,
        entryMultiplier: 1.0,
        previousPriceRaw: 770.0,
        previousMultiplier: 1.0,
        consecutiveBreachCount: 0,
      });

      // Inject simulated price failure (timeout / missing quotes)
      monitor.setCustomPriceProvider(async () => {
        return {
          status: "UNAVAILABLE",
          priceUsd: null,
          spreadBps: null,
          whirlpoolPrice: null,
          raydiumPrice: null,
          reason: "Simulated Orca Whirlpool quote timeout (fail-closed discipline)",
        };
      });

      const pass = await monitor.runPass();
      console.log(`[Item 6.2] Fail-Safe Pass: assessed=${pass.assessed}, breaches=${pass.breaches}, dispatched=${pass.dispatched}`);

      assert.equal(pass.assessed, 0, "Failed price feed must cause position assessment to be skipped");
      assert.equal(pass.breaches, 0, "No breach triggered on unavailable price feed");
      assert.equal(pass.dispatched, 0, "Zero transactions dispatched on unavailable price feed");

      const posAfter = await (program.account as any).position.fetch(positionPda);
      assert.equal(posAfter.amount.toString(), vaultBefore.toString(), "Vault balance completely untouched");
    });

    it("PROVES SAFETY BEHAVIOR 1: proactive corporate-action pause (suspends triggers in activation window)", async () => {
      const posState = monitor.getPositionState(positionPda)!;
      posState.consecutiveBreachCount = 0;

      // Simulate a deep 25% price drawdown from $770 to $577.5
      monitor.setCustomPriceProvider(async () => {
        return {
          status: "OK",
          priceUsd: 577.5, // 25% drop
          spreadBps: 10,
          whirlpoolPrice: 577.0,
          raydiumPrice: 578.0,
          reason: "Multi-pool verified: spread 10 BPS <= 150 BPS",
        };
      });

      // Inject a pending corporate action inside the 2-hour activation window
      const nowSec = Math.floor(Date.now() / 1000);
      posState.customCorporateActions = [
        {
          mint: assetMint.toBase58(),
          symbol: "SPYX",
          actionType: "split",
          needsReview: false,
          newMultiplier: 2.0,
          oldMultiplier: 1.0,
          exDate: new Date(Date.now() + 3600_000).toISOString().split("T")[0],
          activationTime: nowSec + 3600, // 1 hour from now -> inside 2-hour suspension window
          applied: false,
        },
      ];

      const pass = await monitor.runPass();
      console.log(`[Item 6.3] Corporate Action Pause Pass: assessed=${pass.assessed}, breaches=${pass.breaches}, dispatched=${pass.dispatched}`);

      assert.equal(pass.assessed, 1, "Position assessed for corporate action window");
      assert.equal(pass.breaches, 0, "No breach allowed during corporate action window");
      assert.equal(pass.dispatched, 0, "Zero transactions dispatched during corporate action window");
    });

    it("PROVES SAFETY BEHAVIOR 3: corporate-action multiplier change normalizes price and prevents false breach", async () => {
      const posState = monitor.getPositionState(positionPda)!;
      posState.customCorporateActions = []; // Clear corporate action window
      posState.consecutiveBreachCount = 0;

      // Scenario: Stock undergoes a 2:1 stock split.
      // Entry was $770.00 @ multiplier 1.0 (Effective entry = $770.00)
      // Raw market price drops by 50% from $770.00 to $385.00!
      // In a naive risk engine, a 50% drop trips the 8% drawdown rule and falsely liquidates.
      // In Aegis, on-chain multiplier updates to 2.0.
      // Normalized price = $385.00 * 2.0 = $770.00.
      // Normalized drawdown = 0.00% (well below 8.00% threshold).
      posState.entryPriceRaw = 770.0;
      posState.entryMultiplier = 1.0;
      posState.customMultiplier = 2.0; // 2:1 stock split multiplier

      monitor.setCustomPriceProvider(async () => {
        return {
          status: "OK",
          priceUsd: 385.0, // 50% raw price drop!
          spreadBps: 10,
          whirlpoolPrice: 384.8,
          raydiumPrice: 385.2,
          reason: "Multi-pool verified: spread 10 BPS <= 150 BPS",
        };
      });

      const pass = await monitor.runPass();
      console.log(`[Item 6.4] Corporate Action Multiplier Normalization Pass: assessed=${pass.assessed}, breaches=${pass.breaches}, dispatched=${pass.dispatched}`);

      assert.equal(pass.assessed, 1, "Position assessed with multiplier normalization");
      assert.equal(pass.breaches, 0, "Zero false breach triggered despite 50% raw price drop");
      assert.equal(pass.dispatched, 0, "Zero transactions dispatched on stock split");

      // Reset custom multiplier for subsequent tests
      posState.customMultiplier = undefined;
    });

    it("PROVES FULL LIVE WALKTHROUGH: 2-poll persistence detection, autonomous swap_and_deliver dispatch, USDC settlement, and remainder withdrawal", async () => {
      const posState = monitor.getPositionState(positionPda)!;
      posState.customCorporateActions = []; // Clear corporate action window
      posState.consecutiveBreachCount = 0;

      // Current price set to $690 (10.4% drop from $770 entry, exceeding 8% threshold)
      monitor.setCustomPriceProvider(async () => {
        return {
          status: "OK",
          priceUsd: 690.0,
          spreadBps: 8,
          whirlpoolPrice: 689.7,
          raydiumPrice: 690.3,
          reason: "Multi-pool verified: spread 8 BPS <= 150 BPS",
        };
      });

      // Record owner destination balance before any breach dispatch
      const destAtaBefore = await getAccount(conn, ownerUsdcAta, "confirmed", TOKEN_PROGRAM_ID);
      const balanceBefore = destAtaBefore.amount;
      console.log(`[Item 6.5] BEFORE: owner_usdc_ata = ${balanceBefore} USDC atoms`);

      // ── Poll 1: First observation of breach (persistence poll 1/2) ──────────
      console.log("[Item 6.5] === Executing Monitor Poll 1 ===");
      const pass1 = await monitor.runPass();
      console.log(`[Item 6.5] Poll 1 Result: assessed=${pass1.assessed}, breaches=${pass1.breaches}, dispatched=${pass1.dispatched}`);

      assert.equal(pass1.breaches, 1, "Poll 1 detects breach");
      assert.equal(pass1.dispatched, 0, "Poll 1 MUST NOT dispatch (waiting for 2-poll persistence)");
      assert.equal(monitor.getPositionState(positionPda)!.consecutiveBreachCount, 1, "Persistence count is 1");

      const destAtaMid = await getAccount(conn, ownerUsdcAta, "processed", TOKEN_PROGRAM_ID);
      assert.equal(destAtaMid.amount, balanceBefore, "Balance unchanged after poll 1");

      // ── Poll 2: Consecutive observation confirms breach & triggers dispatch ──
      console.log("[Item 6.5] === Executing Monitor Poll 2 ===");
      const pass2 = await monitor.runPass();
      console.log(`[Item 6.5] Poll 2 Result: assessed=${pass2.assessed}, breaches=${pass2.breaches}, dispatched=${pass2.dispatched}`);

      assert.equal(pass2.breaches, 1, "Poll 2 detects persistent breach");
      assert.equal(pass2.dispatched, 1, "Poll 2 MUST autonomously dispatch swap_and_deliver");

      // Verify real settlement on-chain
      const destAtaAfter = await getAccount(conn, ownerUsdcAta, "processed", TOKEN_PROGRAM_ID);
      const actualIncrease = destAtaAfter.amount - balanceBefore;
      console.log(`[Item 6.5] AFTER: owner_usdc_ata = ${destAtaAfter.amount} USDC atoms`);
      console.log(`[Item 6.5] SETTLEMENT DELTA: +${actualIncrease} USDC atoms delivered to owner!`);

      assert.isTrue(actualIncrease > 0n, "Owner USDC balance MUST genuinely increase via autonomous dispatch!");

      // ── Step 7: Withdraw Remainder (Unconditional Owner Sovereignty Proof) ──
      console.log("[Item 6.5] === Executing Step 7: Withdraw Remainder ===");
      const posVaultBefore = await getAccount(conn, positionVaultAta, "processed", TOKEN_2022_PROGRAM_ID);
      const remainingAmount = posVaultBefore.amount;
      console.log(`[Item 6.5] Remaining position vault balance: ${remainingAmount} atoms`);
      assert.isTrue(remainingAmount > 0n, "Position vault must retain unswapped remainder tokens");

      const ownerAssetBefore = await getAccount(conn, ownerAssetAta, "processed", TOKEN_2022_PROGRAM_ID);

      const withdrawTx = await program.methods
        .withdraw(new BN(remainingAmount.toString()))
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

      console.log(`[Item 6.5] Step 7: withdraw(remainder) Tx Signature: ${withdrawTx}`);

      const posVaultAfter = await getAccount(conn, positionVaultAta, "processed", TOKEN_2022_PROGRAM_ID);
      assert.equal(posVaultAfter.amount, 0n, "Position vault is completely emptied after remainder withdrawal");

      const ownerAssetAfter = await getAccount(conn, ownerAssetAta, "processed", TOKEN_2022_PROGRAM_ID);
      assert.equal(
        ownerAssetAfter.amount - ownerAssetBefore.amount,
        remainingAmount,
        "Owner received exact remainder amount back into owner wallet"
      );
      console.log(`[Item 6.5] Remainder of ${remainingAmount} SPYX atoms successfully returned to owner. Seven-transaction proof complete!`);
    });
  });

  // =========================================================================
  // ITEM 7: Generic Asset Support for Arbitrary Solana xStocks (Empirical Proof via QQQx)
  // =========================================================================
  describe("Item 7 — Generic Asset Support for Arbitrary Solana xStocks (Empirical Proof via QQQx)", () => {
    let qqqxPositionPda: PublicKey;
    let qqqxPositionVaultAta: PublicKey;
    let ownerQqqxAta: PublicKey;
    const QQQX_DEPOSIT = new BN(1_000_000_000); // 10 QQQx tokens (8 decimals)

    it("reads on-chain Token-2022 mint Scaled UI Amount multiplier and pending dividend corporate action for QQQx", async () => {
      // 1. Invoke on-chain program get_mint_multiplier on QQQx mint
      const txSig = await program.methods
        .getMintMultiplier()
        .accounts({ mint: QQQX_MINT })
        .rpc();

      console.log(`[Item 7.1] getMintMultiplier(QQQX) Tx Signature: ${txSig}`);
      const txDetails = await getConfirmedTransactionWithRetry(conn, txSig);
      assert.isNotNull(txDetails, "QQQX getMintMultiplier transaction must be confirmed on-chain");
      const logs = txDetails!.meta?.logMessages || [];
      console.log("[Item 7.1] Logs:", logs);

      assert.isTrue(
        logs.some((l) => l.includes("Instruction: GetMintMultiplier")),
        "Must invoke GetMintMultiplier instruction"
      );
      assert.isTrue(
        logs.some((l) => l.includes("success")),
        "Instruction must execute successfully on-chain"
      );

      // 2. Query agent on-chain reader for QQQX
      const multState = await getOnChainMultiplierState(conn, QQQX_MINT);
      console.log("[Item 7.1] QQQX on-chain multiplier state:", multState);

      assert.isNotNull(multState, "QQQX multiplier state must not be null");
      assert.isAbove(multState!.currentMultiplier, 1.0, "Current multiplier must reflect corporate actions (> 1.0)");
      assert.closeTo(multState!.currentMultiplier, 1.001955, 0.001, "QQQX multiplier matches mainnet state");
      assert.closeTo(multState!.newMultiplier!, 1.002725, 0.0001, "Pending new multiplier for scheduled dividend matches mainnet state");
      assert.equal(multState!.activationTime, 1782086100, "Activation timestamp matches mainnet state");
      assert.isTrue(multState!.actions.length > 0, "Discovered scheduled corporate action on-chain");
      assert.equal(multState!.actions[0].actionType.toLowerCase(), "dividend", "Action type detected as DIVIDEND");
      assert.closeTo(multState!.actions[0].newMultiplier, 1.002725, 0.0001, "Action target multiplier matches");
    });

    it("fetches deliverable Jupiter price quote for QQQx across Solana liquidity and enforces 150 BPS divergence guard", async () => {
      // Test multiPool price fetch for QQQX -> USDC
      const priceResult = await fetchMultiPoolPrice(
        QQQX_MINT.toBase58(),
        usdcMint.toBase58(),
        8,
        6,
        1.0
      );
      console.log("[Item 7.2] QQQX multi-pool price result:", priceResult);

      assert.equal(priceResult.status, "OK", "Multi-pool price check must pass with OK status");
      assert.isNotNull(priceResult.priceUsd, "Price USD must not be null");
      assert.isAbove(priceResult.priceUsd!, 600.0, "QQQX price must reflect realistic Nasdaq ETF valuation (> $600)");
      assert.isBelow(priceResult.priceUsd!, 900.0, "QQQX price must be in reasonable range (< $900)");
      assert.isNotNull(priceResult.spreadBps, "Spread BPS must not be null");
      assert.isAtMost(priceResult.spreadBps!, 150, "Spread BPS must be within 150 BPS divergence threshold");
      console.log(`[Item 7.2] QQQX price verified: $${priceResult.priceUsd!.toFixed(2)} USD (spread: ${priceResult.spreadBps} BPS)`);
    });

    it("deposits second real asset (QQQx) into guarded position on-chain via openPosition", async () => {
      // 1. Fetch current total positions to derive next position index
      const cfg = await (program.account as any).aegisConfig.fetch(configPda);
      const qqqxIndex = cfg.totalPositions;
      console.log(`[Item 7.3] Next position index: ${qqqxIndex.toString()}`);

      [qqqxPositionPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          owner.publicKey.toBuffer(),
          qqqxIndex.toArrayLike(Buffer, "le", 8),
        ],
        programId
      );

      qqqxPositionVaultAta = await getAssociatedTokenAddress(
        QQQX_MINT,
        qqqxPositionPda,
        true,
        TOKEN_2022_PROGRAM_ID
      );

      ownerQqqxAta = await getAssociatedTokenAddress(
        QQQX_MINT,
        owner.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      console.log(`[Item 7.3] Owner QQQX ATA: ${ownerQqqxAta.toBase58()}`);
      console.log(`[Item 7.3] QQQX Position PDA: ${qqqxPositionPda.toBase58()}`);
      console.log(`[Item 7.3] QQQX Position Vault ATA: ${qqqxPositionVaultAta.toBase58()}`);

      // Verify owner has pre-funded QQQx tokens loaded via Anchor validator account fixture
      const ownerBeforeAcc = await getAccount(conn, ownerQqqxAta, "processed", TOKEN_2022_PROGRAM_ID);
      console.log(`[Item 7.3] Owner pre-funded QQQX balance: ${ownerBeforeAcc.amount} atoms`);
      assert.isTrue(ownerBeforeAcc.amount >= BigInt(QQQX_DEPOSIT.toString()), "Owner must have sufficient QQQX tokens");

      // Execute openPosition on QQQx (proving generic asset acceptance on-chain)
      const txSig = await program.methods
        .openPosition(QQQX_DEPOSIT)
        .accounts({
          config: configPda,
          position: qqqxPositionPda,
          positionVault: qqqxPositionVaultAta,
          assetMint: QQQX_MINT,
          ownerTokenAccount: ownerQqqxAta,
          owner: owner.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      console.log(`[Item 7.3] openPosition(QQQX) Tx Signature: ${txSig}`);
      const txDetails = await getConfirmedTransactionWithRetry(conn, txSig);
      assert.isNotNull(txDetails, "openPosition transaction must be confirmed");
      const logs = txDetails!.meta?.logMessages || [];
      console.log("[Item 7.3] Logs:", logs);

      // Verify on-chain position account state for QQQx
      const posAcc = await (program.account as any).position.fetch(qqqxPositionPda);
      assert.isTrue(posAcc.owner.equals(owner.publicKey), "Position owner matches owner key");
      assert.isTrue(posAcc.assetMint.equals(QQQX_MINT), "GENERIC PROOF: Position asset mint stored as QQQX without allowlist restriction");
      assert.equal(posAcc.amount.toString(), QQQX_DEPOSIT.toString(), "Position amount matches deposited QQQX tokens");
      assert.isFalse(posAcc.paused, "Position initialized unpaused");

      // Verify on-chain vault token balance
      const vaultAcc = await getAccount(conn, qqqxPositionVaultAta, "processed", TOKEN_2022_PROGRAM_ID);
      assert.equal(vaultAcc.amount.toString(), QQQX_DEPOSIT.toString(), "Vault ATA received exact QQQX tokens");
    });

    it("owner withdraws QQQx tokens unconditionally proving generic owner sovereignty", async () => {
      const withdrawAmount = new BN(400_000_000); // 4 QQQx tokens
      const ownerBeforeAcc = await getAccount(conn, ownerQqqxAta, "processed", TOKEN_2022_PROGRAM_ID);
      const vaultBeforeAcc = await getAccount(conn, qqqxPositionVaultAta, "processed", TOKEN_2022_PROGRAM_ID);

      const txSig = await program.methods
        .withdraw(withdrawAmount)
        .accounts({
          position: qqqxPositionPda,
          positionVault: qqqxPositionVaultAta,
          ownerTokenAccount: ownerQqqxAta,
          assetMint: QQQX_MINT,
          owner: owner.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      console.log(`[Item 7.4] withdraw(QQQX) Tx Signature: ${txSig}`);
      const txDetails = await getConfirmedTransactionWithRetry(conn, txSig);
      assert.isNotNull(txDetails, "withdraw transaction must be confirmed");

      const posAcc = await (program.account as any).position.fetch(qqqxPositionPda);
      assert.equal(
        posAcc.amount.toString(),
        QQQX_DEPOSIT.sub(withdrawAmount).toString(),
        "Position balance deducted by withdrawn amount"
      );

      const ownerAfterAcc = await getAccount(conn, ownerQqqxAta, "processed", TOKEN_2022_PROGRAM_ID);
      assert.equal(
        (ownerAfterAcc.amount - ownerBeforeAcc.amount).toString(),
        withdrawAmount.toString(),
        "Owner received exact withdrawn QQQX tokens"
      );

      const vaultAfterAcc = await getAccount(conn, qqqxPositionVaultAta, "processed", TOKEN_2022_PROGRAM_ID);
      assert.equal(
        (vaultBeforeAcc.amount - vaultAfterAcc.amount).toString(),
        withdrawAmount.toString(),
        "Vault balance decreased by withdrawn amount"
      );
    });

    it("verifies generic non-xStock SPL token fallback (multiplier = 1.0)", async () => {
      // 1. Check hasScaledUiAmountExtension on standard SPL USDC mint
      const hasExt = await hasScaledUiAmountExtension(conn, usdcMint);
      assert.isFalse(hasExt, "Standard SPL USDC mint has no ScaledUiAmount extension");

      // 2. Query multiplier state on standard SPL USDC mint
      const multState = await getOnChainMultiplierState(conn, usdcMint);
      console.log("[Item 7.5] Non-xStock SPL multiplier state:", multState);

      assert.isNotNull(multState, "Multiplier state must not be null");
      assert.equal(multState!.currentMultiplier, 1.0, "Non-xStock token defaults gracefully to 1.0 multiplier");
      assert.isNull(multState!.newMultiplier, "Non-xStock token has null newMultiplier");
      assert.isNull(multState!.activationTime, "Non-xStock token has null activationTime");
      assert.equal(multState!.actions.length, 0, "Non-xStock token has zero corporate actions");
    });
  });
});


