const { Connection, PublicKey } = require('@solana/web3.js');
const fs = require('fs');

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const acc = new PublicKey("2tvEcFk5q3oR9VpiL2xKDAXtRyJc3f98Qb8hxvKjGxKx");
  const info = await conn.getAccountInfo(acc);
  console.log("Account 2tv... len:", info.data.length);
  console.log("Account 2tv... owner:", info.owner.toBase58());
  console.log("Account 2tv... lamports:", info.lamports);
  console.log("Account data (base64):", info.data.toString('base64'));

  // Let's decode the raw SPL token fields:
  // 0..32: mint
  // 32..64: owner
  // 64..72: amount (u64 LE)
  // 72..108: delegate (COption<Pubkey>)
  // 108: state (1 = initialized)
  // 109..121: isNative (COption<u64>)
  // 121..129: delegatedAmount (u64 LE)
  // 129..165: closeAuthority (COption<Pubkey>)
  console.log("Mint in data:", new PublicKey(info.data.slice(0, 32)).toBase58());
  console.log("Owner in data:", new PublicKey(info.data.slice(32, 64)).toBase58());
  console.log("Amount in data:", info.data.readBigUInt64LE(64).toString());
}

main().catch(console.error);
