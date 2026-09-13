const { Connection, PublicKey } = require('@solana/web3.js');

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const acc = new PublicKey("2j4WinR9FZHGtUymruMvdBzLEo6Ky5CLpHCpzfYms5Yq");
  const info = await conn.getAccountInfo(acc);
  console.log("Account info:", info ? {
    owner: info.owner.toBase58(),
    len: info.data.length,
    dataHex: info.data.slice(0, 72).toString('hex')
  } : "not found");

  if (info) {
    // Unpack SPL token account: mint (32), owner (32), amount (8)
    const mint = new PublicKey(info.data.slice(0, 32));
    const owner = new PublicKey(info.data.slice(32, 64));
    const amount = info.data.readBigUInt64LE(64);
    console.log("Parsed token account:", {
      mint: mint.toBase58(),
      owner: owner.toBase58(),
      amount: amount.toString()
    });
  }
}

main().catch(console.error);
