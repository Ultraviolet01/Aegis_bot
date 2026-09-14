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
    const { owner: ownerStr, positionPubkey: posStr, amount } = body;

    if (!ownerStr || !posStr) {
      return NextResponse.json(
        { error: 'Missing required parameters: owner, positionPubkey' },
        { status: 400 }
      );
    }

    const ownerPubkey = new PublicKey(ownerStr.trim());
    const positionPubkey = new PublicKey(posStr.trim());

    const rpcUrl =
      process.env.NEXT_PUBLIC_RPC_URL ||
      process.env.SOLANA_RPC_URL ||
      'http://localhost:8899';
    const conn = new Connection(rpcUrl, 'confirmed');

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

    const posAcc = await (program.account as any).position.fetch(positionPubkey);
    const assetMint: PublicKey = posAcc.assetMint;
    const withdrawAmount: BN = amount ? new BN(Math.round(Number(amount) * 1e8)) : posAcc.amount;

    const mintAccInfo = await conn.getAccountInfo(assetMint);
    const tokenProgramId = mintAccInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const positionVaultAta = await getAssociatedTokenAddress(
      assetMint,
      positionPubkey,
      true,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const ownerTokenAccount = await getAssociatedTokenAddress(
      assetMint,
      ownerPubkey,
      false,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const withdrawIx = await program.methods
      .withdraw(withdrawAmount)
      .accounts({
        position: positionPubkey,
        positionVault: positionVaultAta,
        ownerTokenAccount: ownerTokenAccount,
        assetMint: assetMint,
        owner: ownerPubkey,
        tokenProgram: tokenProgramId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: ownerPubkey });
    tx.add(withdrawIx);

    if (ownerStr === TEST_WALLET_PUBKEY) {
      const testKeypair = Keypair.fromSeed(TEST_WALLET_SEED);
      tx.sign(testKeypair);

      const rawTx = tx.serialize();
      const sig = await conn.sendRawTransaction(rawTx, { skipPreflight: false });
      await confirmSig(conn, sig);

      return NextResponse.json({
        success: true,
        signature: sig,
      });
    }

    const serializedTx = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');

    return NextResponse.json({
      success: true,
      transaction: serializedTx,
    });
  } catch (err: any) {
    console.error('Error in /api/withdraw:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to execute on-chain withdrawal' },
      { status: 500 }
    );
  }
}
