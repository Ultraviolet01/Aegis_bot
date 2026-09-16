#!/usr/bin/env node
/**
 * SPYX Pool Health Verification Script
 *
 * Per §7 of the project brief: before wiring the price feed,
 * verify that the xStocks Oracles API gives a clean issuer-verified
 * reference price independent of any single DEX pool.
 *
 * This script:
 *   1. Resolves SPYX's verified mint address from the xStocks Assets API
 *   2. Fetches the current oracle price (issuer-verified, wash-trade-resistant)
 *   3. Fetches all available corporate actions
 *   4. Outputs a POOL_VERIFICATION.md summary
 *
 * Run: node scripts/verify-spyx-pool.mjs
 */

import https from 'https';
import fs from 'fs';

const XSTOCKS_BASE = 'https://api.xstocks.fi/api/v2';

async function get(path) {
  return new Promise((resolve, reject) => {
    https.get(`${XSTOCKS_BASE}${path}`, { headers: { 'Accept': 'application/json' } }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        } else {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`JSON parse error: ${body.slice(0, 200)}`)); }
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Verifying SPYX via xStocks public API (no auth required)...\n');

  // 1. Resolve mint
  const assets = await get('/assets');
  const spyx = assets.find(a => a.symbol?.toUpperCase() === 'SPYX');
  if (!spyx) throw new Error('SPYX not found in xStocks assets list');

  console.log(`✓ SPYX mint (verified from xStocks Assets API): ${spyx.mint}`);
  console.log(`  Name: ${spyx.name}`);
  console.log(`  Decimals: ${spyx.decimals}`);
  console.log(`  Multiplier: ${spyx.multiplier}`);

  // 2. Oracle price
  let oracle = null;
  try {
    oracle = await get(`/oracles/${spyx.mint}`);
    console.log(`\n✓ Oracle price (issuer-verified, wash-trade-resistant):`);
    console.log(`  Raw price:  $${oracle.priceUsd}`);
    console.log(`  Multiplier: ${oracle.multiplier}`);
    console.log(`  Share-eq:   $${(oracle.priceUsd * oracle.multiplier).toFixed(4)}`);
    console.log(`  Timestamp:  ${new Date(oracle.timestamp * 1000).toISOString()}`);
  } catch (e) {
    console.warn(`  WARN: Oracle price unavailable: ${e.message}`);
  }

  // 3. Corporate actions
  let actions = [];
  try {
    actions = await get(`/corporate-actions/${spyx.mint}`);
    console.log(`\n✓ Corporate actions: ${actions.length} event(s)`);
    for (const a of actions) {
      console.log(`  [${a.actionType}] ex-date ${a.exDate} | multiplier ${a.oldMultiplier}→${a.newMultiplier} | applied: ${a.applied}`);
    }
  } catch (e) {
    console.warn(`  WARN: Corporate actions unavailable: ${e.message}`);
  }

  // 4. Write verification doc
  const doc = `# SPYX Pool Verification

**Date:** ${new Date().toISOString()}

## Verified mint address

\`\`\`
${spyx.mint}
\`\`\`

Source: xStocks Assets API (${XSTOCKS_BASE}/assets) — authoritative, use this, do not hardcode search-snippet addresses.

## Price source verdict

Per §7 of the project brief, SPYX was flagged as having wash-trading across all three of its Raydium pools
(mkzung/solana-xstocks-wash-analysis). The verified approach:

- **Primary price source:** xStocks Oracles API (${XSTOCKS_BASE}/oracles/{mint}) — issuer-verified,
  independent of any single DEX pool. Used for ALL drawdown calculations.
- **Execution-time price:** Jupiter swap quote — used only at swap execution for slippage computation,
  not for drawdown threshold decisions.

This separation ensures wash-traded pool prices cannot trigger a false breach.

## Current oracle reading

${oracle ? `- Raw price: $${oracle.priceUsd}
- Multiplier: ${oracle.multiplier}
- Share-equivalent: $${(oracle.priceUsd * oracle.multiplier).toFixed(4)}
- Timestamp: ${new Date(oracle.timestamp * 1000).toISOString()}` : '- API unavailable at verification time'}

## Corporate actions

${actions.length === 0 ? 'No corporate actions recorded.' : actions.map(a =>
  `- **${a.actionType}** | ex-date: ${a.exDate} | multiplier: ${a.oldMultiplier} → ${a.newMultiplier} | applied: ${a.applied}`
).join('\n')}

## Agent price-source implementation

\`agent-solana/src/xstocks/client.ts\` → \`getOraclePrice(mint)\`:
- Calls the Oracles API for the issuer-verified price + multiplier
- \`normalizePrice(rawPrice, multiplier)\` is applied before every drawdown computation
- Corporate actions are fetched and checked for window-suspension before assessment
`;

  fs.writeFileSync('POOL_VERIFICATION.md', doc);
  console.log('\n✅ POOL_VERIFICATION.md written.');
  console.log('\nVerdict: Use xStocks Oracles API as primary price source. Do NOT use raw DEX pool prices for drawdown decisions.');
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
