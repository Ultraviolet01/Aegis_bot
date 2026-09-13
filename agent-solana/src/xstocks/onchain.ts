import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, getScaledUiAmountConfig, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { CorporateAction } from "./client";

export interface OnChainMultiplierState {
  currentMultiplier: number;
  newMultiplier: number | null;
  activationTime: number | null;
  actions: CorporateAction[];
}

export {
  DIVIDEND_THRESHOLD,
  REVIEW_BAND,
  ActionClassification,
  classifyCorporateAction,
} from "./multiplier";
import { classifyCorporateAction } from "./multiplier";

/**
 * Reads the Token-2022 Scaled UI Amount extension directly from the on-chain mint account.
 *
 * This provides a zero-dependency, tamper-proof fallback for corporate action multipliers
 * directly from Solana RPC without relying on external REST APIs or third-party launch schedules.
 */
export async function getOnChainMultiplierState(
  connection: Connection,
  mintPubkey: PublicKey
): Promise<OnChainMultiplierState | null> {
  try {
    const mintInfo = await getMint(
      connection,
      mintPubkey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const config = getScaledUiAmountConfig(mintInfo);
    if (!config) {
      return {
        currentMultiplier: 1.0,
        newMultiplier: null,
        activationTime: null,
        actions: [],
      };
    }

    const currentMultiplier = Number(config.multiplier) || 1.0;
    const newMultiplier = Number(config.newMultiplier);
    const activationTime = Number(config.newMultiplierEffectiveTimestamp);
    const hasPendingAction = activationTime > 0 && newMultiplier > 0 && newMultiplier !== currentMultiplier;

    const actions: CorporateAction[] = [];
    if (hasPendingAction) {
      const { actionType, needsReview } = classifyCorporateAction(
        currentMultiplier,
        newMultiplier
      );

      actions.push({
        mint: mintPubkey.toBase58(),
        symbol: "ONCHAIN",
        actionType,
        needsReview,
        newMultiplier,
        oldMultiplier: currentMultiplier,
        exDate: new Date(activationTime * 1000).toISOString().split("T")[0],
        activationTime,
        applied: Date.now() / 1000 >= activationTime,
      });
    }

    return {
      currentMultiplier,
      newMultiplier: hasPendingAction ? newMultiplier : null,
      activationTime: hasPendingAction ? activationTime : null,
      actions,
    };
  } catch (err) {
    return null;
  }
}
