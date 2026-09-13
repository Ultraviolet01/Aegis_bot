use anchor_lang::prelude::*;

/// Policy operational mode:
/// 0 = Inactive, 1 = Normal (active guardian), 2 = Strict (emergency only)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum PolicyMode {
    Inactive = 0,
    Normal = 1,
    Strict = 2,
}

impl Default for PolicyMode {
    fn default() -> Self {
        PolicyMode::Normal
    }
}

/// Risk policy attached to a position by the owner.
/// Stored as a dedicated PolicyAccount PDA: seeds = [b"policy", position.key().as_ref()].
/// The agent reads these values on every monitoring pass; only the owner can write/update them.
#[account]
#[derive(Default)]
pub struct Policy {
    /// Position this policy belongs to.
    pub position: Pubkey,

    /// Maximum drawdown from entry price before an exit is triggered, in BPS.
    /// e.g. 800 = 8%
    pub drawdown_threshold_bps: u16,

    /// Maximum oracle price deviation (consecutive-poll jump) before exit, in BPS.
    /// e.g. 200 = 2%
    pub deviation_threshold_bps: u16,

    /// Maximum percentage of the position the agent may exit in one swap, in BPS.
    /// e.g. 7500 = 75%. Hard ceiling enforced on-chain.
    pub exit_percent_bps: u16,

    /// Maximum swap slippage the agent may accept, in BPS.
    /// Newly added per brief §4 to cap DEX routing execution. e.g. 50 = 0.5%.
    pub max_slippage_bps: u16,

    /// Policy operational mode (0 = Inactive, 1 = Normal, 2 = Strict).
    pub mode: u8,

    /// Target SPL mint to swap into on breach (e.g. USDC, WSOL, or USDT).
    pub target_mint: Pubkey,

    /// Unix timestamp when this policy was set or updated.
    pub created_at: i64,

    /// Bump seed for the policy PDA.
    pub bump: u8,
}

impl Policy {
    pub const LEN: usize = 8   // discriminator
        + 32  // position pubkey
        + 2   // drawdown_threshold_bps
        + 2   // deviation_threshold_bps
        + 2   // exit_percent_bps
        + 2   // max_slippage_bps
        + 1   // mode
        + 32  // target_mint pubkey
        + 8   // created_at
        + 1;  // bump

    pub fn is_active(&self) -> bool {
        self.mode != PolicyMode::Inactive as u8
    }
}

/// A guarded position opened by a user.
/// Holds the deposited asset (supports Token-2022 SPYX and classic SPL tokens)
/// in an associated token account owned by the position PDA.
#[account]
pub struct Position {
    /// The wallet that opened this position. Only this address can:
    ///   - withdraw (unconditional, sovereign)
    ///   - set or update the policy
    ///   - unpause
    pub owner: Pubkey,

    /// SPL mint of the deposited asset (e.g. SPYX Token-2022 mint).
    pub asset_mint: Pubkey,

    /// Raw token amount currently held in the position's token vault.
    pub amount: u64,

    /// The Policy PDA for this position, if one has been set.
    /// None means the agent has zero authority over this position.
    pub policy: Option<Pubkey>,

    /// If true, the agent cannot execute swap_and_deliver on this position.
    /// The owner can always withdraw regardless of this flag.
    pub paused: bool,

    /// Bump seed for the position PDA.
    pub bump: u8,

    /// Sequential position index used to derive the PDA (per-owner counter).
    pub index: u64,
}

impl Position {
    pub const LEN: usize = 8    // discriminator
        + 32   // owner
        + 32   // asset_mint
        + 8    // amount
        + 1 + 32 // Option<Pubkey>
        + 1    // paused
        + 1    // bump
        + 8;   // index
}

/// Global config account (one per program deployment).
/// Stores the authorised agent address and canonical USDC mint.
#[account]
pub struct AegisConfig {
    /// Program upgrade authority / admin.
    pub authority: Pubkey,

    /// The off-chain agent's signing pubkey.
    /// Only this address may call swap_and_deliver and pause_position.
    pub agent: Pubkey,

    /// USDC mint address on this cluster.
    /// Used to derive the owner's destination ATA on-chain in swap_and_deliver.
    pub usdc_mint: Pubkey,

    /// Total positions opened across all users (used to assign position index).
    pub total_positions: u64,

    pub bump: u8,
}

impl AegisConfig {
    pub const LEN: usize = 8   // discriminator
        + 32  // authority
        + 32  // agent
        + 32  // usdc_mint
        + 8   // total_positions
        + 1;  // bump
}
