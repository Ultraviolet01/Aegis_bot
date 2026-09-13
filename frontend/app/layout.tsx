import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SolanaWalletProvider } from '@/lib/wallet-provider';

export const metadata: Metadata = {
  title: 'Aegis — Non-custodial AI risk guardian for tokenized stocks on Solana',
  description:
    'Write your risk limits in plain English. Aegis turns them into on-chain policy and guards your tokenised stock positions on Solana — non-custodially. Your keys, your vault, your withdrawal.',
  openGraph: {
    title: 'Aegis — tokenized stocks, guarded by a rule you wrote',
    description:
      'Non-custodial AI risk guardian for xStocks on Solana. Plain-English policy, enforced on-chain. Always-on protection — unlike a brokerage, it never sleeps.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f2efe6',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>
        <SolanaWalletProvider>
          {children}
        </SolanaWalletProvider>
      </body>
    </html>
  );
}

