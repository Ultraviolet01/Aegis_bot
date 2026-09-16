const anchor = require("@coral-xyz/anchor");
const { Program, BN } = anchor;
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} = require("@solana/web3.js");
const {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");

function log(...args) {
  console.error(...args);
}

async function confirmSig(conn, sig) {
  for (let i = 0; i < 50; i++) {
    const res = await conn.getSignatureStatus(sig);
    if (res?.value) {
      if (res.value.err) {
        throw new Error(`Transaction ${sig} failed: ${JSON.stringify(res.value.err)}`);
      }
      return res.value;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Transaction ${sig} failed to confirm within timeout`);
}

async function main() {
  log("Starting deposit test...");
  const rpcUrl = "http://127.0.0.1:8899";
  const conn = new Connection(rpcUrl, "confirmed");

  const idlPath = path.resolve(__dirname, "../target/idl/aegis.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const programId = new PublicKey("C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L");

  const owner = Keypair.fromSeed(Buffer.alloc(32, 7));
  log("Owner:", owner.publicKey.toBase58());

  const wallet = new anchor.Wallet(owner);
  const provider = new anchor.AnchorProvider(conn, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new Program(idl, provider);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("aegis-config")],
    programId
  );

  const cfg = await program.account.aegisConfig.fetch(configPda);
  log("Total positions in config before:", cfg.totalPositions.toNumber());

  const assetMint = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W"); // SPYX
  const tokenProgramId = TOKEN_2022_PROGRAM_ID;

  const [positionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      owner.publicKey.toBuffer(),
      cfg.totalPositions.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
  log("Derived Position PDA:", positionPda.toBase58());

  const positionVaultAta = await getAssociatedTokenAddress(
    assetMint,
    positionPda,
    true,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  log("Derived Position Vault ATA:", positionVaultAta.toBase58());

  const ownerTokenAccount = await getAssociatedTokenAddress(
    assetMint,
    owner.publicKey,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  log("Owner Token Account:", ownerTokenAccount.toBase58());

  // Deposit 1 SPYX (1e8 atoms)
  const depositAmount = new BN(1 * 1e8);

  log("Building openPosition transaction...");
  const tx = await program.methods
    .openPosition(depositAmount)
    .accounts({
      config: configPda,
      position: positionPda,
      positionVault: positionVaultAta,
      assetMint: assetMint,
      ownerTokenAccount: ownerTokenAccount,
      owner: owner.publicKey,
      tokenProgram: tokenProgramId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = owner.publicKey;
  tx.sign(owner);

  log("Sending raw transaction...");
  const sig = await conn.sendRawTransaction(tx.serialize());
  log("Sent tx, sig:", sig);
  await confirmSig(conn, sig);
  log("openPosition confirmed! Tx:", sig);

  const posAcc = await program.account.position.fetch(positionPda);
  log("Position created successfully on-chain!");
  log("Owner:", posAcc.owner.toBase58());
  log("Asset mint:", posAcc.assetMint.toBase58());
  log("Amount:", posAcc.amount.toString());
  log("Policy PDA:", posAcc.policy?.toBase58() || "None");
}

main().catch((e) => {
  log("Test deposit error:", e);
  process.exit(1);
});
