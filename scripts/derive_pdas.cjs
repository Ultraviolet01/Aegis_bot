const { PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const BN = require('bn.js');

const programId = new PublicKey("C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L");
const owner = new PublicKey("GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB");
const spyxMint = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");

const indexBn = new BN(0);
const [positionPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("position"),
    owner.toBuffer(),
    indexBn.toArrayLike(Buffer, "le", 8),
  ],
  programId
);

const positionVaultAta = getAssociatedTokenAddressSync(
  spyxMint,
  positionPda,
  true,
  TOKEN_2022_PROGRAM_ID
);

console.log("positionPda:", positionPda.toBase58());
console.log("positionVaultAta:", positionVaultAta.toBase58());
