const fs = require('fs');
const path = require('path');
const { Keypair, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const BN = require('bn.js');

const programId = new PublicKey("C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L");

const MINTS = {
  SPYX: new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W"),
  QQQX: new PublicKey("Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ"),
  GLDX: new PublicKey("Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re"),
};

const ownerKp = Keypair.fromSeed(Buffer.alloc(32, 7));
const ownerPubkey = ownerKp.publicKey;

const templateB64 = "B+jcLN57I6DXQ/jxJ2tlfYqe6gaVC6Z6jTAzxTxM3k9zh7+/mQRd/kygJCPiMwcTP6iw7o5XTWEajmZSVUq5fRsUOgwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgcAAAAbAAAADwABAAA=";

function makeAccount(pubkey, mint, owner, amount) {
  const data = Buffer.from(templateB64, 'base64');
  data.set(mint.toBuffer(), 0);
  data.set(owner.toBuffer(), 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  data.writeUInt8(1, 108); // state = Initialized

  return {
    pubkey: pubkey.toBase58(),
    account: {
      lamports: 10000000,
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

const lines = [];

for (const [symbol, mint] of Object.entries(MINTS)) {
  for (let i = 0; i <= 10; i++) {
    const indexBn = new BN(i);
    const [positionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        ownerPubkey.toBuffer(),
        indexBn.toArrayLike(Buffer, "le", 8),
      ],
      programId
    );

    const vaultAta = getAssociatedTokenAddressSync(
      mint,
      positionPda,
      true,
      TOKEN_2022_PROGRAM_ID
    );

    const fixtureName = `vault_${symbol.toLowerCase()}_${i}.json`;
    const accJson = makeAccount(vaultAta, mint, positionPda, 0n);
    fs.writeFileSync(path.join(fixturesDir, fixtureName), JSON.stringify(accJson, null, 2));

    lines.push(`  --account ${vaultAta.toBase58()} "$PROJECT_ROOT/tests/fixtures/${fixtureName}" \\`);
  }
}

console.log(`Generated fixtures for all assets (0..10)!`);
fs.writeFileSync(path.join(__dirname, "vault_fixture_args.txt"), lines.join("\n"));
console.log(`Saved args snippet to scripts/vault_fixture_args.txt`);
