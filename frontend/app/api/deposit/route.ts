import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import idl from '@/lib/aegis.json';

const TEST_WALLET_SEED = Buffer.alloc(32, 7);
const TEST_WALLET_PUBKEY = 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB';

async function confirmSig(conn: Connection, sig: string) {
  for (let i = 0; i < 50; i++) {
    const res = await conn.getSignatureStatus(sig, { searchTransactionHistory: true });
    if (res?.value) {
      if (res.value.err) {
        throw new Error(`Transaction ${sig} failed: ${JSON.stringify(res.value.err)}`);
      }
      if (res.value.confirmationStatus === 'confirmed' || res.value.confirmationStatus === 'finalized') {
        return res.value;
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Transaction ${sig} failed to confirm within timeout`);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      owner: ownerStr,
      mint: mintStr,
      amount,
      slippageTolerance = 0.5,
      policy: userPolicy,
    } = body;

    if (!ownerStr || !mintStr || !amount || Number(amount) <= 0) {
      return NextResponse.json(
        { error: 'Missing required parameters: owner, mint, amount' },
        { status: 400 }
      );
    }

    let ownerPubkey: PublicKey;
    let mintPubkey: PublicKey;
    try {
      ownerPubkey = new PublicKey(ownerStr.trim());
      mintPubkey = new PublicKey(mintStr.trim());
    } catch {
      return NextResponse.json({ error: 'Invalid public key format' }, { status: 400 });
    }

    const rpcUrl =
      process.env.NEXT_PUBLIC_RPC_URL ||
      process.env.SOLANA_RPC_URL ||
      'http://localhost:8899';
    const conn = new Connection(rpcUrl, 'confirmed');

    const programIdStr =
      process.env.NEXT_PUBLIC_AEGIS_PROGRAM_ID || 'C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L';
    const programId = new PublicKey(programIdStr);

    // Identify token program (Token-2022 or SPL)
    const mintAccInfo = await conn.getAccountInfo(mintPubkey);
    if (!mintAccInfo) {
      return NextResponse.json({ error: 'Asset mint account not found on-chain' }, { status: 404 });
    }
    const tokenProgramId = mintAccInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    // Get mint decimals
    let decimals = 8;
    try {
      const parsed = await conn.getParsedAccountInfo(mintPubkey);
      decimals = (parsed?.value?.data as any)?.parsed?.info?.decimals ?? 8;
    } catch {
      decimals = 8;
    }

    const rawAmount = new BN(Math.round(Number(amount) * Math.pow(10, decimals)));

    // Mock/Dummy wallet for Anchor Provider read
    const dummyWallet: anchor.Wallet = {
      publicKey: ownerPubkey,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any) => txs,
      payer: Keypair.generate(),
    };

    const provider = new anchor.AnchorProvider(conn, dummyWallet, {
      commitment: 'confirmed',
    });
    const program = new Program(idl as any, provider) as any;

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('aegis-config')],
      programId
    );

    const cfg = await (program.account as any).aegisConfig.fetch(configPda);
    const totalPositionsBn: BN = cfg.totalPositions;

    const [positionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('position'),
        ownerPubkey.toBuffer(),
        totalPositionsBn.toArrayLike(Buffer, 'le', 8),
      ],
      programId
    );

    const positionVaultAta = await getAssociatedTokenAddress(
      mintPubkey,
      positionPda,
      true,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const ownerTokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      ownerPubkey,
      false,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Build openPosition instruction
    const openPosIx = await program.methods
      .openPosition(rawAmount)
      .accounts({
        config: configPda,
        position: positionPda,
        positionVault: positionVaultAta,
        assetMint: mintPubkey,
        ownerTokenAccount: ownerTokenAccount,
        owner: ownerPubkey,
        tokenProgram: tokenProgramId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    // Prepare setPolicy instruction
    const [policyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('policy'), positionPda.toBuffer()],
      programId
    );

    const drawdownBps = userPolicy?.drawdownThresholdBps || 800; // 8% default
    const deviationBps = userPolicy?.oracleDeviationThresholdBps || 200; // 2% default
    const exitPercentBps = userPolicy?.exitPercentBps || 7500; // 75% default
    const maxSlippageBps = Math.round(Number(slippageTolerance) * 100) || 50; // 0.5% default
    const mode = userPolicy?.mode === 'Strict' ? 2 : 1; // 1 = Normal
    const targetMint = cfg.usdcMint || new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

    const setPolicyIx = await program.methods
      .setPolicy(
        drawdownBps,
        deviationBps,
        exitPercentBps,
        maxSlippageBps,
        mode,
        targetMint
      )
      .accounts({
        config: configPda,
        position: positionPda,
        policy: policyPda,
        owner: ownerPubkey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: ownerPubkey });
    tx.add(openPosIx);
    tx.add(setPolicyIx);

    // If deterministic test wallet is used, sign and broadcast directly on-chain
    if (ownerStr === TEST_WALLET_PUBKEY) {
      const testKeypair = Keypair.fromSeed(TEST_WALLET_SEED);
      tx.sign(testKeypair);

      const rawTx = tx.serialize();
      const sig = await conn.sendRawTransaction(rawTx, { skipPreflight: false });
      await confirmSig(conn, sig);

      return NextResponse.json({
        success: true,
        signature: sig,
        positionPubkey: positionPda.toBase58(),
        policyPubkey: policyPda.toBase58(),
      });
    }

    // Otherwise return serialized transaction for user's wallet adapter to sign
    const serializedTx = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');

    return NextResponse.json({
      success: true,
      transaction: serializedTx,
      positionPubkey: positionPda.toBase58(),
      policyPubkey: policyPda.toBase58(),
    });
  } catch (err: any) {
    console.error('Error in /api/deposit:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to open on-chain position' },
      { status: 500 }
    );
  }
}
