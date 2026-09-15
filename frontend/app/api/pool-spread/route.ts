import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';

/**
 * Live two-venue price spread for an xStock mint.
 *
 * The dashboard's "oracle sanity" figure has to come from the same method the
 * guardian uses, or it is decoration. This route quotes the asset-to-target pair
 * on Orca Whirlpool and on Raydium CLMM through Jupiter and returns the spread,
 * which is exactly what the agent computes before it will act.
 *
 * Threshold mirrors DIVERGENCE_THRESHOLD_BPS in
 * agent-solana/src/price/multiPool.ts.
 */

const DIVERGENCE_THRESHOLD_BPS = 150;

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function rpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    'http://localhost:8899'
  );
}

async function quote(
  conn: Connection,
  inputMint: string,
  outputMint: string,
  amountAtoms: number,
  dex: string,
): Promise<number | null> {
  const url = new URL('https://api.jup.ag/swap/v1/quote');
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', amountAtoms.toString());
  url.searchParams.set('slippageBps', '50');
  url.searchParams.set('dexes', dex);
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.outAmount ? Number(data.outAmount) : null;
  } catch {
    return null;
  }
}

async function decimalsOf(conn: Connection, mint: string): Promise<number | null> {
  try {
    const acc = await conn.getParsedAccountInfo(new PublicKey(mint));
    const info = (acc?.value?.data as any)?.parsed?.info;
    return typeof info?.decimals === 'number' ? info.decimals : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get('mint');
  const target = req.nextUrl.searchParams.get('target') || USDC_MINT;

  if (!mint) {
    return NextResponse.json({ error: 'mint query parameter is required' }, { status: 400 });
  }

  try {
    new PublicKey(mint);
    new PublicKey(target);
  } catch {
    return NextResponse.json({ error: 'mint and target must be valid base58 addresses' }, { status: 400 });
  }

  const conn = new Connection(rpcUrl(), 'confirmed');

  const [inputDecimals, outputDecimals] = await Promise.all([
    decimalsOf(conn, mint),
    decimalsOf(conn, target),
  ]);

  if (inputDecimals === null || outputDecimals === null) {
    return NextResponse.json({
      ok: false,
      reason: 'Mint metadata unavailable — cannot size the reference quote',
    });
  }

  const referenceTokens = 1;
  const referenceAtoms = Math.floor(referenceTokens * Math.pow(10, inputDecimals));

  const [whirlpoolOut, raydiumOut] = await Promise.all([
    quote(conn, mint, target, referenceAtoms, 'Whirlpool'),
    quote(conn, mint, target, referenceAtoms, 'Raydium CLMM'),
  ]);

  // Fail-closed, same as the guardian: without both venues there is no sanity
  // figure to report, and inventing one is worse than showing nothing.
  if (whirlpoolOut === null || raydiumOut === null) {
    const missing = [
      whirlpoolOut === null ? 'Orca Whirlpool' : null,
      raydiumOut === null ? 'Raydium CLMM' : null,
    ].filter(Boolean);
    return NextResponse.json({
      ok: false,
      reason: `No live quote from ${missing.join(' or ')}`,
    });
  }

  const whirlpoolPrice = whirlpoolOut / Math.pow(10, outputDecimals) / referenceTokens;
  const raydiumPrice = raydiumOut / Math.pow(10, outputDecimals) / referenceTokens;
  const minPrice = Math.min(whirlpoolPrice, raydiumPrice);

  if (!(minPrice > 0)) {
    return NextResponse.json({ ok: false, reason: 'Non-positive pool price returned' });
  }

  const spreadBps = Math.round((Math.abs(whirlpoolPrice - raydiumPrice) / minPrice) * 10_000);

  return NextResponse.json({
    ok: true,
    spreadBps,
    whirlpoolPrice,
    raydiumPrice,
    thresholdBps: DIVERGENCE_THRESHOLD_BPS,
    status: spreadBps > DIVERGENCE_THRESHOLD_BPS ? 'DIVERGENT' : 'OK',
  });
}
