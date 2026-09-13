const fs = require('fs');

async function inspect() {
  const quoteUrl = new URL("https://api.jup.ag/swap/v1/quote");
  quoteUrl.searchParams.set("inputMint", "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
  quoteUrl.searchParams.set("outputMint", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  quoteUrl.searchParams.set("amount", "100000000");
  quoteUrl.searchParams.set("slippageBps", "50");

  console.log("Fetching quote from:", quoteUrl.toString());
  const res = await fetch(quoteUrl.toString());
  const quote = await res.json();
  console.log("ROUTE PLAN:", JSON.stringify(quote.routePlan, null, 2));

  const dummyUser = "11111111111111111111111111111111";
  const swapRes = await fetch("https://api.jup.ag/swap/v1/swap-instructions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: dummyUser,
      wrapAndUnwrapSol: false,
    }),
  });
  const swapData = await swapRes.json();
  console.log("SWAP INSTRUCTION ACCOUNTS:");
  if (swapData.swapInstruction && swapData.swapInstruction.accounts) {
    swapData.swapInstruction.accounts.forEach((acc, i) => {
      console.log(`[${i}] ${acc.pubkey} (signer: ${acc.isSigner}, writable: ${acc.isWritable})`);
    });
  } else {
    console.log(JSON.stringify(swapData, null, 2));
  }

  // Also check token ledger instruction if any
  if (swapData.tokenLedgerInstruction) {
    console.log("TOKEN LEDGER IX:", swapData.tokenLedgerInstruction);
  }
}

inspect().catch(console.error);
