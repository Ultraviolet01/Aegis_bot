/**
 * Program IDL type definition for Aegis.
 */
export type Aegis = {
  address: "C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L";
  metadata: {
    name: "aegis";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Aegis on-chain risk guardian program";
  };
  instructions: [
    {
      name: "initialize";
      discriminator: [175, 175, 109, 31, 13, 152, 155, 237];
      accounts: [
        { name: "config"; writable: true },
        { name: "authority"; writable: true; signer: true },
        { name: "systemProgram" }
      ];
      args: [
        { name: "agent"; type: "pubkey" },
        { name: "usdcMint"; type: "pubkey" }
      ];
    },
    {
      name: "openPosition";
      discriminator: [135, 128, 47, 77, 15, 152, 240, 49];
      accounts: [
        { name: "config"; writable: true },
        { name: "position"; writable: true },
        { name: "positionVault"; writable: true },
        { name: "assetMint" },
        { name: "ownerTokenAccount"; writable: true },
        { name: "owner"; writable: true; signer: true },
        { name: "tokenProgram" },
        { name: "associatedTokenProgram" },
        { name: "systemProgram" }
      ];
      args: [
        { name: "amount"; type: "u64" }
      ];
    },
    {
      name: "setPolicy";
      discriminator: [248, 169, 138, 201, 164, 182, 187, 85];
      accounts: [
        { name: "config" },
        { name: "position"; writable: true },
        { name: "policy"; writable: true },
        { name: "owner"; signer: true },
        { name: "systemProgram" }
      ];
      args: [
        { name: "drawdownBps"; type: "u16" },
        { name: "oracleDeviationBps"; type: "u16" },
        { name: "exitBps"; type: "u16" },
        { name: "maxSlippageBps"; type: "u16" },
        { name: "targetMint"; type: "pubkey" }
      ];
    },
    {
      name: "deactivatePolicy";
      discriminator: [222, 114, 197, 82, 238, 161, 162, 111];
      accounts: [
        { name: "position"; writable: true },
        { name: "policy"; writable: true },
        { name: "owner"; signer: true }
      ];
      args: [];
    },
    {
      name: "pausePosition";
      discriminator: [211, 22, 221, 251, 74, 121, 193, 239];
      accounts: [
        { name: "config" },
        { name: "position"; writable: true },
        { name: "caller"; signer: true }
      ];
      args: [];
    },
    {
      name: "unpausePosition";
      discriminator: [209, 144, 160, 141, 14, 212, 129, 237];
      accounts: [
        { name: "position"; writable: true },
        { name: "owner"; signer: true }
      ];
      args: [];
    },
    {
      name: "withdraw";
      discriminator: [183, 18, 70, 156, 148, 109, 161, 34];
      accounts: [
        { name: "position"; writable: true },
        { name: "positionVault"; writable: true },
        { name: "ownerTokenAccount"; writable: true },
        { name: "assetMint" },
        { name: "owner"; signer: true },
        { name: "tokenProgram" },
        { name: "associatedTokenProgram" },
        { name: "systemProgram" }
      ];
      args: [
        { name: "amount"; type: "u64" }
      ];
    },
    {
      name: "swapAndDeliver";
      discriminator: [15, 62, 110, 246, 219, 212, 152, 40];
      accounts: [
        { name: "config" },
        { name: "position"; writable: true },
        { name: "policy" },
        { name: "positionVault"; writable: true },
        { name: "assetMint" },
        { name: "targetMint" },
        { name: "ownerDestinationAta"; writable: true },
        { name: "agent"; writable: true; signer: true },
        { name: "tokenProgram" },
        { name: "associatedTokenProgram" },
        { name: "systemProgram" }
      ];
      args: [
        { name: "exitBps"; type: "u16" },
        { name: "quotedOutAmount"; type: "u64" },
        { name: "swapData"; type: "bytes" }
      ];
    },
    {
      name: "updateAgent";
      discriminator: [85, 90, 8, 207, 193, 10, 157, 145];
      accounts: [
        { name: "config"; writable: true },
        { name: "authority"; signer: true }
      ];
      args: [
        { name: "newAgent"; type: "pubkey" }
      ];
    }
  ];
  accounts: [
    {
      name: "aegisConfig";
      discriminator: [67, 153, 175, 39, 218, 16, 140, 180];
    },
    {
      name: "position";
      discriminator: [170, 188, 143, 228, 122, 64, 247, 208];
    },
    {
      name: "policy";
      discriminator: [202, 63, 244, 208, 107, 198, 238, 245];
    }
  ];
  types: [
    {
      name: "aegisConfig";
      type: {
        kind: "struct";
        fields: [
          { name: "authority"; type: "pubkey" },
          { name: "agent"; type: "pubkey" },
          { name: "usdcMint"; type: "pubkey" },
          { name: "totalPositions"; type: "u64" },
          { name: "bump"; type: "u8" }
        ];
      };
    },
    {
      name: "position";
      type: {
        kind: "struct";
        fields: [
          { name: "owner"; type: "pubkey" },
          { name: "assetMint"; type: "pubkey" },
          { name: "amount"; type: "u64" },
          { name: "policy"; type: { option: "pubkey" } },
          { name: "paused"; type: "bool" },
          { name: "bump"; type: "u8" },
          { name: "index"; type: "u64" }
        ];
      };
    },
    {
      name: "policy";
      type: {
        kind: "struct";
        fields: [
          { name: "position"; type: "pubkey" },
          { name: "drawdownBps"; type: "u16" },
          { name: "oracleDeviationBps"; type: "u16" },
          { name: "exitBps"; type: "u16" },
          { name: "maxSlippageBps"; type: "u16" },
          { name: "targetMint"; type: "pubkey" },
          { name: "createdAt"; type: "i64" },
          { name: "active"; type: "bool" }
        ];
      };
    }
  ];
};
