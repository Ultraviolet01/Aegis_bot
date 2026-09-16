const { Connection, PublicKey } = require('@solana/web3.js');
const { getMint } = require('@solana/spl-token');

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const spyxMint = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
  const mintInfo = await getMint(conn, spyxMint, "confirmed", new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"));
  console.log("SPYX Mint Info:", {
    address: mintInfo.address.toBase58(),
    mintAuthority: mintInfo.mintAuthority ? mintInfo.mintAuthority.toBase58() : null,
    freezeAuthority: mintInfo.freezeAuthority ? mintInfo.freezeAuthority.toBase58() : null,
    supply: mintInfo.supply.toString(),
    decimals: mintInfo.decimals,
  });

  // Also query largest accounts for SPYX
  const largest = await conn.getTokenLargestAccounts(spyxMint);
  console.log("SPYX Largest accounts:", largest.value.slice(0, 5));
}

main().catch(console.error);
