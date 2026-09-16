const web3 = require("@solana/web3.js");
const fs = require("fs");

(async () => {
  const conn = new web3.Connection("http://127.0.0.1:8899", "confirmed");
  const payer = web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync("/root/.config/solana/id.json", "utf8")))
  );
  const dest = web3.Keypair.generate();
  console.log("Payer:", payer.publicKey.toBase58());
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new web3.Transaction({ recentBlockhash: blockhash, feePayer: payer.publicKey });
  tx.add(
    web3.SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: dest.publicKey,
      lamports: 1000000000,
    })
  );
  tx.sign(payer);
  try {
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    console.log("Sig:", sig);
    const res = await conn.confirmTransaction(sig, "confirmed");
    console.log("Confirmed res:", res);
    console.log("Dest balance:", await conn.getBalance(dest.publicKey, "confirmed"));
  } catch (e) {
    console.error("Error:", e);
  }
})();
