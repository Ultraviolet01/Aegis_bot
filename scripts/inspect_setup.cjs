async function main() {
  const spyxMint = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
  const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const positionPda = "EPW719q97RdBjk7Yjbr1XbnfvM4AYLq7TPEhfKFwGrF";
  const ownerUsdcAta = "7woc3ajaGMMXczFYjxon4aQoHH3j126fMUR9c58eHRsK";

  const quoteRes = await fetch("https://api.jup.ag/swap/v1/quote?inputMint=" + spyxMint + "&outputMint=" + usdcMint + "&amount=100000000&slippageBps=50");
  const quote = await quoteRes.json();

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
  console.log("setupInstructions count:", swapData.setupInstructions?.length);
  if (swapData.setupInstructions) {
    swapData.setupInstructions.forEach((ix, i) => {
      console.log(`setupIx[${i}] program: ${ix.programId}, accounts:`, ix.accounts.map(a => a.pubkey));
    });
  }
  console.log("cleanupInstruction:", swapData.cleanupInstruction ? swapData.cleanupInstruction.programId : "none");
}
main().catch(console.error);
