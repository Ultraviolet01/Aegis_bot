const { PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

async function main() {
  const spyxMint = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
  const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const positionPda = "EPW719q97RdBjk7Yjbr1XbnfvM4AYLq7TPEhfKFwGrF";
  const owner = "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB";
  const ownerUsdcAta = "7woc3ajaGMMXczFYjxon4aQoHH3j126fMUR9c58eHRsK";

  const quoteUrl = new URL("https://api.jup.ag/swap/v1/quote");
  quoteUrl.searchParams.set("inputMint", spyxMint);
  quoteUrl.searchParams.set("outputMint", usdcMint);
  quoteUrl.searchParams.set("amount", "100000000");
  quoteUrl.searchParams.set("slippageBps", "50");

  const res = await fetch(quoteUrl.toString());
  const quote = await res.json();

  const swapRes = await fetch("https://api.jup.ag/swap/v1/swap-instructions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: positionPda,
      destinationTokenAccount: ownerUsdcAta,
      wrapAndUnwrapSol: false,
    }),
  });
  const swapData = await swapRes.json();
  if (!swapData.swapInstruction) {
    console.log("Error fetching swap instructions:", swapData);
    return;
  }
  const accounts = swapData.swapInstruction.accounts;
  console.log("Total swapInstruction accounts:", accounts.length);
  accounts.forEach((a, i) => {
    console.log(`[${i}] ${a.pubkey} isSigner=${a.isSigner} isWritable=${a.isWritable}`);
  });
  const dataBuf = Buffer.from(swapData.swapInstruction.data, "base64");
  console.log("swapInstruction data bytes:", dataBuf.length);
  console.log("swapInstruction discriminator (8 bytes):", dataBuf.subarray(0, 8));
}
main().catch(console.error);
