use anchor_lang::prelude::*;

#[error_code]
pub enum AegisError {
    /// Caller is not the position owner.
    #[msg("Caller is not the position owner")]
    NotPositionOwner,

    /// Caller is not the authorised agent.
    #[msg("Caller is not the authorised agent")]
    NotAgent,

    /// No active policy has been set on this position.
    #[msg("No active policy set on this position")]
    NoPolicySet,

    /// Agent requested a higher exit percentage than the owner approved.
    #[msg("Requested exit BPS exceeds the policy-approved ceiling")]
    ExitBpsExceedsPolicy,

    /// Agent requested higher slippage than the owner approved.
    #[msg("Requested slippage BPS exceeds the policy-approved ceiling")]
    SlippageExceedsPolicy,

    /// Position is paused; agent actions are blocked until owner unpauses.
    #[msg("Position is paused")]
    PositionPaused,

    /// The USDC destination account is not the owner's Associated Token Account.
    /// This fires in swap_and_deliver if the passed destination deviates from
    /// the deterministically-derived ATA — the core non-custodial invariant.
    #[msg("USDC destination must be the owner's Associated Token Account")]
    InvalidSwapDestination,

    /// Arithmetic overflow during calculation.
    #[msg("Arithmetic overflow")]
    MathOverflow,

    /// Position amount is zero; nothing to act on.
    #[msg("Position has zero balance")]
    ZeroBalance,

    /// Target mint is not an allowed exit asset (must be USDC, SOL/WSOL, or USDT).
    #[msg("Target mint must be an allowed exit asset (USDC, SOL/WSOL, or USDT)")]
    InvalidTargetMint,

    /// Mint account failed Token-2022 extension unpacking.
    #[msg("Invalid mint account or extensions")]
    InvalidMint,

    /// Policy operational mode is invalid.
    #[msg("Invalid policy mode")]
    InvalidPolicyMode,

    /// DEX swap execution failed or slippage breach occurred.
    #[msg("Swap execution failed")]
    SwapFailed,

    /// Jupiter route plan vector is empty; at least one hop is required.
    #[msg("Route plan must have at least one step")]
    InvalidRoutePlan,

    /// Actual swap output from Jupiter is below the on-chain slippage floor.
    #[msg("Swap output is below the policy slippage ceiling floor")]
    SlippageLimitExceeded,
}
