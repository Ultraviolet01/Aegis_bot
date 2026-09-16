const { Keypair, PublicKey } = require("@solana/web3.js");
const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } = require("@solana/spl-token");

const seed = Buffer.alloc(32, 7);
const kp = Keypair.fromSeed(seed);
console.log("Deterministic owner pubkey:", kp.publicKey.toBase58());
const spyxMint = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
const ata = getAssociatedTokenAddressSync(spyxMint, kp.publicKey, false, TOKEN_2022_PROGRAM_ID);
console.log("Deterministic owner SPYX ATA:", ata.toBase58());
