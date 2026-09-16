const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} = require("@solana/web3.js");

async function main() {
  const conn = new Connection("http://127.0.0.1:8899", "processed");
  const programId = new PublicKey("C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L");
  const usdcMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

  const authority = Keypair.fromSeed(Buffer.alloc(32, 1));
  const agent = Keypair.fromSeed(Buffer.alloc(32, 2));

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("aegis-config")],
    programId
  );
  console.log("Config PDA:", configPda.toBase58());

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
  tx.feePayer = authority.publicKey;

  console.log("Simulating with replaceRecentBlockhash: true...");
  const sim = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "processed",
  });
  console.log("Sim result:", JSON.stringify(sim, null, 2));
}

main().catch(console.error);
