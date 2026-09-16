const { Connection, PublicKey } = require('@solana/web3.js');

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const pool = new PublicKey("4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw");
  const sigs = await conn.getSignaturesForAddress(pool, { limit: 5 });
  console.log("Found signatures:", sigs.map(s => s.signature));

  for (const s of sigs) {
    const tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
    if (!tx || !tx.meta) continue;
    // Check postTokenBalances
    for (const b of tx.meta.postTokenBalances || []) {
      if (b.mint === "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W") {
        console.log("Found SPYX token balance in tx:", {
          accountIndex: b.accountIndex,
          owner: b.owner,
          amount: b.uiTokenAmount.amount,
          pubkey: tx.transaction.message.accountKeys[b.accountIndex]?.pubkey?.toBase58?.() || tx.transaction.message.accountKeys[b.accountIndex]
        });
      }
    }
  }
}

main().catch(console.error);
