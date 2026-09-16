const web3 = require("@solana/web3.js");
const fs = require("fs");

async function main() {
  const conn = new web3.Connection("http://127.0.0.1:8899", "confirmed");
  const payer = web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8")))
  );
  console.log("Payer:", payer.publicKey.toBase58());
  const dest = web3.Keypair.generate();
  
  // Try sending transaction with fresh blockhash with commitment "finalized"
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const bh = await conn.getLatestBlockhash("finalized");
      console.log("Blockhash:", bh.blockhash);
      const tx = new web3.Transaction({
        recentBlockhash: bh.blockhash,
        feePayer: payer.publicKey,
      }).add(
        web3.SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: dest.publicKey,
          lamports: 10 * web3.LAMPORTS_PER_SOL,
        })
      );
      tx.sign(payer);
      const sig = await conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
      });
      console.log("Tx sig:", sig);
      
      for (let p = 0; p < 20; p++) {
        const bal = await conn.getBalance(dest.publicKey, "confirmed");
        if (bal > 0) {
          console.log("Success! Balance:", bal / web3.LAMPORTS_PER_SOL, "SOL");
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (e) {
      console.error("Attempt error:", e.message);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main().catch(console.error);
