import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, getScaledUiAmountConfig, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

async function main() {
  console.log('Fetching Jupiter strict / xstock tokens...');
  try {
    const res = await fetch('https://tokens.jup.ag/tokens?tags=community');
    const tokens = await res.json();
    const xstocks = tokens.filter(t => 
      (t.symbol && (t.symbol.endsWith('x') || t.symbol.endsWith('X') || t.tags?.includes('xstock') || t.name?.toLowerCase().includes('backed')))
    );
    console.log(`Found ${xstocks.length} candidate tokens:`);
    xstocks.slice(0, 15).forEach(t => console.log(`${t.symbol}: ${t.address} (${t.name})`));
  } catch (e) {
    console.error('Fetch error:', e.message);
  }
}

main();
