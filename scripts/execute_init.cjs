const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");

async function main() {
  const conn = new Connection("http://127.0.0.1:8899", "confirmed");
  const programId = new PublicKey("C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L");
  const usdcMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

  const authority = Keypair.fromSeed(Buffer.alloc(32, 1));
  const agent = Keypair.fromSeed(Buffer.alloc(32, 2));

  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Agent:", agent.publicKey.toBase58());

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("aegis-config")],
    programId
  );
  console.log("Config PDA:", configPda.toBase58());

  // Check if config already exists
  const existing = await conn.getAccountInfo(configPda, "confirmed");
  if (existing) {
    console.log("Aegis Config ALREADY INITIALIZED on-chain! Data length:", existing.data.length);
    return;
  }

  const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
  const ixData = Buffer.concat([
    discriminator,
    agent.publicKey.toBuffer(),
    usdcMint.toBuffer(),
  ]);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: ixData,
  });

  const tx = new Transaction();
  tx.add(ix);

  console.log("Sending and confirming transaction...");
  try {
    const sig = await sendAndConfirmTransaction(conn, tx, [authority], {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    console.log("Transaction confirmed successfully! Signature:", sig);
  } catch (err) {
    console.error("sendAndConfirmTransaction error:", err);
    if (err.logs) {
      console.error("Transaction logs:", err.logs);
    }
  }

  const verified = await conn.getAccountInfo(configPda, "confirmed");
  if (verified) {
    console.log("SUCCESS: Aegis Config verified on-chain! Size:", verified.data.length, "bytes");
  } else {
    console.log("Failed to verify Aegis Config on-chain.");
  }
}

main().catch(console.error);
