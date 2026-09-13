use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
pub mod errors;
pub mod jupiter_cpi;
pub mod state;
pub mod token2022;

use errors::AegisError;
use state::{AegisConfig, Policy, PolicyMode, Position};
use token2022::read_mint_multiplier;

declare_id!("C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L");

// ─── Seed constants ────────────────────────────────────────────────────────────
pub const CONFIG_SEED: &[u8] = b"aegis-config";
pub const POSITION_SEED: &[u8] = b"position";
pub const POLICY_SEED: &[u8] = b"policy";
pub const VAULT_SEED: &[u8] = b"vault";

// ─── Supported exit assets on Solana ──────────────────────────────────────────
pub mod allowed_mints {
    use anchor_lang::prelude::*;
    /// Wrapped SOL (WSOL) — native wrapped SOL across all Solana clusters
    pub const WSOL: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
    /// Mainnet USDT
    pub const USDT_MAINNET: Pubkey = pubkey!("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
    /// Mainnet USDC
    pub const USDC_MAINNET: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    /// Devnet USDC
    pub const USDC_DEVNET: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
}

/// Verifies whether an exit mint is one of the supported assets: USDC, SOL (WSOL), or USDT.
pub fn is_allowed_exit_mint(mint: &Pubkey, config_usdc: &Pubkey) -> bool {
    mint == &allowed_mints::WSOL
        || mint == &allowed_mints::USDT_MAINNET
        || mint == &allowed_mints::USDC_MAINNET
        || mint == &allowed_mints::USDC_DEVNET
        || mint == config_usdc
}

#[program]
pub mod aegis {
    use super::*;

    // ─── initialize ────────────────────────────────────────────────────────────
    /// One-time setup. Creates the global AegisConfig account.
    /// Must be called by the program upgrade authority.
    pub fn initialize(
        ctx: Context<Initialize>,
        agent: Pubkey,
        usdc_mint: Pubkey,
    ) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.authority = ctx.accounts.authority.key();
        cfg.agent = agent;
        cfg.usdc_mint = usdc_mint;
        cfg.total_positions = 0;
        cfg.bump = ctx.bumps.config;

        emit!(ConfigInitialized {
            authority: cfg.authority,
            agent: cfg.agent,
            usdc_mint: cfg.usdc_mint,
        });
        Ok(())
    }

    // ─── get_mint_multiplier ───────────────────────────────────────────────────
    /// Reads on-chain Token-2022 ScaledUiAmountConfig multiplier for a mint.
    /// Returns the multiplier scaled by 1,000,000 (micro-units, e.g. 1.005714 -> 1_005_714).
    pub fn get_mint_multiplier(ctx: Context<GetMintMultiplier>) -> Result<u64> {
        let info = read_mint_multiplier(&ctx.accounts.mint.to_account_info())?;
        emit!(MultiplierRead {
            mint: ctx.accounts.mint.key(),
            multiplier_bps: (info.multiplier * 10_000.0) as u64,
            multiplier_scaled: info.multiplier_scaled,
            new_multiplier_scaled: info.new_multiplier_scaled,
            effective_timestamp: info.effective_timestamp,
            is_scaled_ui_token: info.is_scaled_ui_token,
        });
        Ok(info.multiplier_scaled)
    }

    // ─── open_position ─────────────────────────────────────────────────────────
    /// Deposit `amount` tokens of `asset_mint` into a new guarded position.
    /// Creates a Position PDA and a token vault ATA owned by the PDA.
    /// Supports Token-2022 (e.g. SPYX) and standard SPL tokens via TokenInterface.
    pub fn open_position(ctx: Context<OpenPosition>, amount: u64) -> Result<()> {
        require!(amount > 0, AegisError::ZeroBalance);

        let config = &mut ctx.accounts.config;
        let pos_index = config.total_positions;
        config.total_positions = config
            .total_positions
            .checked_add(1)
            .ok_or(AegisError::MathOverflow)?;

        let pos = &mut ctx.accounts.position;
        pos.owner = ctx.accounts.owner.key();
        pos.asset_mint = ctx.accounts.asset_mint.key();
        pos.amount = amount;
        pos.policy = None;
        pos.paused = false;
        pos.bump = ctx.bumps.position;
        pos.index = pos_index;

        // Transfer tokens from owner's ATA → position vault via TokenInterface
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.owner_token_account.to_account_info(),
            mint: ctx.accounts.asset_mint.to_account_info(),
            to: ctx.accounts.position_vault.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.asset_mint.decimals)?;

        emit!(PositionOpened {
            position: pos.key(),
            owner: pos.owner,
            asset_mint: pos.asset_mint,
            amount,
        });
        Ok(())
    }

    // ─── set_policy ────────────────────────────────────────────────────────────
    /// Owner attaches or overwrites a risk policy on their position.
    /// The agent cannot call this — enforced by owner-signer constraint.
    pub fn set_policy(
        ctx: Context<SetPolicy>,
        drawdown_threshold_bps: u16,
        deviation_threshold_bps: u16,
        exit_percent_bps: u16,
        max_slippage_bps: u16,
        mode: u8,
        target_mint: Pubkey,
    ) -> Result<()> {
        // Sanity validations
        require!(drawdown_threshold_bps > 0 && drawdown_threshold_bps <= 10_000, AegisError::MathOverflow);
        require!(deviation_threshold_bps > 0 && deviation_threshold_bps <= 10_000, AegisError::MathOverflow);
        require!(exit_percent_bps > 0 && exit_percent_bps <= 10_000, AegisError::MathOverflow);
        require!(max_slippage_bps > 0 && max_slippage_bps <= 10_000, AegisError::MathOverflow);
        require!(mode <= 2, AegisError::InvalidPolicyMode);

        // Validate target_mint is one of the supported exit assets: USDC, SOL (WSOL), or USDT
        require!(
            is_allowed_exit_mint(&target_mint, &ctx.accounts.config.usdc_mint),
            AegisError::InvalidTargetMint
        );

        let position = &mut ctx.accounts.position;
        let policy = &mut ctx.accounts.policy;

        policy.position = position.key();
        policy.drawdown_threshold_bps = drawdown_threshold_bps;
        policy.deviation_threshold_bps = deviation_threshold_bps;
        policy.exit_percent_bps = exit_percent_bps;
        policy.max_slippage_bps = max_slippage_bps;
        policy.mode = mode;
        policy.target_mint = target_mint;
        policy.created_at = Clock::get()?.unix_timestamp;
        policy.bump = ctx.bumps.policy;

        // Wire position → policy PDA
        position.policy = Some(policy.key());

        emit!(PolicySet {
            position: position.key(),
            policy: policy.key(),
            drawdown_threshold_bps,
            deviation_threshold_bps,
            exit_percent_bps,
            max_slippage_bps,
            mode,
            target_mint,
        });
        Ok(())
    }

    // ─── deactivate_policy ─────────────────────────────────────────────────────
    /// Owner disables the active policy. Agent authority drops to zero immediately.
    pub fn deactivate_policy(ctx: Context<DeactivatePolicy>) -> Result<()> {
        ctx.accounts.policy.mode = PolicyMode::Inactive as u8;
        ctx.accounts.position.policy = None;

        emit!(PolicyDeactivated {
            position: ctx.accounts.position.key(),
        });
        Ok(())
    }

    // ─── pause_position ────────────────────────────────────────────────────────
    /// Agent or owner can pause a position. While paused, swap_and_deliver is blocked.
    /// The owner can always withdraw regardless of pause state.
    pub fn pause_position(ctx: Context<AgentOrOwnerAction>) -> Result<()> {
        ctx.accounts.position.paused = true;
        emit!(PositionPaused {
            position: ctx.accounts.position.key(),
        });
        Ok(())
    }

    /// Resume a paused position. Only the owner can unpause.
    pub fn unpause_position(ctx: Context<OwnerAction>) -> Result<()> {
        ctx.accounts.position.paused = false;
        emit!(PositionUnpaused {
            position: ctx.accounts.position.key(),
        });
        Ok(())
    }

    // ─── withdraw ──────────────────────────────────────────────────────────────
    /// Owner withdraws `amount` tokens back to their wallet at any time.
    /// Not gated by policy, pause, or agent — owner sovereignty is unconditional.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, AegisError::ZeroBalance);
        let position = &mut ctx.accounts.position;
        require!(position.amount >= amount, AegisError::ZeroBalance);

        position.amount = position
            .amount
            .checked_sub(amount)
            .ok_or(AegisError::MathOverflow)?;

        // Transfer from vault → owner ATA via TokenInterface, signed by position PDA
        let position_key = position.key();
        let owner_key = position.owner;
        let index_bytes = position.index.to_le_bytes();
        let bump = position.bump;
        let position_info = position.to_account_info();

        let seeds = &[
            POSITION_SEED,
            owner_key.as_ref(),
            &index_bytes,
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.position_vault.to_account_info(),
            mint: ctx.accounts.asset_mint.to_account_info(),
            to: ctx.accounts.owner_token_account.to_account_info(),
            authority: position_info,
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.asset_mint.decimals)?;

        emit!(Withdrawn {
            position: position_key,
            owner: ctx.accounts.owner.key(),
            amount,
        });
        Ok(())
    }

    // ─── swap_and_deliver ──────────────────────────────────────────────────────
    /// Agent-only. Triggered when a policy breach is verified off-chain.
    ///
    /// CORE NON-CUSTODIAL INVARIANTS (enforced on-chain):
    ///   1. Destination account MUST be the owner's deterministic Associated Token Account.
    ///      It is NEVER accepted as an instruction parameter.
    ///   2. Exit amount is clamped to policy.exit_percent_bps ceiling.
    ///   3. Output slippage is clamped to policy.max_slippage_bps ceiling.
    ///   4. Intermediate ATA owned by position PDA is created idempotently on-chain.
    ///   5. Verbatim account pass-through ensures dynamic DEX routes match Jupiter's exact expectations.
    pub fn swap_and_deliver<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, SwapAndDeliver<'info>>,
        exit_bps: u16,
        quoted_out_amount: u64,
        swap_data: Vec<u8>,
    ) -> Result<()> {
        let mut swap_data = swap_data;
        let position_key = ctx.accounts.position.key();
        let position_owner = ctx.accounts.position.owner;
        let position_index = ctx.accounts.position.index;
        let position_bump = ctx.accounts.position.bump;
        let position_amount = ctx.accounts.position.amount;
        let position_paused = ctx.accounts.position.paused;
        let position_asset_mint = ctx.accounts.position.asset_mint;

        require!(!position_paused, AegisError::PositionPaused);
        require!(position_amount > 0, AegisError::ZeroBalance);

        let policy = &ctx.accounts.policy;
        require!(policy.is_active(), AegisError::NoPolicySet);

        // Exit BPS ceiling — this is the hard on-chain clamp
        require!(exit_bps <= policy.exit_percent_bps, AegisError::ExitBpsExceedsPolicy);

        // Calculate amount to exit
        let exit_amount = position_amount
            .checked_mul(exit_bps as u64)
            .ok_or(AegisError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(AegisError::MathOverflow)?;
        require!(exit_amount > 0, AegisError::ZeroBalance);

        // Derive min_amount_out from slippage ceiling
        let min_amount_out = (quoted_out_amount as u128)
            .checked_mul((10_000 - policy.max_slippage_bps) as u128)
            .ok_or(AegisError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(AegisError::MathOverflow)? as u64;

        // Target mint must match the owner-approved policy target mint
        require_keys_eq!(
            ctx.accounts.target_mint.key(),
            policy.target_mint,
            AegisError::InvalidTargetMint
        );

        // Asset mint must match position
        require_keys_eq!(
            ctx.accounts.asset_mint.key(),
            position_asset_mint,
            AegisError::InvalidMint
        );

        // Expected ATA is deterministically derived from position owner + target_mint.
        let expected_destination = anchor_spl::associated_token::get_associated_token_address_with_program_id(
            &position_owner,
            &policy.target_mint,
            &ctx.accounts.destination_token_program.key(),
        );
        require_keys_eq!(
            ctx.accounts.owner_destination_ata.key(),
            expected_destination,
            AegisError::InvalidSwapDestination
        );

        // Verify that owner_destination_ata is present in remaining_accounts as a writable account
        require!(
            ctx.remaining_accounts
                .iter()
                .any(|acc| acc.key == &ctx.accounts.owner_destination_ata.key() && acc.is_writable),
            AegisError::InvalidSwapDestination
        );

        // Validate swap_data format and Jupiter Route discriminator
        require!(swap_data.len() >= 27, AegisError::InvalidRoutePlan);
        require!(
            &swap_data[..8] == &[229, 23, 203, 151, 122, 227, 173, 42],
            AegisError::InvalidRoutePlan
        );

        // Enforce on-chain parameter limits inside swap_data (last 19 bytes of RouteArgs)
        let param_offset = swap_data.len() - 19;
        let in_amount = u64::from_le_bytes(
            swap_data[param_offset..param_offset + 8]
                .try_into()
                .map_err(|_| AegisError::InvalidRoutePlan)?,
        );
        require!(in_amount <= exit_amount, AegisError::ExitBpsExceedsPolicy);

        let slippage_bps = u16::from_le_bytes(
            swap_data[param_offset + 16..param_offset + 18]
                .try_into()
                .map_err(|_| AegisError::InvalidRoutePlan)?,
        );
        require!(slippage_bps <= policy.max_slippage_bps, AegisError::SlippageExceedsPolicy);

        // Overwrite in_amount and slippage_bps with exact on-chain authorized values
        swap_data[param_offset..param_offset + 8].copy_from_slice(&exit_amount.to_le_bytes());
        swap_data[param_offset + 16..param_offset + 18].copy_from_slice(&policy.max_slippage_bps.to_le_bytes());
        swap_data[param_offset + 18] = 0; // platform_fee_bps: zero

        // ── 1. Atomic Idempotent Intermediate ATA Creation ───────────────────────
        let intermediate_ata = anchor_spl::associated_token::get_associated_token_address_with_program_id(
            &position_key,
            &ctx.accounts.target_mint.key(),
            &ctx.accounts.destination_token_program.key(),
        );

        if let Some(intermediate_info) = ctx.remaining_accounts.iter().find(|acc| *acc.key == intermediate_ata) {
            if intermediate_info.data_is_empty() {
                let cpi_accounts = anchor_spl::associated_token::Create {
                    payer: ctx.accounts.agent.to_account_info(),
                    associated_token: intermediate_info.clone(),
                    authority: ctx.accounts.position.to_account_info(),
                    mint: ctx.accounts.target_mint.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    token_program: ctx.accounts.destination_token_program.to_account_info(),
                };
                let cpi_ctx = CpiContext::new(
                    ctx.accounts.associated_token_program.to_account_info(),
                    cpi_accounts,
                );
                anchor_spl::associated_token::create_idempotent(cpi_ctx)?;
            }
        }

        // Record destination balance before swap
        ctx.accounts.owner_destination_ata.reload()?;
        let balance_before = ctx.accounts.owner_destination_ata.amount;

        // ── 2. Verbatim Account Pass-Through CPI to Jupiter ────────────────────
        let mut jup_account_metas = Vec::with_capacity(ctx.remaining_accounts.len());
        for acc in ctx.remaining_accounts.iter() {
            let is_signer = *acc.key == position_key;
            if acc.is_writable {
                jup_account_metas.push(AccountMeta::new(*acc.key, is_signer));
            } else {
                jup_account_metas.push(AccountMeta::new_readonly(*acc.key, is_signer));
            }
        }

        let position_seeds: &[&[u8]] = &[
            POSITION_SEED,
            position_owner.as_ref(),
            &position_index.to_le_bytes(),
            &[position_bump],
        ];
        let signer_seeds = &[position_seeds];

        let mut jup_account_infos = Vec::with_capacity(ctx.remaining_accounts.len() + 1);
        jup_account_infos.push(ctx.accounts.jupiter_program.to_account_info());
        jup_account_infos.extend_from_slice(ctx.remaining_accounts);

        let jup_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: ctx.accounts.jupiter_program.key(),
            accounts: jup_account_metas,
            data: swap_data,
        };

        anchor_lang::solana_program::program::invoke_signed(&jup_ix, &jup_account_infos, signer_seeds)?;

        // ── 3. Post-Swap Balance Verification ──────────────────────────────────
        ctx.accounts.owner_destination_ata.reload()?;
        let balance_after = ctx.accounts.owner_destination_ata.amount;
        let actual_out_amount = balance_after.saturating_sub(balance_before);
        require!(
            actual_out_amount >= min_amount_out,
            AegisError::SlippageLimitExceeded
        );

        // Decrement position balance ONLY after successful swap & delivery
        let position = &mut ctx.accounts.position;
        position.amount = position_amount
            .checked_sub(exit_amount)
            .ok_or(AegisError::MathOverflow)?;

        emit!(SwapExecuted {
            position: position_key,
            owner: position_owner,
            asset_mint: position_asset_mint,
            exit_amount,
            exit_bps,
            min_amount_out,
            actual_out_amount,
            target_mint: policy.target_mint,
            destination: ctx.accounts.owner_destination_ata.key(),
        });

        Ok(())
    }

    // ─── update_agent ──────────────────────────────────────────────────────────
    /// Admin-only: update the authorized monitoring agent pubkey.
    pub fn update_agent(ctx: Context<UpdateAgent>, new_agent: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.agent = new_agent;
        emit!(AgentUpdated {
            authority: ctx.accounts.authority.key(),
            new_agent,
        });
        Ok(())
    }
}

// ─── Account Contexts ──────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = AegisConfig::LEN,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, AegisConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetMintMultiplier<'info> {
    /// CHECK: Checked via read_mint_multiplier (unpacks Token-2022 extension or returns 1.0)
    pub mint: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, AegisConfig>,

    #[account(
        init,
        payer = owner,
        space = Position::LEN,
        seeds = [POSITION_SEED, owner.key().as_ref(), &config.total_positions.to_le_bytes()],
        bump,
    )]
    pub position: Account<'info, Position>,

    /// The token vault for this position — an ATA owned by the position PDA.
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = asset_mint,
        associated_token::authority = position,
        associated_token::token_program = token_program,
    )]
    pub position_vault: InterfaceAccount<'info, TokenAccount>,

    pub asset_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = asset_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPolicy<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, AegisConfig>,

    #[account(
        mut,
        seeds = [POSITION_SEED, owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner @ AegisError::NotPositionOwner,
    )]
    pub position: Account<'info, Position>,

    #[account(
        init_if_needed,
        payer = owner,
        space = Policy::LEN,
        seeds = [POLICY_SEED, position.key().as_ref()],
        bump,
    )]
    pub policy: Account<'info, Policy>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DeactivatePolicy<'info> {
    #[account(
        mut,
        seeds = [POSITION_SEED, owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner @ AegisError::NotPositionOwner,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        seeds = [POLICY_SEED, position.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, Policy>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct AgentOrOwnerAction<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, AegisConfig>,

    #[account(
        mut,
        seeds = [POSITION_SEED, position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,

    #[account(
        constraint = (caller.key() == config.agent || caller.key() == position.owner)
            @ AegisError::NotAgent
    )]
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct OwnerAction<'info> {
    #[account(
        mut,
        seeds = [POSITION_SEED, owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner @ AegisError::NotPositionOwner,
    )]
    pub position: Account<'info, Position>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [POSITION_SEED, owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner @ AegisError::NotPositionOwner,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        associated_token::mint = asset_mint,
        associated_token::authority = position,
        associated_token::token_program = token_program,
    )]
    pub position_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = asset_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,

    pub asset_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SwapAndDeliver<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, AegisConfig>,

    #[account(
        mut,
        seeds = [POSITION_SEED, position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,

    #[account(
        seeds = [POLICY_SEED, position.key().as_ref()],
        bump = policy.bump,
        constraint = policy.is_active() @ AegisError::NoPolicySet,
        constraint = policy.position == position.key(),
    )]
    pub policy: Account<'info, Policy>,

    /// Source vault — position PDA holds the user's SPYX here (Token-2022 ATA).
    #[account(
        mut,
        associated_token::mint = asset_mint,
        associated_token::authority = position,
        associated_token::token_program = source_token_program,
    )]
    pub position_vault: InterfaceAccount<'info, TokenAccount>,

    /// The Token-2022 mint for the source asset (SPYX).
    pub asset_mint: InterfaceAccount<'info, Mint>,

    /// Target mint to receive (USDC / WSOL / USDT — must be SPL Token mints).
    pub target_mint: InterfaceAccount<'info, Mint>,

    /// Destination — MUST be the owner's ATA for target_mint, verified on-chain.
    #[account(mut)]
    pub owner_destination_ata: InterfaceAccount<'info, TokenAccount>,

    /// Must be the authorised agent (pays rent for intermediate ATA if created).
    #[account(
        mut,
        constraint = agent.key() == config.agent @ AegisError::NotAgent
    )]
    pub agent: Signer<'info>,

    /// Token program for the SOURCE asset (Token-2022 for SPYX).
    pub source_token_program: Interface<'info, TokenInterface>,

    /// Token program for the DESTINATION asset (SPL Token for USDC/USDT/WSOL).
    pub destination_token_program: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

    /// Jupiter v6 aggregator program.
    pub jupiter_program: Program<'info, jupiter_cpi::Jupiter>,

    /// Jupiter event authority PDA — required by the `route` instruction.
    /// CHECK: This is a well-known PDA derived from the Jupiter program ID.
    #[account(address = jupiter_cpi::find_event_authority())]
    pub jupiter_event_authority: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct UpdateAgent<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority,
    )]
    pub config: Account<'info, AegisConfig>,

    pub authority: Signer<'info>,
}

// ─── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub agent: Pubkey,
    pub usdc_mint: Pubkey,
}

#[event]
pub struct MultiplierRead {
    pub mint: Pubkey,
    pub multiplier_bps: u64,
    pub multiplier_scaled: u64,
    pub new_multiplier_scaled: u64,
    pub effective_timestamp: i64,
    pub is_scaled_ui_token: bool,
}

#[event]
pub struct PositionOpened {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub asset_mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PolicySet {
    pub position: Pubkey,
    pub policy: Pubkey,
    pub drawdown_threshold_bps: u16,
    pub deviation_threshold_bps: u16,
    pub exit_percent_bps: u16,
    pub max_slippage_bps: u16,
    pub mode: u8,
    pub target_mint: Pubkey,
}

#[event]
pub struct PolicyDeactivated {
    pub position: Pubkey,
}

#[event]
pub struct PositionPaused {
    pub position: Pubkey,
}

#[event]
pub struct PositionUnpaused {
    pub position: Pubkey,
}

#[event]
pub struct Withdrawn {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SwapExecuted {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub asset_mint: Pubkey,
    pub exit_amount: u64,
    pub exit_bps: u16,
    pub min_amount_out: u64,
    pub actual_out_amount: u64,
    pub target_mint: Pubkey,
    pub destination: Pubkey,
}

#[event]
pub struct AgentUpdated {
    pub authority: Pubkey,
    pub new_agent: Pubkey,
}
