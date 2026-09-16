import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, getScaledUiAmountConfig, getExtensionTypes, ExtensionType, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

async function getOnChainMultiplierState(connection, mintPubkey) {
  try {
    const mintInfo = await getMint(
      connection,
      mintPubkey,
      'confirmed',
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

    const actions = [];
    if (hasPendingAction) {
      const pctChange = Math.abs((newMultiplier - currentMultiplier) / currentMultiplier);
      const DIVIDEND_THRESHOLD = 0.05; // Changes < 5% are dividends, not splits

      let actionType;
      if (pctChange < DIVIDEND_THRESHOLD) {
        actionType = 'dividend';
      } else if (newMultiplier > currentMultiplier) {
        actionType = 'split';
      } else {
        actionType = 'reverse_split';
      }

      actions.push({
        mint: mintPubkey.toBase58(),
        symbol: 'SPYx',
        actionType,
        newMultiplier,
        oldMultiplier: currentMultiplier,
        exDate: new Date(activationTime * 1000).toISOString().split('T')[0],
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
    return { error: err.message };
  }
}

async function main() {
  const mintAddress = 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W';
  console.log(`Connecting to Solana mainnet-beta to inspect SPYx mint: ${mintAddress}...\n`);
  
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  const mintPubkey = new PublicKey(mintAddress);

  // 1. Fetch raw mint info using Token-2022
  const mintInfo = await getMint(connection, mintPubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
  
  console.log('--- Mint Overview ---');
  console.log('Address:', mintInfo.address.toBase58());
  console.log('Decimals:', mintInfo.decimals);
  console.log('Supply:', mintInfo.supply.toString());
  console.log('Mint Authority:', mintInfo.mintAuthority?.toBase58() ?? 'None');
  console.log('Freeze Authority:', mintInfo.freezeAuthority?.toBase58() ?? 'None');

  // 2. Inspect Extension types on this mint
  const extensionTypes = getExtensionTypes(mintInfo.tlvData);
  console.log('\n--- Token-2022 Extensions Found ---');
  console.log('Raw extension IDs:', extensionTypes);
  for (const extId of extensionTypes) {
    const name = ExtensionType[extId] ?? `Unknown (${extId})`;
    console.log(`  - Extension ${extId}: ${name}`);
  }

  // 3. Inspect ScaledUiAmountConfig directly
  const scaledConfig = getScaledUiAmountConfig(mintInfo);
  console.log('\n--- ScaledUiAmountConfig Raw Layout ---');
  if (scaledConfig) {
    console.log('Authority:', scaledConfig.authority.toBase58());
    console.log('Multiplier (f64):', scaledConfig.multiplier);
    console.log('New Multiplier (f64):', scaledConfig.newMultiplier);
    console.log('New Multiplier Effective Timestamp (i64):', scaledConfig.newMultiplierEffectiveTimestamp.toString());
  } else {
    console.log('No ScaledUiAmountConfig extension found on this mint.');
  }

  // 4. Run our getOnChainMultiplierState function
  console.log('\n--- getOnChainMultiplierState Actual Return Value ---');
  const state = await getOnChainMultiplierState(connection, mintPubkey);
  console.log(JSON.stringify(state, null, 2));
}

main().catch(console.error);
