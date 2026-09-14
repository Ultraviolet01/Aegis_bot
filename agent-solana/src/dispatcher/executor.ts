import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";


export const JUPITER_PROGRAM_ID = new PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
);

export const JUPITER_EVENT_AUTHORITY = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  JUPITER_PROGRAM_ID
)[0];

export interface DispatchParams {
  connection: Connection;
  program: anchor.Program;
  agentKeypair: Keypair;
  positionPubkey: PublicKey;
  positionOwner: PublicKey;
  positionIndex: anchor.BN;
  assetMint: PublicKey;
  targetMint: PublicKey;
  exitBps: number;
  maxSlippageBps: number;
  vaultAmount: anchor.BN;
}

export interface DispatchResult {
  success: boolean;
  txSignature?: string;
  quotedOutAmount?: string;
  actualDelta?: bigint;
  computeUnits?: number;
  error?: string;
}

/**
 * Detect which token program owns a given mint.
 */
async function getTokenProgramForMint(
  connection: Connection,
  mint: PublicKey
): Promise<PublicKey> {
  const accountInfo = await connection.getAccountInfo(mint);
  if (accountInfo && accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID;
  }
  return TOKEN_PROGRAM_ID;
}

/**
 * Executes a real Jupiter route CPI via swap_and_deliver on-chain using
 * the verbatim account list from /swap-instructions.
 */
export async function executeSwapAndDeliver(
  params: DispatchParams
): Promise<DispatchResult> {
  const {
    connection,
    program,
    agentKeypair,
    positionPubkey,
    positionOwner,
    assetMint,
    targetMint,
    exitBps,
    maxSlippageBps,
    vaultAmount,
  } = params;

  try {
    const sourceTokenProgram = await getTokenProgramForMint(connection, assetMint);
    const destinationTokenProgram = await getTokenProgramForMint(connection, targetMint);

    // Derive required PDAs
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("aegis-config")],
      program.programId
    );

    const [policyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("policy"), positionPubkey.toBuffer()],
      program.programId
    );

    const positionVaultAta = getAssociatedTokenAddressSync(
      assetMint,
      positionPubkey,
      true,
      sourceTokenProgram
    );

    const ownerDestinationAta = getAssociatedTokenAddressSync(
      targetMint,
      positionOwner,
      false,
      destinationTokenProgram
    );

    // Calculate exit amount in input atoms
    const exitAmountBigInt =
      (BigInt(vaultAmount.toString()) * BigInt(exitBps)) / 10_000n;

    if (exitAmountBigInt <= 0n) {
      return { success: false, error: "Exit amount is zero" };
    }

    // 1. Fetch real Jupiter quote
    const quoteUrl = new URL("https://api.jup.ag/swap/v1/quote");
    quoteUrl.searchParams.set("inputMint", assetMint.toBase58());
    quoteUrl.searchParams.set("outputMint", targetMint.toBase58());
    quoteUrl.searchParams.set("amount", exitAmountBigInt.toString());
    quoteUrl.searchParams.set("slippageBps", maxSlippageBps.toString());
    quoteUrl.searchParams.set("onlyDirectRoutes", "true");
    quoteUrl.searchParams.set("asLegacyTransaction", "true");
    quoteUrl.searchParams.set("maxAccounts", "20");
    quoteUrl.searchParams.set("dexes", "Raydium CLMM");

    const quoteRes = await fetch(quoteUrl.toString());
    const quote = (await quoteRes.json()) as any;
    if (!quote || !quote.outAmount) {
      return { success: false, error: `Failed to fetch quote: ${JSON.stringify(quote)}` };
    }

    // 2. Fetch verbatim swap instructions from Jupiter
    const swapInstrRes = await fetch("https://api.jup.ag/swap/v1/swap-instructions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: positionPubkey.toBase58(),
        destinationTokenAccount: ownerDestinationAta.toBase58(),
        wrapAndUnwrapSol: false,
      }),
    });

    const swapInstructionData = (await swapInstrRes.json()) as any;
    if (!swapInstructionData || !swapInstructionData.swapInstruction) {
      return {
        success: false,
        error: `Jupiter swap-instructions error: ${JSON.stringify(swapInstructionData)}`,
      };
    }



    const rawSwapData = Buffer.from(swapInstructionData.swapInstruction.data, "base64");
    const remainingAccounts = swapInstructionData.swapInstruction.accounts.map(
      (acc: any) => ({
        pubkey: new PublicKey(acc.pubkey),
        isSigner: false,
        isWritable: Boolean(acc.isWritable),
      })
    );

    // Record pre-swap balance
    let preSwapBalance = 0n;
    try {
      const acc = await getAccount(
        connection,
        ownerDestinationAta,
        connection.commitment || "confirmed",
        destinationTokenProgram
      );
      preSwapBalance = acc.amount;
    } catch {
      preSwapBalance = 0n;
    }

    // 3. Dispatch on-chain swap_and_deliver
    const txSig = await program.methods
      .swapAndDeliver(exitBps, new anchor.BN(quote.outAmount), rawSwapData)
      .accounts({
        config: configPda,
        position: positionPubkey,
        policy: policyPda,
        positionVault: positionVaultAta,
        assetMint,
        targetMint,
        ownerDestinationAta,
        agent: agentKeypair.publicKey,
        sourceTokenProgram,
        destinationTokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        jupiterProgram: JUPITER_PROGRAM_ID,
        jupiterEventAuthority: JUPITER_EVENT_AUTHORITY,
      })
      .remainingAccounts(remainingAccounts)
      .signers([agentKeypair])
      .rpc();

    // Confirm transaction
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature: txSig,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });

    const txDetails = await connection.getTransaction(txSig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    // Record post-swap balance
    const postAccount = await getAccount(
      connection,
      ownerDestinationAta,
      connection.commitment || "confirmed",
      destinationTokenProgram
    );
    const postSwapBalance = postAccount.amount;
    const delta = postSwapBalance - preSwapBalance;

    return {
      success: true,
      txSignature: txSig,
      quotedOutAmount: quote.outAmount,
      actualDelta: delta,
      computeUnits: txDetails?.meta?.computeUnitsConsumed,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || String(err),
    };
  }
}
