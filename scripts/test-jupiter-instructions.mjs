import https from 'https';

async function post(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(data);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Aegis-Checker',
      },
    }, (res) => {
      let resp = '';
      res.on('data', chunk => resp += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(resp) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: resp });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Aegis-Checker' } }, (res) => {
      let resp = '';
      res.on('data', chunk => resp += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(resp) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: resp });
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('Fetching Jupiter Metis quote (WSOL -> USDC)...');
  const quoteRes = await get('https://api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000&slippageBps=50');
  
  if (quoteRes.status !== 200) {
    console.error('Quote failed:', quoteRes);
    return;
  }
  
  const quote = quoteRes.data;
  console.log('Quote received:');
  console.log('  In:', quote.inAmount, 'WSOL');
  console.log('  Out:', quote.outAmount, 'USDC');
  console.log('  Route hops:', quote.routePlan.length);
  console.log('  AMMs:', quote.routePlan.map(r => r.swapInfo.label).join(', '));

  console.log('\nRequesting swap-instructions from Jupiter Metis API...');
  const userPublicKey = 'CLeUkwdpBXHjNboaS8KbDt8EWqN2ej3zaeibYDfs2xPm';
  const swapInstRes = await post('https://api.jup.ag/swap/v1/swap-instructions', {
    quoteResponse: quote,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
  });

  if (swapInstRes.status !== 200) {
    console.error('Swap instructions failed:', swapInstRes);
    return;
  }

  const { swapInstruction, computeBudgetInstructions, setupInstructions, cleanupInstruction, addressLookupTableAddresses } = swapInstRes.data;

  console.log('\nJupiter Swap Instruction Breakdown:');
  console.log('  Program ID:', swapInstruction.programId);
  console.log('  Instruction accounts count:', swapInstruction.accounts.length);
  console.log('  Instruction data byte length (base64 decoded):', Buffer.from(swapInstruction.data, 'base64').length, 'bytes');
  console.log('  Address Lookup Tables (ALTs):', addressLookupTableAddresses?.length || 0);
  console.log('  Setup instructions count:', setupInstructions?.length || 0);
  console.log('  Compute budget instructions count:', computeBudgetInstructions?.length || 0);

  // Calculate estimated total transaction size with Solana V0 message
  // 1 signer signature = 64 bytes
  // Message header: 3 bytes
  // Account keys: 1 byte count + (numAccounts * 32)
  // Recent blockhash: 32 bytes
  // Compiled instructions: header + accounts index + data length
  const numAccounts = swapInstruction.accounts.length + 5; // user, programs, etc.
  const rawDataLen = Buffer.from(swapInstruction.data, 'base64').length;
  console.log(`\nTransaction size analysis (Solana IPv6 MTU limit: 1232 bytes):`);
  console.log(`  Single-hop Jupiter swap requires ~${swapInstruction.accounts.length} accounts.`);
  if (addressLookupTableAddresses && addressLookupTableAddresses.length > 0) {
    console.log(`  Uses ${addressLookupTableAddresses.length} Address Lookup Tables (ALTs), compressing 32-byte pubkeys to 1-byte indices!`);
  }
}

run().catch(console.error);
