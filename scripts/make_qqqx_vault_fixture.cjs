const fs = require("fs");
const path = require("path");
const { PublicKey, Keypair } = require("@solana/web3.js");
const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } = require("@solana/spl-token");
const BN = require("bn.js");

const programId = new PublicKey("C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L");
const owner = Keypair.fromSeed(Buffer.alloc(32, 7)); // GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB
const qqqxMint = new PublicKey("Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ");

// QQQX position will be index 1 (since SPYX is index 0)
const indexBn = new BN(1);
const [qqqxPositionPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("position"),
    owner.publicKey.toBuffer(),
    indexBn.toArrayLike(Buffer, "le", 8),
  ],
  programId
);

const qqqxPositionVaultAta = getAssociatedTokenAddressSync(
  qqqxMint,
  qqqxPositionPda,
  true,
  TOKEN_2022_PROGRAM_ID
);

console.log("QQQX Position PDA (index 1):", qqqxPositionPda.toBase58());
console.log("QQQX Position Vault ATA:", qqqxPositionVaultAta.toBase58());

// Build 179-byte Token-2022 account data:
// [0..32]: mint
// [32..64]: owner (authority)
// [64..72]: amount (0)
// [72..73]: state (1 = Initialized)
// [73..77]: is_native (0)
// [77..85]: delegated_amount (0)
// [85..121]: close_authority (COption::None = 0, 36 bytes)
// [121..179]: extension bytes (matching position_vault_ata.json)
const baseFixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../tests/fixtures/position_vault_ata.json"), "utf8")
);
const buf = Buffer.from(baseFixture.account.data[0], "base64");

// Replace mint (0..32) and owner (32..64)
qqqxMint.toBuffer().copy(buf, 0);
qqqxPositionPda.toBuffer().copy(buf, 32);

const fixture = {
  pubkey: qqqxPositionVaultAta.toBase58(),
  account: {
    lamports: 10000000,
    data: [buf.toString("base64"), "base64"],
    owner: TOKEN_2022_PROGRAM_ID.toBase58(),
    executable: false,
    rentEpoch: 0,
    space: buf.length,
  },
};

const outPath = path.resolve(__dirname, "../tests/fixtures/qqqx_position_vault_ata.json");
fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2));
console.log(`Wrote QQQX vault fixture to ${outPath}`);
