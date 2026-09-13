async function test() {
  const quoteUrl = new URL("https://api.jup.ag/swap/v1/quote");
  quoteUrl.searchParams.set("inputMint", "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
  quoteUrl.searchParams.set("outputMint", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  quoteUrl.searchParams.set("amount", "100000000");
  quoteUrl.searchParams.set("slippageBps", "50");
  const res = await fetch(quoteUrl.toString());
  const quote = await res.json();

  const userPublicKey = "4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw"; // sample
  const destinationTokenAccount = "92aTAYGnUCH28J96EFzD8ELa6ZpdzXw4zqEuX1nD6oD7"; // sample

  const swapRes = await fetch("https://api.jup.ag/swap/v1/swap-instructions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      destinationTokenAccount,
      wrapAndUnwrapSol: false,
    }),
  });
  const swapData = await swapRes.json();
  console.log("destinationTokenAccount accepted:", !swapData.error);
  if (swapData.swapInstruction) {
    console.log("Account 3 (dest):", swapData.swapInstruction.accounts[3]);
    console.log("Account 14 (remaining dest):", swapData.swapInstruction.accounts[14]);
  } else {
    console.log("Error:", swapData);
  }
}
test().catch(console.error);
