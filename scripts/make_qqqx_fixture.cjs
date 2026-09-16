const fs = require('fs');
const path = require('path');
const { Keypair, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');

const qqqxMint = new PublicKey("Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ");

// Deterministic owner keypair (same as tests/aegis.ts)
const seed = Buffer.alloc(32, 7);
const ownerKp = Keypair.fromSeed(seed);
const ownerPubkey = ownerKp.publicKey;

const ownerQqqxAta = getAssociatedTokenAddressSync(qqqxMint, ownerPubkey, false, TOKEN_2022_PROGRAM_ID);
console.log("Owner pubkey:", ownerPubkey.toBase58());
console.log("Owner QQQx ATA:", ownerQqqxAta.toBase58());

// Base template from real Token-2022 account
const templateB64 = "B+jcLN57I6DXQ/jxJ2tlfYqe6gaVC6Z6jTAzxTxM3k9zh7+/mQRd/kygJCPiMwcTP6iw7o5XTWEajmZSVUq5fRsUOgwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgcAAAAbAAAADwABAAA=";

function makeAccount(pubkey, owner, amount) {
  const data = Buffer.from(templateB64, 'base64');
  data.set(qqqxMint.toBuffer(), 0);
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
const ownerAtaJson = makeAccount(ownerQqqxAta, ownerPubkey, 5000000000n); // 50 QQQx
fs.writeFileSync(path.join(fixturesDir, "owner_qqqx_ata.json"), JSON.stringify(ownerAtaJson, null, 2));

console.log("Generated owner_qqqx_ata.json with 50 QQQx tokens!");
