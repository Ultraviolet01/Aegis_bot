const { PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

async function main() {
  const spyxMint = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
  const usdcMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

  // Suppose positionPda is some PDA
  const positionPda = new PublicKey("2K8wYyUjA4gZp1r7K2uMhEwPshZ9F4n4q2x8tN1c4vB6");
  const owner = new PublicKey("GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB");

  const positionVaultAta = getAssociatedTokenAddressSync(spyxMint, positionPda, true, TOKEN_2022_PROGRAM_ID);
  const ownerUsdcAta = getAssociatedTokenAddressSync(usdcMint, owner, false, TOKEN_PROGRAM_ID);

  console.log("positionVaultAta (SPYX Token-2022):", positionVaultAta.toBase58());
  console.log("ownerUsdcAta (USDC SPL):", ownerUsdcAta.toBase58());

  const quoteUrl = new URL("https://api.jup.ag/swap/v1/quote");
  quoteUrl.searchParams.set("inputMint", spyxMint.toBase58());
  quoteUrl.searchParams.set("outputMint", usdcMint.toBase58());
  quoteUrl.searchParams.set("amount", "100000000"); // 1 SPYX
  quoteUrl.searchParams.set("slippageBps", "50");

  const res = await fetch(quoteUrl.toString());
  const quote = await res.json();

  const swapRes = await fetch("https://api.jup.ag/swap/v1/swap-instructions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: positionPda.toBase58(),
      destinationTokenAccount: ownerUsdcAta.toBase58(),
      wrapAndUnwrapSol: false,
    }),
  });
  const swapData = await swapRes.json();
  const accounts = swapData.swapInstruction.accounts;
  console.log("Account [1] userTransferAuthority:", accounts[1].pubkey, "(expected positionPda:", positionPda.toBase58(), ")");
  console.log("Account [2] userSourceTokenAccount:", accounts[2].pubkey, "(expected positionVault:", positionVaultAta.toBase58(), ")");
  console.log("Account [3] userDestTokenAccount:", accounts[3].pubkey, "(expected ownerUsdcAta:", ownerUsdcAta.toBase58(), ")");
  console.log("Account [13] remaining userSource:", accounts[13].pubkey);
  console.log("Account [14] remaining userDest:", accounts[14].pubkey);
}

main().catch(console.error);
