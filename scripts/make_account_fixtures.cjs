const fs = require("fs");
const path = require("path");
const { Keypair } = require("@solana/web3.js");

const accounts = [
  { name: "authority", seed: 1 },
  { name: "agent", seed: 2 },
  { name: "owner", seed: 7 },
  { name: "attacker", seed: 4 },
];

const fixturesDir = path.resolve(__dirname, "../tests/fixtures");

for (const { name, seed } of accounts) {
  const kp = Keypair.fromSeed(Buffer.alloc(32, seed));
  const pubkey = kp.publicKey.toBase58();
  const fixture = {
    pubkey,
    account: {
      lamports: 50_000_000_000, // 50 SOL
      data: ["", "base64"],
      owner: "11111111111111111111111111111111",
      executable: false,
      rentEpoch: 0,
      space: 0,
    },
  };
  const filePath = path.join(fixturesDir, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2));
  console.log(`Wrote ${name} fixture: pubkey=${pubkey}, file=${filePath}`);
}
