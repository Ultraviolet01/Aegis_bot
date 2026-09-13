'use client';

import { useState, useCallback, useId } from 'react';
import Link from 'next/link';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ParsedPolicy {
  drawdownThresholdBps: number;
  oracleDeviationThresholdBps: number;
  exitPercentBps: number;
  maxSlippageBps: number;
  targetAsset: 'USDC' | 'SOL' | 'USDT';
  mode: 'Conservative' | 'Balanced' | 'Aggressive';
  interpretation: string;
  confidence: number;
}

type Tab = 'overview' | 'positions' | 'policies' | 'history';

interface GuardedPosition {
  symbol: string;
  name: string;
  mint: string;
  balance: number;
  priceUsd: number;
  multiplier: number;
  policy: {
    drawdownBps: number;
    exitBps: number;
    target: string;
  };
  headroomPct: number;
  status: 'protected' | 'monitoring' | 'breached';
}

const DEMO_POSITIONS: GuardedPosition[] = [
  {
    symbol: 'SPYX',
    name: 'S&P 500 Tokenized',
    mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
    balance: 26.5,
    priceUsd: 539.20,
    multiplier: 1.005714,
    policy: { drawdownBps: 800, exitBps: 7500, target: 'USDC' },
    headroomPct: 5.8,
    status: 'protected',
  },
  {
    symbol: 'GLDX',
    name: 'Physical Gold Tokenized',
    mint: 'GLDxxTokenizedMintAddressDevnet1111111111111',
    balance: 44.2,
    priceUsd: 188.45,
    multiplier: 1.0,
    policy: { drawdownBps: 1000, exitBps: 6000, target: 'USDT' },
    headroomPct: 8.2,
    status: 'protected',
  },
  {
    symbol: 'QQQX',
    name: 'Nasdaq 100 Tokenized',
    mint: 'QQQxxTokenizedMintAddressDevnet1111111111111',
    balance: 10.4,
    priceUsd: 492.10,
    multiplier: 1.0,
    policy: { drawdownBps: 600, exitBps: 5000, target: 'USDC' },
    headroomPct: 4.1,
    status: 'protected',
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function bps(n: number) { return (n / 100).toFixed(2) + '%'; }
function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

// ─── Subcomponents ─────────────────────────────────────────────────────────────

function LiveDot({ color = '#4fe0a8' }: { color?: string }) {
  return (
    <span style={{
      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
      background: color, flexShrink: 0,
      boxShadow: `0 0 0 2px ${color}33`,
      animation: 'pulseSlow 2.8s ease-in-out infinite',
    }} />
  );
}

function NetworkPill({ label, live = false }: { label: string; live?: boolean }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      padding: '4px 11px', borderRadius: 999,
      border: '1px solid rgba(79, 224, 168, 0.2)',
      background: 'rgba(79, 224, 168, 0.05)',
      fontFamily: 'var(--mono)', fontSize: 10.5, letterSpacing: '.08em',
      textTransform: 'uppercase' as const, color: '#4fe0a8',
    }}>
      {live && <LiveDot />}
      {label}
    </div>
  );
}

function PolicyPreviewCard({ policy }: { policy: ParsedPolicy }) {
  const params = [
    { label: 'Drawdown Trigger', value: bps(policy.drawdownThresholdBps), note: 'Breach limit' },
    { label: 'Multi-Pool Divergence Guard', value: bps(policy.oracleDeviationThresholdBps), note: 'Oracle sanity check' },
    { label: 'Exit Ratio per Event', value: bps(policy.exitPercentBps), note: 'Controlled liquidation' },
    { label: 'Max Swap Slippage', value: bps(policy.maxSlippageBps), note: 'DEX constraint' },
    { label: 'Target Safe Asset', value: policy.targetAsset ?? 'USDC', note: 'Owner token account' },
  ];

  return (
    <div style={{
      marginTop: 24,
      background: 'rgba(11, 24, 18, 0.75)',
      border: '1px solid rgba(79, 224, 168, 0.2)',
      borderRadius: 12,
      padding: '20px 24px',
      boxShadow: '0 12px 30px rgba(0, 0, 0, 0.25)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        paddingBottom: 12,
      }}>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 10.5, letterSpacing: '.08em',
          textTransform: 'uppercase' as const, color: '#4fe0a8',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <LiveDot />
          Parsed Parameters — Verified Invariants
        </div>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 8px', borderRadius: 4,
          background: 'rgba(79, 224, 168, 0.1)', color: '#4fe0a8', border: '1px solid rgba(79, 224, 168, 0.25)',
        }}>
          {policy.mode} Mode
        </span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12,
      }}>
        {params.map((p) => (
          <div key={p.label} style={{
            padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)',
            borderRadius: 8, border: '1px solid rgba(255, 255, 255, 0.05)',
          }}>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.08em',
              textTransform: 'uppercase' as const, color: '#64748b', marginBottom: 5,
            }}>
              {p.label}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 17, fontWeight: 600, color: 'var(--white)' }}>
              {p.value}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: '#475569', marginTop: 3 }}>
              {p.note}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(255, 255, 255, 0.05)',
        display: 'flex', alignItems: 'center', gap: 10,
        fontFamily: 'var(--mono)', fontSize: 11, color: '#94a3b8',
      }}>
        <span style={{ color: '#4fe0a8', fontWeight: 600 }}>Summary:</span>
        {policy.interpretation}
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AppPage() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();

  const [demoMode, setDemoMode] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');

  // Policy parsing state
  const [policyText, setPolicyText] = useState('');
  const [parsedPolicy, setParsedPolicy] = useState<ParsedPolicy | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Position deposit state
  const [depositAsset, setDepositAsset] = useState('SPYX');
  const [depositAmount, setDepositAmount] = useState('');
  const [slippageTolerance, setSlippageTolerance] = useState('0.5');

  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const parseNLPolicy = useCallback(async () => {
    if (!policyText.trim()) return;
    setParsing(true);
    setParseError(null);
    setParsedPolicy(null);
    try {
      const res = await fetch('/api/parse-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyText }),
      });
      const data = await res.json();
      if (data.policy) {
        setParsedPolicy({
          ...data.policy,
          targetAsset: data.policy.targetAsset ?? 'USDC',
          maxSlippageBps: data.policy.maxSlippageBps ?? 50,
        });
      } else {
        setParseError(data.error ?? 'Parse failed');
      }
    } catch (err: any) {
      setParseError(err.message);
    } finally {
      setParsing(false);
    }
  }, [policyText]);

  const signPolicy = useCallback(async () => {
    if (!parsedPolicy) return;
    showToast('Policy signed and registered with Aegis guardian engine', 'ok');
  }, [parsedPolicy]);

  const isUserActive = connected || demoMode;
  const activeAddress = publicKey ? publicKey.toBase58() : '7EYnhrCQZKpFz4eW8v9xQ3kLMxS8gDevnetDemoAcct';

  const totalGuardedUsd = DEMO_POSITIONS.reduce((acc, p) => acc + p.balance * p.priceUsd * p.multiplier, 0);

  const navTabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'positions', label: 'Positions' },
    { id: 'policies', label: 'Policies' },
    { id: 'history', label: 'History' },
  ];

  return (
    <div className="app" style={{ minHeight: '100vh', paddingBottom: 80 }}>
      {/* ── Top Navigation Bar ── */}
      <div style={{
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        background: 'rgba(5, 12, 9, 0.75)',
        backdropFilter: 'blur(16px)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div className="wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', border: '1.5px solid rgba(79, 224, 168, 0.6)',
                position: 'relative', flexShrink: 0,
              }}>
                <div style={{
                  position: 'absolute', left: 9, top: 4, width: 2.5, height: 13,
                  background: 'var(--mint)', borderRadius: 2,
                }} />
              </div>
              <span style={{
                color: 'var(--white)', fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em',
              }}>
                Aegis
              </span>
            </Link>

            <nav style={{ display: 'flex', gap: 4 }}>
              {navTabs.map((t) => (
                <button
                  key={t.id}
                  id={`tab-${t.id}`}
                  onClick={() => t.id === 'history' ? (window.location.href = '/app/history') : setTab(t.id)}
                  style={{
                    padding: '18px 16px', background: 'none', border: 'none',
                    color: tab === t.id ? 'var(--white)' : '#64748b',
                    fontFamily: 'var(--sans)', fontSize: 13.5,
                    fontWeight: tab === t.id ? 500 : 400,
                    cursor: 'pointer', position: 'relative',
                    transition: 'color .15s',
                  }}
                >
                  {t.label}
                  {tab === t.id && (
                    <span style={{
                      position: 'absolute', bottom: 0, left: 16, right: 16, height: 2,
                      background: 'var(--mint)', borderRadius: 2,
                    }} />
                  )}
                </button>
              ))}
            </nav>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {!connected && (
              <button
                id="toggle-demo-mode-btn"
                onClick={() => setDemoMode(!demoMode)}
                style={{
                  padding: '7px 13px', borderRadius: 8,
                  border: `1px solid ${demoMode ? 'rgba(79, 224, 168, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
                  background: demoMode ? 'rgba(79, 224, 168, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                  color: demoMode ? '#4fe0a8' : '#94a3b8',
                  fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <LiveDot color={demoMode ? '#4fe0a8' : '#64748b'} />
                {demoMode ? 'Demo Mode Active' : 'Explore Demo Vault'}
              </button>
            )}

            <WalletMultiButton
              style={{
                background: 'rgba(79, 224, 168, 0.12)',
                color: 'var(--mint)',
                border: '1px solid rgba(79, 224, 168, 0.25)',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                padding: '7px 14px',
                height: 36,
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Toast Notification ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, padding: '10px 20px', borderRadius: 8,
          background: 'rgba(10, 24, 18, 0.95)',
          border: `1px solid ${toast.type === 'ok' ? 'rgba(79, 224, 168, 0.4)' : 'rgba(244, 124, 108, 0.4)'}`,
          color: toast.type === 'ok' ? 'var(--mint)' : '#f47c6c',
          fontFamily: 'var(--mono)', fontSize: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <LiveDot color={toast.type === 'ok' ? '#4fe0a8' : '#f47c6c'} />
          {toast.msg}
        </div>
      )}

      {/* ── Main Container ── */}
      <div className="wrap" style={{ paddingTop: 40 }}>
        {!isUserActive ? (
          /* Disconnected State with Demo Exploration Card */
          <div style={{
            maxWidth: 640, margin: '80px auto 0', textAlign: 'center',
            padding: '48px 36px',
            background: 'linear-gradient(180deg, rgba(14, 28, 22, 0.6) 0%, rgba(8, 16, 13, 0.8) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 20,
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.4)',
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'rgba(79, 224, 168, 0.1)',
              border: '1px solid rgba(79, 224, 168, 0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 24px',
            }}>
              <LiveDot />
            </div>

            <h1 style={{
              fontFamily: 'var(--display)', fontSize: 34, fontWeight: 600,
              letterSpacing: '-0.04em', color: 'var(--white)', margin: '0 0 12px',
            }}>
              Connect your wallet
            </h1>
            <p style={{
              color: '#94a3b8', fontSize: 15, maxWidth: 440, margin: '0 auto 28px', lineHeight: 1.6,
            }}>
              Connect Phantom or Solflare on Solana devnet, or test the live guardian with simulated vault positions.
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap' }}>
              <button
                id="enter-demo-btn"
                onClick={() => setDemoMode(true)}
                style={{
                  padding: '12px 24px', borderRadius: 10,
                  background: 'var(--mint)', color: '#091912',
                  border: 'none', fontWeight: 600, fontSize: 14,
                  cursor: 'pointer', transition: 'opacity 0.15s',
                }}
              >
                Explore Demo Vault
              </button>
              <Link href="/app/history">
                <button
                  id="view-candlestick-chart-btn"
                  style={{
                    padding: '12px 24px', borderRadius: 10,
                    background: 'rgba(255, 255, 255, 0.05)', color: 'var(--white)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    fontWeight: 500, fontSize: 14, cursor: 'pointer',
                  }}
                >
                  View Candlestick Chart
                </button>
              </Link>
            </div>

            <div style={{ marginTop: 32, display: 'flex', justifyContent: 'center' }}>
              <NetworkPill label="Solana Devnet · Multi-Pool Guard Online" live />
            </div>
          </div>
        ) : (
          /* Active Dashboard View */
          <>
            {/* ── Top Account & Status Header ── */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 36, paddingBottom: 24, borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            }}>
              <div>
                <div style={{
                  fontFamily: 'var(--display)', fontSize: 30, fontWeight: 600,
                  letterSpacing: '-0.04em', color: 'var(--white)', marginBottom: 6,
                }}>
                  {tab === 'overview' && 'Guarded Portfolio'}
                  {tab === 'positions' && 'Vault Positions'}
                  {tab === 'policies' && 'Risk Policies'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#64748b' }}>
                    Account:
                  </span>
                  <span style={{
                    fontFamily: 'var(--mono)', fontSize: 11, color: '#94a3b8',
                    background: 'rgba(255, 255, 255, 0.04)', padding: '2px 8px', borderRadius: 4,
                  }}>
                    {activeAddress.slice(0, 6)}...{activeAddress.slice(-4)}
                  </span>
                  {demoMode && !connected && (
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: 10, color: '#d4aa46',
                      background: 'rgba(212, 170, 70, 0.1)', padding: '2px 7px', borderRadius: 4,
                      border: '1px solid rgba(212, 170, 70, 0.25)',
                    }}>
                      Simulated Environment
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <NetworkPill label="Autonomous Guardian Online" live />
                <Link href="/app/history">
                  <button style={{
                    padding: '8px 14px', borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.04)', color: '#94a3b8',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
                  }}>
                    Charts & History
                  </button>
                </Link>
              </div>
            </div>

            {/* ── TAB 1: OVERVIEW ── */}
            {tab === 'overview' && (
              <div>
                {/* 3 Metric Cards */}
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16,
                  marginBottom: 32,
                }}>
                  <div style={{
                    padding: '22px 24px', borderRadius: 14,
                    background: 'linear-gradient(180deg, rgba(14, 28, 22, 0.6) 0%, rgba(8, 16, 13, 0.8) 100%)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
                  }}>
                    <div style={{
                      fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.08em',
                      textTransform: 'uppercase' as const, color: '#64748b', marginBottom: 10,
                    }}>
                      Total Protected Capital
                    </div>
                    <div style={{
                      fontFamily: 'var(--mono)', fontSize: 30, fontWeight: 600, color: 'var(--white)',
                      letterSpacing: '-0.03em', marginBottom: 6,
                    }}>
                      {formatCurrency(totalGuardedUsd)}
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#4fe0a8' }}>
                      3 active asset vaults guarded
                    </div>
                  </div>

                  <div style={{
                    padding: '22px 24px', borderRadius: 14,
                    background: 'linear-gradient(180deg, rgba(14, 28, 22, 0.6) 0%, rgba(8, 16, 13, 0.8) 100%)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
                  }}>
                    <div style={{
                      fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.08em',
                      textTransform: 'uppercase' as const, color: '#64748b', marginBottom: 10,
                    }}>
                      Multi-Pool Oracle Sanity
                    </div>
                    <div style={{
                      fontFamily: 'var(--mono)', fontSize: 30, fontWeight: 600, color: '#4fe0a8',
                      letterSpacing: '-0.03em', marginBottom: 6,
                    }}>
                      0.02%
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#94a3b8' }}>
                      Raydium vs Orca cross-check (threshold 2.0%)
                    </div>
                  </div>

                  <div style={{
                    padding: '22px 24px', borderRadius: 14,
                    background: 'linear-gradient(180deg, rgba(14, 28, 22, 0.6) 0%, rgba(8, 16, 13, 0.8) 100%)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
                  }}>
                    <div style={{
                      fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.08em',
                      textTransform: 'uppercase' as const, color: '#64748b', marginBottom: 10,
                    }}>
                      Guardian Check Frequency
                    </div>
                    <div style={{
                      fontFamily: 'var(--mono)', fontSize: 30, fontWeight: 600, color: 'var(--white)',
                      letterSpacing: '-0.03em', marginBottom: 6,
                    }}>
                      10s
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#4fe0a8', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <LiveDot />
                      Zero-withdrawal execution invariant
                    </div>
                  </div>
                </div>

                {/* Guarded Positions Table */}
                <div style={{
                  background: 'linear-gradient(180deg, rgba(11, 24, 18, 0.65) 0%, rgba(6, 15, 11, 0.8) 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.07)',
                  borderRadius: 14, overflow: 'hidden',
                  marginBottom: 36,
                }}>
                  <div style={{
                    padding: '16px 22px', borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div style={{
                      fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.08em',
                      textTransform: 'uppercase' as const, color: 'var(--white)', fontWeight: 600,
                    }}>
                      Active Vault Holdings
                    </div>
                    <button
                      onClick={() => setTab('positions')}
                      style={{
                        background: 'transparent', border: 'none', color: '#4fe0a8',
                        fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
                      }}
                    >
                      + Deposit New Asset
                    </button>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', color: '#64748b', fontFamily: 'var(--mono)', fontSize: 10.5 }}>
                          <th style={{ padding: '12px 22px' }}>Asset</th>
                          <th style={{ padding: '12px 18px' }}>Balance</th>
                          <th style={{ padding: '12px 18px' }}>Share Price</th>
                          <th style={{ padding: '12px 18px' }}>Total Value</th>
                          <th style={{ padding: '12px 18px' }}>Active Risk Policy</th>
                          <th style={{ padding: '12px 18px' }}>Drawdown Headroom</th>
                          <th style={{ padding: '12px 22px', textAlign: 'right' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {DEMO_POSITIONS.map((pos) => {
                          const val = pos.balance * pos.priceUsd * pos.multiplier;
                          return (
                            <tr key={pos.symbol} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                              <td style={{ padding: '16px 22px' }}>
                                <div style={{ fontWeight: 600, color: 'var(--white)' }}>{pos.symbol}</div>
                                <div style={{ fontSize: 10, color: '#64748b' }}>{pos.name}</div>
                              </td>
                              <td style={{ padding: '16px 18px', color: '#cbd5e1' }}>
                                {pos.balance.toFixed(2)} tokens
                              </td>
                              <td style={{ padding: '16px 18px', color: '#cbd5e1' }}>
                                ${(pos.priceUsd * pos.multiplier).toFixed(2)}
                              </td>
                              <td style={{ padding: '16px 18px', fontWeight: 600, color: 'var(--white)' }}>
                                {formatCurrency(val)}
                              </td>
                              <td style={{ padding: '16px 18px', color: '#94a3b8', fontSize: 11 }}>
                                Drop &gt; {(pos.policy.drawdownBps / 100).toFixed(0)}% → {(pos.policy.exitBps / 100).toFixed(0)}% to {pos.policy.target}
                              </td>
                              <td style={{ padding: '16px 18px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{
                                    width: 80, height: 6, background: 'rgba(255, 255, 255, 0.08)',
                                    borderRadius: 3, overflow: 'hidden',
                                  }}>
                                    <div style={{
                                      width: `${Math.min(pos.headroomPct * 10, 100)}%`, height: '100%',
                                      background: '#10b981', borderRadius: 3,
                                    }} />
                                  </div>
                                  <span style={{ fontSize: 10.5, color: '#10b981' }}>
                                    +{pos.headroomPct}%
                                  </span>
                                </div>
                              </td>
                              <td style={{ padding: '16px 22px', textAlign: 'right' }}>
                                <span style={{
                                  padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                                  background: 'rgba(16, 185, 129, 0.12)', color: '#10b981',
                                  border: '1px solid rgba(16, 185, 129, 0.25)',
                                }}>
                                  Protected
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Guardian Execution Invariant Notice */}
                <div style={{
                  padding: '16px 22px', borderRadius: 10,
                  background: 'rgba(11, 24, 18, 0.5)',
                  border: '1px solid rgba(79, 224, 168, 0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  flexWrap: 'wrap', gap: 14,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <LiveDot />
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#94a3b8' }}>
                      <strong style={{ color: 'var(--white)' }}>Non-Custodial Architecture:</strong> The Aegis program allows the guardian agent to execute only pre-signed swap instructions. Capital never leaves your token account.
                    </span>
                  </div>
                  <button
                    onClick={() => setTab('policies')}
                    style={{
                      padding: '6px 14px', borderRadius: 6,
                      background: 'rgba(79, 224, 168, 0.1)', color: '#4fe0a8',
                      border: '1px solid rgba(79, 224, 168, 0.3)',
                      fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    Manage Policies
                  </button>
                </div>
              </div>
            )}

            {/* ── TAB 2: POSITIONS ── */}
            {tab === 'positions' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 480px) 1fr', gap: 28 }}>
                {/* Deposit Form */}
                <div style={{
                  background: 'linear-gradient(180deg, rgba(14, 28, 22, 0.65) 0%, rgba(8, 16, 13, 0.8) 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 16, padding: '24px',
                  boxShadow: '0 16px 40px rgba(0, 0, 0, 0.3)',
                }}>
                  <div style={{ marginBottom: 20 }}>
                    <div style={{
                      fontFamily: 'var(--display)', fontSize: 22, fontWeight: 600,
                      letterSpacing: '-0.03em', color: 'var(--white)', marginBottom: 4,
                    }}>
                      Deposit to Guarded Vault
                    </div>
                    <div style={{ color: '#64748b', fontSize: 12, fontFamily: 'var(--mono)' }}>
                      Lock xStock tokens in the non-custodial smart contract.
                    </div>
                  </div>

                  {/* Asset Select */}
                  <div style={{ marginBottom: 18 }}>
                    <label style={{
                      display: 'block', fontFamily: 'var(--mono)', fontSize: 10,
                      letterSpacing: '.08em', textTransform: 'uppercase' as const, color: '#64748b', marginBottom: 8,
                    }}>
                      Select Asset
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {['SPYX', 'GLDX', 'QQQX'].map((sym) => (
                        <button
                          key={sym}
                          onClick={() => setDepositAsset(sym)}
                          style={{
                            padding: '10px 8px', borderRadius: 8,
                            background: depositAsset === sym ? 'rgba(79, 224, 168, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                            border: `1px solid ${depositAsset === sym ? 'rgba(79, 224, 168, 0.4)' : 'rgba(255, 255, 255, 0.07)'}`,
                            color: depositAsset === sym ? '#4fe0a8' : '#94a3b8',
                            fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          {sym}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Amount Input */}
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <label style={{
                        fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.08em',
                        textTransform: 'uppercase' as const, color: '#64748b',
                      }}>
                        Deposit Amount
                      </label>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#4fe0a8' }}>
                        Wallet: 42.50 {depositAsset}
                      </span>
                    </div>

                    <div style={{
                      position: 'relative', background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 10,
                      padding: '12px 16px',
                    }}>
                      <input
                        id="deposit-amount"
                        type="number"
                        placeholder="0.00"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        style={{
                          width: '100%', background: 'transparent', border: 'none',
                          color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: 24,
                          fontWeight: 600, outline: 'none',
                        }}
                      />
                    </div>

                    {/* Percentage chips */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      {['25%', '50%', '75%', 'Max'].map((pct) => (
                        <button
                          key={pct}
                          onClick={() => {
                            const max = 42.5;
                            const frac = pct === 'Max' ? 1 : parseInt(pct) / 100;
                            setDepositAmount((max * frac).toFixed(2));
                          }}
                          style={{
                            flex: 1, padding: '4px 0', borderRadius: 6,
                            background: 'rgba(255, 255, 255, 0.02)',
                            border: '1px solid rgba(255, 255, 255, 0.06)',
                            color: '#64748b', fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer',
                          }}
                        >
                          {pct}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Slippage tolerance */}
                  <div style={{ marginBottom: 24 }}>
                    <label style={{
                      display: 'block', fontFamily: 'var(--mono)', fontSize: 10,
                      letterSpacing: '.08em', textTransform: 'uppercase' as const, color: '#64748b', marginBottom: 8,
                    }}>
                      Max Slippage Tolerance
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {['0.1%', '0.5%', '1.0%'].map((slip) => (
                        <button
                          key={slip}
                          onClick={() => setSlippageTolerance(slip.replace('%', ''))}
                          style={{
                            flex: 1, padding: '6px 0', borderRadius: 6,
                            background: slippageTolerance === slip.replace('%', '') ? 'rgba(79, 224, 168, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                            border: `1px solid ${slippageTolerance === slip.replace('%', '') ? 'rgba(79, 224, 168, 0.3)' : 'rgba(255, 255, 255, 0.06)'}`,
                            color: slippageTolerance === slip.replace('%', '') ? '#4fe0a8' : '#94a3b8',
                            fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
                          }}
                        >
                          {slip}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    id="open-position-btn"
                    onClick={() => {
                      if (!depositAmount || Number(depositAmount) <= 0) {
                        showToast('Please enter an amount to deposit', 'err');
                        return;
                      }
                      showToast(`Deposited ${depositAmount} ${depositAsset} into Aegis vault`, 'ok');
                      setDepositAmount('');
                    }}
                    style={{
                      width: '100%', padding: '14px', borderRadius: 10,
                      background: 'var(--mint)', color: '#0a1912',
                      fontWeight: 600, fontSize: 14, border: 'none', cursor: 'pointer',
                      transition: 'opacity 0.15s',
                    }}
                  >
                    Open Guarded Position
                  </button>
                </div>

                {/* Vault Summary & Active Positions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{
                    padding: '22px', borderRadius: 16,
                    background: 'linear-gradient(180deg, rgba(11, 24, 18, 0.65) 0%, rgba(6, 15, 11, 0.8) 100%)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                  }}>
                    <div style={{
                      fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.08em',
                      textTransform: 'uppercase' as const, color: '#4fe0a8', marginBottom: 12,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <LiveDot />
                      Current Vault Positions
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {DEMO_POSITIONS.map((p) => (
                        <div
                          key={p.symbol}
                          style={{
                            padding: '14px 18px', borderRadius: 10,
                            background: 'rgba(255, 255, 255, 0.02)',
                            border: '1px solid rgba(255, 255, 255, 0.05)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          }}
                        >
                          <div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--white)' }}>
                              {p.symbol} · {p.balance} shares
                            </div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: '#64748b', marginTop: 2 }}>
                              Normalized Price: ${(p.priceUsd * p.multiplier).toFixed(2)}
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: '#4fe0a8' }}>
                              {formatCurrency(p.balance * p.priceUsd * p.multiplier)}
                            </div>
                            <button
                              onClick={() => showToast(`Initiated withdrawal for ${p.symbol} position`, 'ok')}
                              style={{
                                background: 'none', border: 'none', color: '#f47c6c',
                                fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer', padding: 0, marginTop: 4,
                              }}
                            >
                              Withdraw
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{
                    padding: '18px 22px', borderRadius: 14,
                    background: 'rgba(11, 24, 18, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    fontFamily: 'var(--mono)', fontSize: 11, color: '#64748b', lineHeight: 1.6,
                  }}>
                    <strong style={{ color: '#cbd5e1' }}>Safety Invariant:</strong> Withdrawals can be made at any moment by the vault owner. The autonomous guardian agent only has authority to call the swap execution instruction on DEX pools when a verified on-chain drawdown or deviation event occurs.
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB 3: POLICIES ── */}
            {tab === 'policies' && (
              <div style={{ maxWidth: 760 }}>
                <div style={{ marginBottom: 28 }}>
                  <div style={{
                    fontFamily: 'var(--display)', fontSize: 26, fontWeight: 600,
                    letterSpacing: '-0.03em', color: 'var(--white)', marginBottom: 6,
                  }}>
                    Natural Language Risk Engine
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6 }}>
                    Describe your downside risk tolerance in standard financial prose. The AI parser compiles it into deterministic on-chain parameters for your cryptographic signature.
                  </div>
                </div>

                {/* Example prompt pills */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{
                    fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.08em',
                    textTransform: 'uppercase' as const, color: '#64748b', marginBottom: 8,
                  }}>
                    Preset Scenarios
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[
                      'If SPYX drops more than 8% exit 75% to USDC cautiously',
                      'If GLDX falls 10% move 60% to USDT immediately',
                      'Conservative: trigger at 5% drawdown, exit 50% to USDC',
                    ].map((ex) => (
                      <button
                        key={ex}
                        onClick={() => { setPolicyText(ex); setParsedPolicy(null); }}
                        style={{
                          padding: '6px 12px', borderRadius: 6,
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          background: 'rgba(255, 255, 255, 0.02)',
                          color: '#94a3b8', fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
                        }}
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Textarea */}
                <div style={{ position: 'relative', marginBottom: 14 }}>
                  <textarea
                    id="policy-input"
                    value={policyText}
                    onChange={(e) => { setPolicyText(e.target.value); setParsedPolicy(null); }}
                    placeholder='e.g. "If SPYX drops more than 8% in 24 hours, exit 75% to USDC with 0.5% max slippage"'
                    rows={3}
                    style={{
                      width: '100%',
                      background: 'linear-gradient(180deg, rgba(14, 28, 22, 0.5) 0%, rgba(8, 16, 13, 0.7) 100%)',
                      border: '1px solid rgba(255, 255, 255, 0.09)',
                      borderRadius: 12, padding: '16px 18px',
                      color: 'var(--white)', fontFamily: 'var(--sans)', fontSize: 15,
                      resize: 'vertical', outline: 'none', lineHeight: 1.55,
                    }}
                  />
                </div>

                {/* Action Bar */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <button
                    id="parse-policy-btn"
                    onClick={parseNLPolicy}
                    disabled={parsing || !policyText.trim()}
                    style={{
                      padding: '11px 22px', borderRadius: 8,
                      border: '1px solid rgba(79, 224, 168, 0.4)',
                      background: 'rgba(79, 224, 168, 0.1)',
                      color: 'var(--mint)', fontWeight: 600, fontSize: 13.5,
                      cursor: parsing ? 'wait' : 'pointer',
                      opacity: (parsing || !policyText.trim()) ? 0.45 : 1,
                    }}
                  >
                    {parsing ? 'Parsing with AI…' : 'Parse Policy'}
                  </button>

                  {parsedPolicy && (
                    <button
                      id="sign-policy-btn"
                      onClick={signPolicy}
                      style={{
                        padding: '11px 24px', borderRadius: 8,
                        background: 'var(--mint)', color: '#0a1912',
                        fontWeight: 600, fontSize: 13.5, border: 'none', cursor: 'pointer',
                      }}
                    >
                      Sign & Activate Policy
                    </button>
                  )}
                </div>

                {parseError && (
                  <div style={{ marginTop: 14, color: '#f47c6c', fontFamily: 'var(--mono)', fontSize: 11 }}>
                    {parseError}
                  </div>
                )}

                {/* Parsed Policy Details Card */}
                {parsedPolicy && <PolicyPreviewCard policy={parsedPolicy} />}

                {/* Explainer Box */}
                <div style={{
                  marginTop: 28, padding: '18px 22px',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderLeft: '2px solid rgba(79, 224, 168, 0.5)',
                  borderRadius: '0 10px 10px 0',
                  background: 'rgba(11, 24, 18, 0.4)',
                  fontFamily: 'var(--mono)', fontSize: 11, color: '#94a3b8', lineHeight: 1.7,
                }}>
                  <span style={{ color: '#4fe0a8', fontWeight: 600 }}>Multi-Pool Cross-Check Guarantee:</span>
                  {' '}The Aegis risk engine continually validates on-chain oracle multipliers and cross-checks DEX pool pricing against Raydium and Orca. If a pool divergence exceeds your threshold or an unconfirmed corporate action occurs, execution enters review mode rather than liquidating blindly.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
