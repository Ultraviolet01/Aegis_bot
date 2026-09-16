const anchor = require("@coral-xyz/anchor");
const fs = require("fs");
const os = require("os");
const path = require("path");

const walletPath = path.resolve(os.homedir(), ".config/solana/id.json");
console.log("Wallet path:", walletPath);
if (fs.existsSync(walletPath)) {
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const keypair = anchor.web3.Keypair.fromSecretKey(new Uint8Array(secretKey));
  console.log("Genesis wallet pubkey:", keypair.publicKey.toBase58());
} else {
  console.log("Wallet path does not exist!");
}
