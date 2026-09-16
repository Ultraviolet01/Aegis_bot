const { Connection, PublicKey } = require('@solana/web3.js');

async function check() {
  const devnetConn = new Connection('https://api.devnet.solana.com', 'confirmed');
  const spyxMint = new PublicKey('XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W');
  const jupProgram = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
  
  const spyxInfo = await devnetConn.getAccountInfo(spyxMint);
  const jupInfo = await devnetConn.getAccountInfo(jupProgram);
  
  console.log('Devnet SPYX Mint exists:', !!spyxInfo);
  console.log('Devnet Jupiter v6 exists:', !!jupInfo);
}

check().catch(console.error);
