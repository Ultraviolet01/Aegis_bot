import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

// Load the repo-root .env so the frontend, agent, and Anchor scripts all read one file.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../.env') });

const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  ...(process.env.VERCEL ? {} : { outputFileTracingRoot: resolve(here, '..') }),

  devIndicators: false,

  // Fix: motion@13 / framer-motion@13 require motion-utils to be explicitly
  // resolvable. Next.js webpack doesn't hoist it from the monorepo correctly.
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      'motion-utils': require.resolve('motion-utils'),
    };
    return config;
  },

  env: {
    NEXT_PUBLIC_SOLANA_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'http://localhost:8899',
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'http://localhost:8899',
    NEXT_PUBLIC_AEGIS_PROGRAM_ID: process.env.NEXT_PUBLIC_AEGIS_PROGRAM_ID || process.env.AEGIS_PROGRAM_ID || 'C67pkvsssWAB8j6vPmAfb2WB8uWWiPmkYfqEjK8HaG6L',
    NEXT_PUBLIC_USDC_MINT: process.env.NEXT_PUBLIC_USDC_MINT || process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
};

export default nextConfig;

