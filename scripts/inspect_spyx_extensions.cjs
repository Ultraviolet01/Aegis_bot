const { Connection, PublicKey } = require('@solana/web3.js');
const { getMint, getExtensionTypes } = require('@solana/spl-token');

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const spyx = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
  const mint = await getMint(conn, spyx, "confirmed", new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"));
  console.log("Mint extensions:", getExtensionTypes(mint.tlvData));
  for (const ext of getExtensionTypes(mint.tlvData)) {
    console.log("Extension:", ext);
  }
}

main().catch(console.error);
