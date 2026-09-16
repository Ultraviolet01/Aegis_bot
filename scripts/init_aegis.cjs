const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} = require("@solana/spl-token");

async function main() {
  const conn = new Connection("http://127.0.0.1:8899", "confirmed");
  console.log("=== Aegis Setup & Balances Verification ===");

  const usdcMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const spyxMint = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
  const qqqxMint = new PublicKey("Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ");

  const owner = Keypair.fromSeed(Buffer.alloc(32, 7));
  console.log("Owner Pubkey:", owner.publicKey.toBase58());

  // 1. Ensure Owner USDC ATA exists
  const ownerUsdcAta = await getAssociatedTokenAddress(usdcMint, owner.publicKey);
  console.log("Owner USDC ATA:", ownerUsdcAta.toBase58());
  try {
    const acc = await getAccount(conn, ownerUsdcAta, "confirmed", TOKEN_PROGRAM_ID);
    console.log("Owner USDC ATA exists, balance:", acc.amount.toString(), "atoms");
  } catch (e) {
    console.log("Creating Owner USDC ATA...");
    const tx = new Transaction();
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        owner.publicKey,
        ownerUsdcAta,
        owner.publicKey,
        usdcMint
      )
    );
    const sig = await sendAndConfirmTransaction(conn, tx, [owner], {
      commitment: "confirmed",
    });
    console.log("Owner USDC ATA created! Tx:", sig);
  }

  // 2. Query Owner SOL balance
  const solLamports = await conn.getBalance(owner.publicKey, "confirmed");

  // 3. Query Owner SPYX balance
  const ownerSpyxAta = await getAssociatedTokenAddress(spyxMint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const spyxAcc = await getAccount(conn, ownerSpyxAta, "confirmed", TOKEN_2022_PROGRAM_ID);

  // 4. Query Owner QQQx balance
  const ownerQqqxAta = await getAssociatedTokenAddress(qqqxMint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const qqqxAcc = await getAccount(conn, ownerQqqxAta, "confirmed", TOKEN_2022_PROGRAM_ID);

  console.log("\n==========================================");
  console.log("  CONFIRMED STARTING BALANCES FOR OWNER   ");
  console.log("==========================================");
  console.log(`Public Key:   ${owner.publicKey.toBase58()}`);
  console.log(`SOL Balance:  ${solLamports / 1e9} SOL (${solLamports} lamports)`);
  console.log(`SPYX ATA:     ${ownerSpyxAta.toBase58()}`);
  console.log(`SPYX Balance: ${Number(spyxAcc.amount) / 1e8} SPYX (${spyxAcc.amount} atoms)`);
  console.log(`QQQx ATA:     ${ownerQqqxAta.toBase58()}`);
  console.log(`QQQx Balance: ${Number(qqqxAcc.amount) / 1e8} QQQx (${qqqxAcc.amount} atoms)`);
  console.log(`USDC ATA:     ${ownerUsdcAta.toBase58()}`);
  console.log("==========================================\n");
}

main().catch(console.error);
