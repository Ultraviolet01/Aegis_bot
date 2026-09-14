import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';

const BACKED_AUTHORITIES = new Set([
  '5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq',
  'JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs',
  'S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS',
  '7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj',
]);

const KNOWN_ASSETS: Record<string, { symbol: string; name: string }> = {
  'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W': { symbol: 'SPYx', name: 'SP500 xStock' },
  'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re': { symbol: 'GLDx', name: 'Gold xStock' },
  'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ': { symbol: 'QQQx', name: 'Nasdaq xStock' },
  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh': { symbol: 'NVDAx', name: 'NVIDIA xStock' },
  'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp': { symbol: 'AAPLx', name: 'Apple xStock' },
  'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB': { symbol: 'TSLAx', name: 'Tesla xStock' },
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mintStr = searchParams.get('mint')?.trim();

  if (!mintStr) {
    return NextResponse.json({ error: 'Missing mint parameter' }, { status: 400 });
  }

  let mintPubkey: PublicKey;
  try {
    mintPubkey = new PublicKey(mintStr);
  } catch {
    return NextResponse.json({ error: 'Invalid Solana address format' }, { status: 400 });
  }

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'http://localhost:8899';
  const connection = new Connection(rpcUrl, 'confirmed');

  try {
    const accInfo = await connection.getParsedAccountInfo(mintPubkey);
    if (!accInfo || !accInfo.value) {
      return NextResponse.json({ error: 'Account not found on Solana' }, { status: 404 });
    }

    const programOwner = accInfo.value.owner.toBase58();
    const isToken2022 = programOwner === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
    const isStandardSpl = programOwner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

    if (!isToken2022 && !isStandardSpl) {
      return NextResponse.json({ error: 'Account is not an SPL or Token-2022 mint' }, { status: 400 });
    }

    const parsedData = (accInfo.value.data as any)?.parsed?.info;
    const decimals = parsedData?.decimals ?? 8;
    const freezeAuth = parsedData?.freezeAuthority ?? null;
    const mintAuth = parsedData?.mintAuthority ?? null;
    const extensions = parsedData?.extensions ?? [];

    // Extract metadata
    const metaExt = extensions.find((e: any) => e.extension === 'tokenMetadata');
    const metaPointer = extensions.find((e: any) => e.extension === 'metadataPointer');
    const scaledConfig = extensions.find((e: any) => e.extension === 'scaledUiAmountConfig');

    const known = KNOWN_ASSETS[mintStr];
    let symbol = known?.symbol || metaExt?.state?.symbol || `${mintStr.slice(0, 4)}...${mintStr.slice(-4)}`;
    let name = known?.name || metaExt?.state?.name || `Solana Token (${symbol})`;
    const uri = metaExt?.state?.uri || '';
    const updateAuthority = metaExt?.state?.updateAuthority || metaPointer?.state?.authority || '';

    // Authenticity check: Backed xStocks
    const isBackedUri = typeof uri === 'string' && uri.toLowerCase().includes('backed.fi');
    const isBackedAuth =
      BACKED_AUTHORITIES.has(freezeAuth) ||
      BACKED_AUTHORITIES.has(mintAuth) ||
      BACKED_AUTHORITIES.has(updateAuthority);
    const isKnownXStock = !!KNOWN_ASSETS[mintStr];

    const isVerifiedXStock = isKnownXStock || isBackedUri || isBackedAuth;

    // Multiplier & corporate actions
    let multiplier = 1.0;
    let newMultiplier: number | null = null;
    let activationTime: number | null = null;
    const corporateActions: any[] = [];

    if (scaledConfig?.state) {
      multiplier = Number(scaledConfig.state.multiplier) || 1.0;
      const rawNew = Number(scaledConfig.state.newMultiplier);
      const rawTime = Number(scaledConfig.state.newMultiplierEffectiveTimestamp);

      if (rawTime > 0 && rawNew > 0 && rawNew !== multiplier) {
        newMultiplier = rawNew;
        activationTime = rawTime;

        const pctChange = Math.abs((newMultiplier - multiplier) / multiplier);
        const actionType =
          pctChange < 0.05 ? 'dividend' : newMultiplier > multiplier ? 'split' : 'reverse_split';
        const needsReview = pctChange >= 0.03 && pctChange <= 0.07;

        corporateActions.push({
          mint: mintStr,
          symbol,
          actionType,
          newMultiplier,
          oldMultiplier: multiplier,
          exDate: new Date(activationTime * 1000).toISOString().split('T')[0],
          activationTime,
          applied: Date.now() / 1000 >= activationTime,
          needsReview,
          isDemo: false,
        });
      }
    }

    // Attempt live Jupiter price fetch
    let priceUsd: number | null = null;
    try {
      const atoms = Math.pow(10, decimals);
      const jupUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${mintStr}&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=${atoms}&slippageBps=50`;
      const jupRes = await fetch(jupUrl, { signal: AbortSignal.timeout(4000) });
      if (jupRes.ok) {
        const jupData = await jupRes.json();
        if (jupData.outAmount) {
          priceUsd = Number(jupData.outAmount) / 1e6;
        }
      }
    } catch {
      priceUsd = null;
    }

    const normalizedPriceUsd = priceUsd !== null ? priceUsd * multiplier : null;

    return NextResponse.json({
      mint: mintStr,
      symbol,
      name,
      decimals,
      isToken2022,
      isVerifiedXStock,
      authenticityLabel: isVerifiedXStock
        ? 'Verified xStock'
        : 'Unverified token — proceed with caution',
      multiplier,
      newMultiplier,
      activationTime,
      priceUsd,
      normalizedPriceUsd,
      corporateActions,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to inspect mint account' },
      { status: 500 }
    );
  }
}
