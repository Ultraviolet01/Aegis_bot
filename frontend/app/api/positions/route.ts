import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

export const dynamic = 'force-dynamic';

const KNOWN_ASSETS: Record<string, { symbol: string; name: string; decimals: number }> = {
  'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W': { symbol: 'SPYX', name: 'S&P 500 Tokenized', decimals: 8 },
  'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re': { symbol: 'GLDX', name: 'Physical Gold Tokenized', decimals: 8 },
  'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ': { symbol: 'QQQX', name: 'Nasdaq 100 Tokenized', decimals: 8 },
  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh': { symbol: 'NVDAX', name: 'NVIDIA Tokenized', decimals: 8 },
  'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp': { symbol: 'AAPLX', name: 'Apple Tokenized', decimals: 8 },
  'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB': { symbol: 'TSLAX', name: 'Tesla Tokenized', decimals: 8 },
};

const DEFAULT_PRICES: Record<string, number> = {
  SPYX: 539.20,
  GLDX: 188.45,
  QQQX: 492.10,
  NVDAX: 128.50,
  AAPLX: 224.30,
  TSLAX: 245.80,
};

const TARGET_MINTS: Record<string, string> = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 'USDC',
  'So11111111111111111111111111111111111111112': 'SOL',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ownerStr = (searchParams.get('owner') || searchParams.get('wallet'))?.trim();

  if (!ownerStr) {
    return NextResponse.json({ error: 'Missing owner parameter' }, { status: 400 });
  }

  let ownerPubkey: PublicKey;
  try {
    ownerPubkey = new PublicKey(ownerStr);
  } catch {
    return NextResponse.json({ error: 'Invalid owner address' }, { status: 400 });
  }

  const rpcUrl =
    process.env.NEXT_PUBLIC_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    'http://localhost:8899';
  const connection = new Connection(rpcUrl, 'confirmed');

  const programIdStr =
    process.env.NEXT_PUBLIC_AEGIS_PROGRAM_ID || 'C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L';
  const programId = new PublicKey(programIdStr);

  try {
    // 1. Fetch real on-chain Position accounts owned by this wallet
    // In Position struct:
    // Offset 0..8: Anchor discriminator
    // Offset 8..40: owner: Pubkey (32 bytes)
    const positionAccounts = await connection.getProgramAccounts(programId, {
      filters: [
        {
          memcmp: {
            offset: 8,
            bytes: ownerPubkey.toBase58(),
          },
        },
      ],
    });

    const parsedPositions = [];

    for (const { pubkey, account } of positionAccounts) {
      const data = account.data;
      if (data.length < 90) continue;

      // Position layout:
      // 0..8: discriminator
      // 8..40: owner (Pubkey)
      // 40..72: asset_mint (Pubkey)
      // 72..80: amount (u64 LE)
      // 80: policy Option tag (1 = Some, 0 = None)
      // If Some:
      //   81..113: policy (Pubkey)
      //   113: paused (bool)
      //   114: bump (u8)
      //   115..123: index (u64 LE)
      // If None:
      //   81: paused (bool)
      //   82: bump (u8)
      //   83..91: index (u64 LE)
      const assetMint = new PublicKey(data.subarray(40, 72)).toBase58();
      const rawAmount = data.readBigUInt64LE(72);
      const hasPolicy = data[80] === 1;

      let policyPubkey: string | null = null;
      let paused = false;
      let index = 0;

      if (hasPolicy && data.length >= 115) {
        policyPubkey = new PublicKey(data.subarray(81, 113)).toBase58();
        paused = data[113] === 1;
        index = data.length >= 123 ? Number(data.readBigUInt64LE(115)) : 0;
      } else {
        paused = data[81] === 1;
        index = data.length >= 91 ? Number(data.readBigUInt64LE(83)) : 0;
      }

      const known = KNOWN_ASSETS[assetMint];
      const symbol = known?.symbol || `${assetMint.slice(0, 4)}...${assetMint.slice(-4)}`;
      const name = known?.name || `xStock (${symbol})`;
      const decimals = known?.decimals || 8;
      const balance = Number(rawAmount) / Math.pow(10, decimals);
      if (balance <= 0) continue;

      // Default policy
      let policy = {
        drawdownBps: 800,
        exitBps: 5000,
        target: 'USDC',
        mode: 'Normal',
      };

      if (policyPubkey) {
        try {
          const polAcc = await connection.getAccountInfo(new PublicKey(policyPubkey));
          if (polAcc && polAcc.data.length >= 89) {
            const polData = polAcc.data;
            // Policy layout:
            // 0..8: discriminator
            // 8..40: position (Pubkey)
            // 40..42: drawdown_threshold_bps (u16 LE)
            // 42..44: deviation_threshold_bps (u16 LE)
            // 44..46: exit_percent_bps (u16 LE)
            // 46..48: max_slippage_bps (u16 LE)
            // 48: mode (u8: 0=Inactive, 1=Normal, 2=Strict)
            // 49..81: target_mint (Pubkey)
            const targetMintKey = new PublicKey(polData.subarray(49, 81)).toBase58();
            policy = {
              drawdownBps: polData.readUInt16LE(40),
              exitBps: polData.readUInt16LE(44),
              target: TARGET_MINTS[targetMintKey] || 'USDC',
              mode: polData[48] === 2 ? 'Strict' : polData[48] === 1 ? 'Normal' : 'Inactive',
            };
          }
        } catch {
          // fallback policy
        }
      }

      // Check multiplier on mint
      let multiplier = 1.0;
      try {
        const mintAcc = await connection.getParsedAccountInfo(new PublicKey(assetMint));
        const extensions = (mintAcc?.value?.data as any)?.parsed?.info?.extensions || [];
        const scaled = extensions.find((e: any) => e.extension === 'scaledUiAmountConfig');
        if (scaled?.state?.multiplier) {
          multiplier = Number(scaled.state.multiplier) || 1.0;
        }
      } catch {
        multiplier = 1.0;
      }

      const priceUsd = DEFAULT_PRICES[symbol] || 100.0;
      const headroomPct = +(policy.drawdownBps / 100).toFixed(1);

      parsedPositions.push({
        symbol,
        name,
        mint: assetMint,
        positionPubkey: pubkey.toBase58(),
        balance,
        priceUsd,
        multiplier,
        policy,
        headroomPct,
        status: paused ? ('monitoring' as const) : ('protected' as const),
        index,
      });
    }

    // 2. Fetch real unvaulted wallet token holdings for deposit selector
    const walletBalances: Record<string, number> = {};
    try {
      const [t22Accs, splAccs] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(ownerPubkey, { programId: TOKEN_2022_PROGRAM_ID }),
        connection.getParsedTokenAccountsByOwner(ownerPubkey, { programId: TOKEN_PROGRAM_ID }),
      ]);

      const allTokenAccounts = [...t22Accs.value, ...splAccs.value];
      for (const tAcc of allTokenAccounts) {
        const parsed = (tAcc.account.data as any)?.parsed?.info;
        if (parsed) {
          const mint = parsed.mint;
          const uiAmount = parsed.tokenAmount?.uiAmount || 0;
          walletBalances[mint] = (walletBalances[mint] || 0) + uiAmount;
        }
      }
    } catch {
      // ignore wallet balance fetch error
    }

    const totalGuardedUsd = parsedPositions.reduce(
      (acc, p) => acc + p.balance * p.priceUsd * p.multiplier,
      0
    );

    return NextResponse.json({
      owner: ownerStr,
      positions: parsedPositions,
      totalGuardedUsd,
      count: parsedPositions.length,
      walletBalances,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to query on-chain positions' },
      { status: 500 }
    );
  }
}
