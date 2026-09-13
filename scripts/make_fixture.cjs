const fs = require('fs');
const path = require('path');
const { Keypair, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const BN = require('bn.js');

const programId = new PublicKey("C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L");
const spyxMint = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");

// Deterministic owner keypair
const seed = Buffer.alloc(32, 7);
const ownerKp = Keypair.fromSeed(seed);
const ownerPubkey = ownerKp.publicKey;
console.log("Owner pubkey:", ownerPubkey.toBase58());

const ownerSpyxAta = getAssociatedTokenAddressSync(spyxMint, ownerPubkey, false, TOKEN_2022_PROGRAM_ID);
console.log("Owner SPYX ATA:", ownerSpyxAta.toBase58());

// Derive positionPda & positionVaultAta
const indexBn = new BN(0);
const [positionPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("position"),
    ownerPubkey.toBuffer(),
    indexBn.toArrayLike(Buffer, "le", 8),
  ],
  programId
);

const positionVaultAta = getAssociatedTokenAddressSync(
  spyxMint,
  positionPda,
  true,
  TOKEN_2022_PROGRAM_ID
);
console.log("Position PDA:", positionPda.toBase58());
console.log("Position Vault ATA:", positionVaultAta.toBase58());

// Base template from real mainnet SPYX Token-2022 account (2tvEcFk5q3oR9VpiL2xKDAXtRyJc3f98Qb8hxvKjGxKx)
const templateB64 = "B+jcLN57I6DXQ/jxJ2tlfYqe6gaVC6Z6jTAzxTxM3k9zh7+/mQRd/kygJCPiMwcTP6iw7o5XTWEajmZSVUq5fRsUOgwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgcAAAAbAAAADwABAAA=";

function makeAccount(pubkey, owner, amount) {
  const data = Buffer.from(templateB64, 'base64');
  data.set(spyxMint.toBuffer(), 0);
  data.set(owner.toBuffer(), 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  data.writeUInt8(1, 108); // state = Initialized

  return {
    pubkey: pubkey.toBase58(),
    account: {
      lamports: 10000000, // 0.01 SOL rent exempt
      data: [data.toString('base64'), "base64"],
      owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      executable: false,
      rentEpoch: 0,
      space: data.length,
    },
  };
}

const fixturesDir = path.resolve(__dirname, "../tests/fixtures");
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

// 1. Owner SPYX ATA (funded with 10 SPYX)
const ownerAtaJson = makeAccount(ownerSpyxAta, ownerPubkey, 1000000000n);
fs.writeFileSync(path.join(fixturesDir, "owner_spyx_ata.json"), JSON.stringify(ownerAtaJson, null, 2));

// 2. Position Vault ATA (owned by positionPda, balance 0)
const vaultAtaJson = makeAccount(positionVaultAta, positionPda, 0n);
fs.writeFileSync(path.join(fixturesDir, "position_vault_ata.json"), JSON.stringify(vaultAtaJson, null, 2));

console.log("Wrote both fixtures to tests/fixtures!");
