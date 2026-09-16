const { Connection, PublicKey } = require('@solana/web3.js');

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const spyx = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
  const info = await conn.getAccountInfo(spyx);
  console.log("SPYX mint info:", {
    owner: info.owner.toBase58(),
    len: info.data.length,
    lamports: info.lamports,
  });
}

main().catch(console.error);
