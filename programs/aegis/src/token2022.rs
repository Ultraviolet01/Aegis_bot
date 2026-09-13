use anchor_lang::prelude::*;

/// Multiplier state extracted from on-chain Token-2022 mint extensions.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub struct MintMultiplierInfo {
    /// Active multiplier (e.g. 1.005714 for SPYX post-dividend).
    pub multiplier: f64,
    /// Multiplier as integer scaled by 1,000,000 (micro-units, 6 decimal precision).
    pub multiplier_scaled: u64,
    /// Pending multiplier published for future corporate action (0 if none).
    pub new_multiplier: f64,
    /// Pending multiplier scaled by 1,000,000.
    pub new_multiplier_scaled: u64,
    /// Unix timestamp when pending multiplier becomes effective (0 if none).
    pub effective_timestamp: i64,
    /// Whether the mint uses Token-2022 ScaledUiAmountConfig extension.
    pub is_scaled_ui_token: bool,
}

/// Token-2022 ExtensionType for ScaledUiAmountConfig is 25 (0x0019).
pub const SCALED_UI_AMOUNT_CONFIG_TYPE: u16 = 25;
/// Base SPL Mint struct size is 82 bytes.
pub const BASE_MINT_LEN: usize = 82;

/// Safely inspects a mint account info on-chain and reads the ScaledUiAmountConfig extension.
/// Supports both Token-2022 mints (such as SPYX) and standard SPL Token mints.
pub fn read_mint_multiplier(mint_info: &AccountInfo) -> Result<MintMultiplierInfo> {
    // Check if account is owned by Token-2022 program
    if mint_info.owner == &anchor_spl::token_2022::ID {
        let data = mint_info.try_borrow_data()?;
        // Token-2022 mint with extensions has:
        // [0..82]: Base Mint
        // [82]: AccountType::Mint (1)
        // [83..]: TLV entries: (u16 type, u16 length, bytes)
        if data.len() > BASE_MINT_LEN + 1 {
            let mut offset = BASE_MINT_LEN + 1;
            while offset + 4 <= data.len() {
                let ext_type = u16::from_le_bytes([data[offset], data[offset + 1]]);
                let ext_len = u16::from_le_bytes([data[offset + 2], data[offset + 3]]) as usize;
                offset += 4;

                if ext_type == SCALED_UI_AMOUNT_CONFIG_TYPE && offset + ext_len <= data.len() {
                    let ext_data = &data[offset..offset + ext_len];
                    if ext_data.len() >= 56 {
                        // TLV layout for ScaledUiAmountConfig:
                        // authority: [0..32] Pubkey
                        // multiplier: [32..40] f64 little-endian
                        // new_multiplier_effective_timestamp: [40..48] i64 little-endian
                        // new_multiplier: [48..56] f64 little-endian
                        let multiplier = f64::from_le_bytes(
                            ext_data[32..40].try_into().unwrap_or([0u8; 8]),
                        );
                        let effective_timestamp = i64::from_le_bytes(
                            ext_data[40..48].try_into().unwrap_or([0u8; 8]),
                        );
                        let new_multiplier = f64::from_le_bytes(
                            ext_data[48..56].try_into().unwrap_or([0u8; 8]),
                        );

                        return Ok(MintMultiplierInfo {
                            multiplier,
                            multiplier_scaled: (multiplier * 1_000_000.0) as u64,
                            new_multiplier,
                            new_multiplier_scaled: (new_multiplier * 1_000_000.0) as u64,
                            effective_timestamp,
                            is_scaled_ui_token: true,
                        });
                    }
                }
                offset += ext_len;
            }
        }
    }

    // Fallback for standard SPL token mints (multiplier is 1.0, no pending actions)
    Ok(MintMultiplierInfo {
        multiplier: 1.0,
        multiplier_scaled: 1_000_000,
        new_multiplier: 1.0,
        new_multiplier_scaled: 1_000_000,
        effective_timestamp: 0,
        is_scaled_ui_token: false,
    })
}
