use anchor_lang::prelude::*;

declare_id!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

#[derive(Clone)]
pub struct Jupiter;

impl anchor_lang::Id for Jupiter {
    fn id() -> Pubkey {
        ID
    }
}

pub fn find_event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &ID).0
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct RoutePlanStep {
    pub swap: Swap,
    pub percent: u8,
    pub input_index: u8,
    pub output_index: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum Swap {
    Saber,
    SaberAddDecimalsDeposit,
    SaberAddDecimalsWithdraw,
    TokenSwap,
    Sencha,
    Step,
    Cropper,
    Raydium,
    Crema { a_to_b: bool },
    Lifinity,
    Mercurial,
    Cykura,
    Serum { side: Side },
    MarinadeDeposit,
    MarinadeUnstake,
    Aldrin { side: Side },
    AldrinV2 { side: Side },
    Whirlpool { a_to_b: bool },
    Invariant { x_to_y: bool },
    Meteora,
    GooseFX,
    DeltaFi { stable: bool },
    Balansol,
    MarcoPolo { x_to_y: bool },
    Dradex { side: Side },
    LifinityV2,
    RaydiumClmm,
    Openbook { side: Side },
    Phoenix { side: Side },
    Symmetry { from_token_id: u64, to_token_id: u64 },
    TokenSwapV2,
    HeliumTreasuryManagementRedeemV0,
    StakeDexStakeWrappedSol,
    StakeDexSwapViaStake { bridge_stake_seed: u32 },
    GooseFXV2,
    Perps,
    PerpsAddLiquidity,
    PerpsRemoveLiquidity,
    MeteoraDlmm,
    OpenBookV2 { side: Side },
    RaydiumClmmV2,
    CloneProtocol { pool_index: u8 },
    SanctumS { src_lst_value_calc_accs: u8, dst_lst_value_calc_accs: u8, src_lst_index: u32, dst_lst_index: u32 },
    SanctumSAddLiquidity { lst_value_calc_accs: u8, lst_index: u32 },
    SanctumSRemoveLiquidity { lst_value_calc_accs: u8, lst_index: u32 },
    RaydiumCP,
    WhirlpoolSwapV2 { a_to_b: bool, remaining_accounts_info: Option<RemainingAccountsInfo> },
    OneIntro { side: Side },
    PumpdotfunWrappedBuy,
    PumpdotfunWrappedSell,
    PerpsV2,
    PerpsV2AddLiquidity,
    PerpsV2RemoveLiquidity,
    MoonshotWrappedBuy,
    MoonshotWrappedSell,
    StabbleStableSwap,
    StabbleWeightedSwap,
    Obric { x_to_y: bool },
    FoxBuyFromEstimatedCost,
    FoxClaimPartial { is_y: bool },
    SolFi,
    SolayerDelegateNoopV0,
    SolayerUndelegateNoopV0,
    TokenMill { side: Side },
    DaosFun,
    ZeroFi,
    StakeDexPrefundWithdrawStakeAndDepositStake { bridge_stake_seed: u32 },
    VirtualsV1Buy,
    VirtualsV1Sell,
    Gamma,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum Side {
    Bid,
    Ask,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct RemainingAccountsInfo {
    pub slices: Vec<RemainingAccountsSlice>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct RemainingAccountsSlice {
    pub accounts_type: AccountsType,
    pub length: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum AccountsType {
    TransferHookA,
    TransferHookB,
    TransferHookReward,
    TransferHookInput,
    TransferHookIntermediary,
    TransferHookOutput,
    SupplementalTickArrays,
    SupplementalTickArraysOne,
    SupplementalTickArraysTwo,
}

pub mod cpi {
    use super::*;

    pub mod accounts {
        use super::*;

        pub struct Route<'info> {
            pub token_program: AccountInfo<'info>,
            pub user_transfer_authority: AccountInfo<'info>,
            pub user_source_token_account: AccountInfo<'info>,
            pub user_destination_token_account: AccountInfo<'info>,
            pub destination_token_account: Option<AccountInfo<'info>>,
            pub destination_mint: AccountInfo<'info>,
            pub platform_fee_account: Option<AccountInfo<'info>>,
            pub event_authority: AccountInfo<'info>,
            pub program: AccountInfo<'info>,
        }

        impl<'info> anchor_lang::ToAccountMetas for Route<'info> {
            fn to_account_metas(&self, _is_signer: Option<bool>) -> Vec<AccountMeta> {
                vec![
                    AccountMeta::new_readonly(self.token_program.key(), false),
                    AccountMeta::new_readonly(self.user_transfer_authority.key(), true),
                    AccountMeta::new(self.user_source_token_account.key(), false),
                    AccountMeta::new(self.user_destination_token_account.key(), false),
                    match &self.destination_token_account {
                        Some(acc) => AccountMeta::new(acc.key(), false),
                        None => AccountMeta::new_readonly(self.program.key(), false),
                    },
                    AccountMeta::new_readonly(self.destination_mint.key(), false),
                    match &self.platform_fee_account {
                        Some(acc) => AccountMeta::new(acc.key(), false),
                        None => AccountMeta::new_readonly(self.program.key(), false),
                    },
                    AccountMeta::new_readonly(self.event_authority.key(), false),
                    AccountMeta::new_readonly(self.program.key(), false),
                ]
            }
        }

        impl<'info> anchor_lang::ToAccountInfos<'info> for Route<'info> {
            fn to_account_infos(&self) -> Vec<AccountInfo<'info>> {
                let mut infos = vec![
                    self.token_program.clone(),
                    self.user_transfer_authority.clone(),
                    self.user_source_token_account.clone(),
                    self.user_destination_token_account.clone(),
                ];
                if let Some(ref acc) = self.destination_token_account {
                    infos.push(acc.clone());
                } else {
                    infos.push(self.program.clone());
                }
                infos.push(self.destination_mint.clone());
                if let Some(ref acc) = self.platform_fee_account {
                    infos.push(acc.clone());
                } else {
                    infos.push(self.program.clone());
                }
                infos.push(self.event_authority.clone());
                infos.push(self.program.clone());
                infos
            }
        }
    }

    #[derive(AnchorSerialize)]
    pub struct RouteArgs {
        pub route_plan: Vec<RoutePlanStep>,
        pub in_amount: u64,
        pub quoted_out_amount: u64,
        pub slippage_bps: u16,
        pub platform_fee_bps: u8,
    }

    pub struct Return<T> {
        data: T,
    }

    impl<T: Copy> Return<T> {
        pub fn get(&self) -> T {
            self.data
        }
    }

    pub fn route<'info>(
        ctx: CpiContext<'_, '_, '_, 'info, accounts::Route<'info>>,
        route_plan: Vec<RoutePlanStep>,
        in_amount: u64,
        quoted_out_amount: u64,
        slippage_bps: u16,
        platform_fee_bps: u8,
    ) -> Result<Return<u64>> {
        let mut data = Vec::with_capacity(256);
        // 8-byte discriminator for route: [229, 23, 203, 151, 122, 227, 173, 42]
        data.extend_from_slice(&[229, 23, 203, 151, 122, 227, 173, 42]);
        let args = RouteArgs {
            route_plan,
            in_amount,
            quoted_out_amount,
            slippage_bps,
            platform_fee_bps,
        };
        args.serialize(&mut data)?;

        let mut accounts = ctx.accounts.to_account_metas(None);
        accounts.extend(ctx.remaining_accounts.iter().map(|acc| {
            if acc.is_writable {
                AccountMeta::new(acc.key(), acc.is_signer)
            } else {
                AccountMeta::new_readonly(acc.key(), acc.is_signer)
            }
        }));

        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: ctx.program.key(),
            accounts,
            data,
        };

        let mut account_infos = ctx.accounts.to_account_infos();
        account_infos.extend(ctx.remaining_accounts.iter().cloned());

        if ctx.signer_seeds.is_empty() {
            anchor_lang::solana_program::program::invoke(&ix, &account_infos)?;
        } else {
            anchor_lang::solana_program::program::invoke_signed(&ix, &account_infos, ctx.signer_seeds)?;
        }

        let actual_out_amount = match anchor_lang::solana_program::program::get_return_data() {
            Some((program_id, return_data)) if program_id == ctx.program.key() => {
                if return_data.len() >= 8 {
                    u64::from_le_bytes(return_data[..8].try_into().unwrap_or([0; 8]))
                } else {
                    quoted_out_amount
                }
            }
            _ => quoted_out_amount,
        };

        Ok(Return { data: actual_out_amount })
    }
}
