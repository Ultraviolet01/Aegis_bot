const anchor = require("@coral-xyz/anchor");
const { Program } = anchor;
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} = require("@solana/web3.js");
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");

async function main() {
  const rpcUrl = "http://127.0.0.1:8899";
  const conn = new Connection(rpcUrl, "processed");

  // HTTP polling confirmation to avoid WebSocket hang
  conn.confirmTransaction = async function (strategyOrSig) {
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
      } catch (err) {
        if (err.message && err.message.includes("failed:")) throw err;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const finalRes = await conn.getSignatureStatus(sig);
    if (finalRes?.value && !finalRes.value.err) return finalRes;
    throw new Error(`Transaction ${sig} failed to confirm within 5s`);
  };

  console.log("=== Initializing On-Chain Aegis Config & Accounts on Persistent Validator ===");

  // Wait for validator to be advancing slots
  console.log("Waiting for validator to be ready...");
  for (let i = 0; i < 60; i++) {
    try {
      const slot = await conn.getSlot("confirmed");
      if (slot > 0) {
        console.log(`Validator active at slot ${slot}`);
        break;
      }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 500));
  }

  // Load IDL
  const idlPath = path.resolve(__dirname, "../target/idl/aegis.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const programId = new PublicKey("C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L");

  // Deterministic keypairs
  const authority = Keypair.fromSeed(Buffer.alloc(32, 1));
  const agent = Keypair.fromSeed(Buffer.alloc(32, 2));
  const owner = Keypair.fromSeed(Buffer.alloc(32, 7));

  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Agent:", agent.publicKey.toBase58());
  console.log("Owner:", owner.publicKey.toBase58());

  // Setup Anchor Provider with authority
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(conn, wallet, {
    commitment: "processed",
    preflightCommitment: "processed",
  });
  anchor.setProvider(provider);
  const program = new Program(idl, provider);

  // Config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("aegis-config")],
    programId
  );
  console.log("Config PDA:", configPda.toBase58());

  const usdcMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

  // Check if config already initialized
  let isInit = false;
  try {
    const cfg = await program.account.aegisConfig.fetch(configPda);
    console.log("Aegis Config already initialized! Authority:", cfg.authority.toBase58(), "Agent:", cfg.agent.toBase58());
    isInit = true;
  } catch (e) {
    console.log("Aegis Config not yet initialized. Initializing now...");
  }

  if (!isInit) {
    const txSig = await program.methods
      .initialize(agent.publicKey, usdcMint)
      .accounts({
        config: configPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    console.log("Successfully initialized Aegis Config! Tx:", txSig);
  }

  // Ensure owner USDC ATA exists
  const ownerUsdcAta = await getAssociatedTokenAddress(usdcMint, owner.publicKey);
  console.log("Owner USDC ATA:", ownerUsdcAta.toBase58());
  try {
    await getAccount(conn, ownerUsdcAta, "confirmed", TOKEN_PROGRAM_ID);
    console.log("Owner USDC ATA already exists.");
  } catch (e) {
    console.log("Creating owner USDC ATA...");
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: owner.publicKey });
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        owner.publicKey,
        ownerUsdcAta,
        owner.publicKey,
        usdcMint
      )
    );
    tx.sign(owner);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await conn.confirmTransaction(sig);
    console.log("Created owner USDC ATA:", sig);
  }

  // Check balances
  const solBal = await conn.getBalance(owner.publicKey, "confirmed");
  console.log(`Owner SOL balance: ${solBal / 1e9} SOL`);

  const spyxMint = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
  const qqqxMint = new PublicKey("Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ");

  const ownerSpyxAta = await getAssociatedTokenAddress(spyxMint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const ownerQqqxAta = await getAssociatedTokenAddress(qqqxMint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);

  try {
    const spyxAcc = await getAccount(conn, ownerSpyxAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    console.log(`Owner SPYX balance: ${spyxAcc.amount} atoms (${Number(spyxAcc.amount) / 1e8} SPYX)`);
  } catch (e) {
    console.warn("Owner SPYX ATA not found:", e.message);
  }

  try {
    const qqqxAcc = await getAccount(conn, ownerQqqxAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    console.log(`Owner QQQx balance: ${qqqxAcc.amount} atoms (${Number(qqqxAcc.amount) / 1e8} QQQx)`);
  } catch (e) {
    console.warn("Owner QQQx ATA not found:", e.message);
  }

  console.log("=== Initialization Complete ===");
}

main().catch((err) => {
  console.error("Initialization error:", err);
  process.exit(1);
});
