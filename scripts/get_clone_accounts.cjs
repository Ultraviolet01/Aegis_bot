const { Connection, PublicKey } = require('@solana/web3.js');

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  // Raydium CLMM program
  const raydiumProgram = new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
  const progInfo = await conn.getAccountInfo(raydiumProgram);
  console.log("Raydium CLMM program info:", progInfo ? {
    executable: progInfo.executable,
    owner: progInfo.owner.toBase58(),
    dataLen: progInfo.data.length
  } : "not found");

  // If upgradeable loader, get programData
  if (progInfo && progInfo.owner.toBase58() === "BPFLoaderUpgradeab1e11111111111111111111111") {
    // ProgramData address is stored in bytes 4..36
    const programDataPubkey = new PublicKey(progInfo.data.slice(4, 36));
    console.log("Raydium ProgramData:", programDataPubkey.toBase58());
  }

  // Route accounts from our Jupiter inspect
  const accountsToClone = [
    "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLMM Program
    "HzD2cCXXT3UQNjMMY6kDv9w6gZ9qquSdfoGXrLL3LXx", // (we will check if this is ProgramData)
    "9iFER3bpjf1PTTCQCfTRu17EJgvsxo9pVyA9QWwEuX4x", // Raydium CLMM Pool Authority PDA
    "4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw", // Raydium CLMM Pool State
    "AUhtN1KPdVEQ1mh7gy3oHzjWyqHo5RQx1KEiFJdyqAeN", // Token Vault SPYX
    "92aTAYGnUCH28J96EFzD8ELa6ZpdzXw4zqEuX1nD6oD7", // Token Vault USDC
    "9EF8Jq2brNcdm9nfJz7PnrAELxVGyctjDiinYwEsmY3C", // Observation State
    "F8DJtK4wZAu8qEqbz5cpFCpz8z6gcNSk4AmK9GX87GBQ", // Tick Array 0
    "9hGdsny7q6d3wYWe9M8qAuEnZaBjA5K43ZmNygkKPxPF", // Tick Array 1
    "585WvHT4x1pS8hLQXwWLe8Hy2UXpWcvGFazeVhbG8WjC", // Tick Array 2
    "Bdi2v6V8fFcxEwUJEgwK55GLJE3BP3N3q21Bun7DXqLu", // Tick Array 3
  ];

  for (const acc of accountsToClone) {
    const info = await conn.getAccountInfo(new PublicKey(acc));
    console.log(`Account ${acc}: exists=${!!info}, owner=${info?.owner?.toBase58()}, len=${info?.data?.length}`);
  }
}

main().catch(console.error);
