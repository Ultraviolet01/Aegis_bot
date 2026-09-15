'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';

// Lazy-load the candlestick chart (client-only)
const CandlestickChart = dynamic(() => import('../../components/CandlestickChart'), {
  ssr: false,
});

// ─── Token Registry ───────────────────────────────────────────────────────────

interface SolanaStock {
  symbol: string;
  name: string;
  category: 'Index' | 'Tech' | 'Commodity' | 'Semiconductor' | 'Custom';
  basePrice: number;
  multiplier: number;
  mint: string;
  dailyChangePct: number;
  corporateActions: CorporateAction[];
  isVerifiedXStock?: boolean;
  authenticityLabel?: string;
}

const SOLANA_STOCKS: SolanaStock[] = [
  {
    symbol: 'SPYX',
    name: 'S&P 500 Tokenized',
    category: 'Index',
    basePrice: 514.38,
    multiplier: 1.005714,
    dailyChangePct: 0.45,
    mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
    isVerifiedXStock: true,
    authenticityLabel: 'Verified xStock',
    corporateActions: [
      {
        mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
        symbol: 'SPYX',
        actionType: 'dividend',
        newMultiplier: 1.005714,
        oldMultiplier: 1.003909,
        exDate: '2026-08-31',
        activationTime: Math.floor(Date.now() / 1000 - 12 * 86400),
        applied: true,
        needsReview: false,
        isDemo: false,
      },
      {
        mint: 'demo-mint-split',
        symbol: 'SPYX',
        actionType: 'split',
        newMultiplier: 4.0,
        oldMultiplier: 1.0,
        exDate: '2026-07-29',
        activationTime: Math.floor(Date.now() / 1000 - 45 * 86400),
        applied: true,
        needsReview: false,
        isDemo: true,
      },
      {
        mint: 'demo-mint-ambiguous',
        symbol: 'SPYX',
        actionType: 'dividend',
        newMultiplier: 4.16,
        oldMultiplier: 4.0,
        exDate: '2026-08-15',
        activationTime: Math.floor(Date.now() / 1000 - 28 * 86400),
        applied: true,
        needsReview: true,
        isDemo: true,
      },
    ],
  },
  {
    symbol: 'NVDAX',
    name: 'NVIDIA Corp Tokenized',
    category: 'Semiconductor',
    basePrice: 119.50,
    multiplier: 10.0,
    dailyChangePct: 2.14,
    mint: 'NVDxxTokenizedMintAddressSolanaDevnet11111',
    corporateActions: [
      {
        mint: 'NVDxxTokenizedMintAddressSolanaDevnet11111',
        symbol: 'NVDAX',
        actionType: 'split',
        newMultiplier: 10.0,
        oldMultiplier: 1.0,
        exDate: '2026-06-10',
        activationTime: Math.floor(Date.now() / 1000 - 65 * 86400),
        applied: true,
        needsReview: false,
        isDemo: false,
      },
      {
        mint: 'NVDxxTokenizedMintAddressSolanaDevnet11111',
        symbol: 'NVDAX',
        actionType: 'dividend',
        newMultiplier: 10.02,
        oldMultiplier: 10.0,
        exDate: '2026-09-02',
        activationTime: Math.floor(Date.now() / 1000 - 10 * 86400),
        applied: true,
        needsReview: false,
        isDemo: true,
      },
    ],
  },
  {
    symbol: 'AAPLX',
    name: 'Apple Inc Tokenized',
    category: 'Tech',
    basePrice: 224.80,
    multiplier: 1.0024,
    dailyChangePct: -0.18,
    mint: 'APLxxTokenizedMintAddressSolanaDevnet11111',
    corporateActions: [
      {
        mint: 'APLxxTokenizedMintAddressSolanaDevnet11111',
        symbol: 'AAPLX',
        actionType: 'dividend',
        newMultiplier: 1.0024,
        oldMultiplier: 1.0,
        exDate: '2026-08-12',
        activationTime: Math.floor(Date.now() / 1000 - 30 * 86400),
        applied: true,
        needsReview: false,
        isDemo: false,
      },
    ],
  },
  {
    symbol: 'TSLAX',
    name: 'Tesla Inc Tokenized',
    category: 'Tech',
    basePrice: 218.40,
    multiplier: 3.0,
    dailyChangePct: 1.85,
    mint: 'TSLxxTokenizedMintAddressSolanaDevnet11111',
    corporateActions: [
      {
        mint: 'TSLxxTokenizedMintAddressSolanaDevnet11111',
        symbol: 'TSLAX',
        actionType: 'split',
        newMultiplier: 3.0,
        oldMultiplier: 1.0,
        exDate: '2026-07-15',
        activationTime: Math.floor(Date.now() / 1000 - 58 * 86400),
        applied: true,
        needsReview: false,
        isDemo: true,
      },
    ],
  },
  {
    symbol: 'GLDX',
    name: 'SPDR Gold Tokenized',
    category: 'Commodity',
    basePrice: 398.79,
    multiplier: 1.0,
    dailyChangePct: 0.32,
    mint: 'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re',
    isVerifiedXStock: true,
    authenticityLabel: 'Verified xStock',
    corporateActions: [],
  },
  {
    symbol: 'QQQX',
    name: 'Nasdaq 100 Tokenized',
    category: 'Index',
    basePrice: 710.87,
    multiplier: 1.001955,
    dailyChangePct: 0.76,
    mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
    isVerifiedXStock: true,
    authenticityLabel: 'Verified xStock',
    corporateActions: [
      {
        mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
        symbol: 'QQQX',
        actionType: 'dividend',
        newMultiplier: 1.002725,
        oldMultiplier: 1.001955,
        exDate: '2026-09-15',
        activationTime: 1782086100,
        applied: false,
        needsReview: false,
        isDemo: false,
      },
    ],
  },
  {
    symbol: 'MSFTX',
    name: 'Microsoft Corp Tokenized',
    category: 'Tech',
    basePrice: 428.15,
    multiplier: 1.0035,
    dailyChangePct: 0.62,
    mint: 'MSFxxTokenizedMintAddressSolanaDevnet11111',
    corporateActions: [
      {
        mint: 'MSFxxTokenizedMintAddressSolanaDevnet11111',
        symbol: 'MSFTX',
        actionType: 'dividend',
        newMultiplier: 1.0035,
        oldMultiplier: 1.0,
        exDate: '2026-08-20',
        activationTime: Math.floor(Date.now() / 1000 - 23 * 86400),
        applied: true,
        needsReview: false,
        isDemo: true,
      },
    ],
  },
  {
    symbol: 'ASMLX',
    name: 'ASML Holding Tokenized',
    category: 'Semiconductor',
    basePrice: 760.50,
    multiplier: 1.0,
    dailyChangePct: -1.12,
    mint: 'ASMxxTokenizedMintAddressSolanaDevnet11111',
    corporateActions: [],
  },
  {
    symbol: 'MUX',
    name: 'Micron Technology Tokenized',
    category: 'Semiconductor',
    basePrice: 98.30,
    multiplier: 1.0,
    dailyChangePct: 1.42,
    mint: 'MUxxxTokenizedMintAddressSolanaDevnet11111',
    corporateActions: [],
  },
  {
    symbol: 'SNDKX',
    name: 'Western Digital Tokenized',
    category: 'Tech',
    basePrice: 64.10,
    multiplier: 1.0,
    dailyChangePct: 0.22,
    mint: 'SNDxxTokenizedMintAddressSolanaDevnet11111',
    corporateActions: [],
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface OracleDataPoint {
  timestamp: number;
  priceUsd: number;
  multiplier: number;
  normalizedPrice: number;
}

interface CandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface CorporateAction {
  mint: string;
  symbol: string;
  actionType: 'split' | 'dividend' | 'reverse_split';
  newMultiplier: number;
  oldMultiplier: number;
  exDate: string;
  activationTime: number;
  applied: boolean;
  needsReview?: boolean;
  isDemo?: boolean;
}

interface HistoryQueryRecord {
  id: string;
  query: string;
  timestamp: number;
  backtestResult?: {
    policyText: string;
    drawdownThresholdPct: number;
    exitPercentPct: number;
    targetAsset: string;
    triggers: string[];
    triggeredCount: number;
    summary: string;
  } | undefined;
  answer: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPrice(p: number) {
  return `$${p.toFixed(2)}`;
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatIsoDate(ts: number) {
  return new Date(ts * 1000).toISOString();
}

function actionLabel(action: CorporateAction) {
  const suffix = action.needsReview ? ' (unconfirmed — please verify)' : '';
  if (action.actionType === 'split') {
    const ratio = (action.newMultiplier / action.oldMultiplier).toFixed(0);
    return `${ratio}-for-1 Split${suffix}`;
  }
  if (action.actionType === 'reverse_split') {
    const ratio = (action.oldMultiplier / action.newMultiplier).toFixed(0);
    return `${ratio}-for-1 Reverse Split${suffix}`;
  }
  return `Dividend${suffix}`;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(tokens);

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return <span key={index}>{part}</span>;
  });
}

function renderAnswerMarkdown(markdown: string): ReactNode {
  const lines = markdown.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let listItems: { ordered: boolean; text: string }[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const ordered = listItems[0]!.ordered;
    const List = ordered ? 'ol' : 'ul';
    blocks.push(
      <List key={`list-${blocks.length}`}>
        {listItems.map((item, index) => <li key={index}>{renderInlineMarkdown(item.text)}</li>)}
      </List>
    );
    listItems = [];
  };

  lines.forEach((line, index) => {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (listItems.length > 0 && listItems[0]!.ordered !== ordered) flushList();
      listItems.push({ ordered, text: (bullet ?? numbered)![1] ?? '' });
      return;
    }

    flushList();
    if (!line.trim()) {
      blocks.push(<div key={`space-${index}`} style={{ height: 8 }} />);
      return;
    }
    blocks.push(<p key={`paragraph-${index}`}>{renderInlineMarkdown(line)}</p>);
  });

  flushList();
  return blocks;
}

function asUnixSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return asUnixSeconds(numeric);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return null;
}

function numericValue(...values: unknown[]): number | null {
  for (const value of values) {
    const number = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function responseNodes(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.nodes)) return data.nodes;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.prices)) return data.prices;
  if (Array.isArray(data?.history)) return data.history;
  return data && typeof data === 'object' ? [data] : [];
}

function parseOfficialPriceHistory(data: any, multiplier: number): OracleDataPoint[] {
  return responseNodes(data)
    .map((point) => {
      const timestamp = asUnixSeconds(point.timestamp ?? point.time ?? point.date ?? point.datetime);
      const price = numericValue(point.priceUsd, point.price, point.quote, point.close, point.value);
      if (timestamp === null || price === null || price <= 0) return null;
      const pointMultiplier = numericValue(point.multiplier) ?? multiplier;
      return {
        timestamp,
        priceUsd: price,
        multiplier: pointMultiplier,
        normalizedPrice: price * pointMultiplier,
      };
    })
    .filter((point): point is OracleDataPoint => point !== null)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function parseOfficialCorporateActions(data: any, mint: string): CorporateAction[] {
  const parsed: Array<CorporateAction | null> = responseNodes(data).map((event): CorporateAction | null => {
      const newMultiplier = numericValue(event.multiplier, event.newMultiplier);
      const oldMultiplier = numericValue(event.previousMultiplier, event.oldMultiplier);
      const activationTime = asUnixSeconds(event.activationDateTime ?? event.activationTime ?? event.exDate);
      if (newMultiplier === null || oldMultiplier === null || activationTime === null || oldMultiplier <= 0) return null;
      const pctChange = Math.abs((newMultiplier - oldMultiplier) / oldMultiplier);
      const reason = String(event.reason ?? '').toLowerCase();
      const actionType: CorporateAction['actionType'] = reason.includes('reverse')
        ? 'reverse_split'
        : reason.includes('split')
          ? 'split'
          : newMultiplier < oldMultiplier && pctChange >= 0.05
            ? 'reverse_split'
            : pctChange >= 0.05
              ? 'split'
              : 'dividend';
      return {
        mint,
        symbol: 'SPYX',
        actionType,
        newMultiplier,
        oldMultiplier,
        exDate: new Date(activationTime * 1000).toISOString().split('T')[0] ?? '',
        activationTime,
        applied: Date.now() / 1000 >= activationTime,
        needsReview: pctChange >= 0.03 && pctChange <= 0.07,
        isDemo: false,
      };
  });
  return parsed.filter((event) => event !== null).sort((a, b) => a.activationTime - b.activationTime);
}

/**
 * Deterministic pseudo-random sequence for consistent stock simulation
 */
function pseudoRandom(seed: number) {
  const x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
}

function generateDemoHistory(ticker: string, customBasePrice?: number, customMultiplier?: number): OracleDataPoint[] {
  const stock = SOLANA_STOCKS.find((s) => s.symbol === ticker);
  const points: OracleDataPoint[] = [];
  const now = Math.floor(Date.now() / 1000);
  let price = customBasePrice ?? stock?.basePrice ?? 100.0;
  const multiplier = customMultiplier ?? stock?.multiplier ?? 1.0;
  const days = 90;

  // Hash ticker name to get distinct seed
  let seed = 0;
  for (let i = 0; i < ticker.length; i++) {
    seed += ticker.charCodeAt(i) * (i + 1);
  }

  for (let i = days; i >= 0; i--) {
    const ts = now - i * 86400;
    const r = pseudoRandom(seed + i);
    // Volatility bias based on ticker category
    const vol = stock?.category === 'Semiconductor' ? 0.03 : stock?.category === 'Commodity' ? 0.012 : 0.022;
    price *= 1 + (r - 0.49) * vol;

    points.push({
      timestamp: ts,
      priceUsd: price,
      multiplier,
      normalizedPrice: price * multiplier,
    });
  }
  return points;
}

function toCandles(points: OracleDataPoint[]): CandlePoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);

  const byDay = new Map<string, OracleDataPoint[]>();
  for (const p of sorted) {
    const d = new Date(p.timestamp * 1000);
    const key = d.toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(p);
  }

  const candles: CandlePoint[] = [];
  const sortedKeys = [...byDay.keys()].sort();

  for (let idx = 0; idx < sortedKeys.length; idx++) {
    const dayKey = sortedKeys[idx]!;
    const pts = byDay.get(dayKey)!;
    const closes = pts.map((p) => p.normalizedPrice);

    const prevClose = idx > 0 ? candles[idx - 1]!.close : closes[0]!;
    const open = idx > 0 ? prevClose * (1 + (Math.sin(idx * 2.3) * 0.003)) : closes[0]!;
    const close = closes[closes.length - 1]!;
    const baseHigh = Math.max(...closes, open, close);
    const baseLow = Math.min(...closes, open, close);

    const spread = Math.max(open * 0.007, 0.4);
    const high = Math.max(baseHigh + spread * 0.5, open, close);
    const low = Math.max(Math.min(baseLow - spread * 0.5, open, close), 0.01);

    const dayTimestamp = Math.floor(new Date(dayKey + 'T00:00:00Z').getTime() / 1000);

    candles.push({
      time: dayTimestamp,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
    });
  }

  return candles;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HistoryPage() {
  const [ticker, setTicker] = useState('SPYX');
  const [customStock, setCustomStock] = useState<SolanaStock | null>(null);
  const [priceHistory, setPriceHistory] = useState<OracleDataPoint[]>(() => generateDemoHistory('SPYX'));
  const [corporateActions, setCorporateActions] = useState<CorporateAction[]>(() => {
    const s = SOLANA_STOCKS.find((item) => item.symbol === 'SPYX');
    return s ? s.corporateActions : [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dropdown Bar State
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Unified Query & Backtest State
  const [queryInput, setQueryInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [queryHistory, setQueryHistory] = useState<HistoryQueryRecord[]>([]);
  const queryBottomRef = useRef<HTMLDivElement>(null);

  const activeStock = useMemo(() => {
    if (customStock && customStock.symbol === ticker) return customStock;
    return SOLANA_STOCKS.find((s) => s.symbol === ticker) || SOLANA_STOCKS[0]!;
  }, [ticker, customStock]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectToken = (symbol: string) => {
    setCustomStock(null);
    setTicker(symbol);
    setIsDropdownOpen(false);
    setSearchFilter('');
    const stock = SOLANA_STOCKS.find((s) => s.symbol === symbol);
    if (stock) {
      setPriceHistory(generateDemoHistory(symbol, stock.basePrice, stock.multiplier));
      setCorporateActions(stock.corporateActions);
    }
  };

  const selectMintAddress = useCallback(async (mintAddr: string) => {
    const trimmed = mintAddr.trim();
    if (!trimmed) return;
    setIsDropdownOpen(false);
    setSearchFilter('');

    // Check if in SOLANA_STOCKS
    const known = SOLANA_STOCKS.find(
      (s) =>
        s.mint.toLowerCase() === trimmed.toLowerCase() ||
        s.symbol.toLowerCase() === trimmed.toLowerCase()
    );
    if (known) {
      setCustomStock(null);
      setTicker(known.symbol);
      setPriceHistory(generateDemoHistory(known.symbol, known.basePrice, known.multiplier));
      setCorporateActions(known.corporateActions);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/token-info?mint=${trimmed}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to inspect token account');
      }

      const stockObj: SolanaStock = {
        symbol: data.symbol || `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`,
        name: data.name || 'Custom Solana Token',
        category: 'Custom',
        basePrice: data.priceUsd ?? 100.0,
        multiplier: data.multiplier ?? 1.0,
        mint: data.mint,
        dailyChangePct: 0.0,
        corporateActions: data.corporateActions || [],
        isVerifiedXStock: data.isVerifiedXStock,
        authenticityLabel: data.authenticityLabel,
      };

      setCustomStock(stockObj);
      setTicker(stockObj.symbol);
      setPriceHistory(generateDemoHistory(stockObj.symbol, stockObj.basePrice, stockObj.multiplier));
      setCorporateActions(stockObj.corporateActions);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    if (customStock && customStock.symbol === ticker) return;
    setLoading(true);
    setError(null);
    try {
      // SPYX uses the official public v2 endpoints. The token only launched
      // in 2025, so this feed intentionally represents token history, not a
      // fabricated three-year SPYX series.
      if (ticker === 'SPYX') {
        const apiSymbol = 'SPYX';
        const [priceRes, multiplierRes] = await Promise.all([
          fetch(`/api/xstocks/public/assets/${apiSymbol}/price-data`),
          fetch(`/api/xstocks/public/assets/${apiSymbol}/multiplier/history?network=Solana&page=1&pageSize=100`),
        ]);
        if (!priceRes.ok) throw new Error(`SPYX price history unavailable (HTTP ${priceRes.status})`);

        const priceData = await priceRes.json();
        const multiplierData = multiplierRes.ok ? await multiplierRes.json() : [];
        const multiplierEvents = parseOfficialCorporateActions(multiplierData, activeStock.mint);
        const currentMultiplier = multiplierEvents.at(-1)?.newMultiplier ?? activeStock.multiplier;
        const officialHistory = parseOfficialPriceHistory(priceData, currentMultiplier);
        if (officialHistory.length === 0) throw new Error('Official SPYX price history returned no usable points');

        setPriceHistory(officialHistory);
        setCorporateActions(multiplierEvents);
        return;
      }

      // 1. First query on-chain token info & live Jupiter price
      try {
        const tokenInfoRes = await fetch(`/api/token-info?mint=${activeStock.mint}`);
        if (tokenInfoRes.ok) {
          const tokenData = await tokenInfoRes.json();
          if (tokenData && tokenData.priceUsd) {
            setPriceHistory(generateDemoHistory(ticker, tokenData.priceUsd, tokenData.multiplier));
          }
          if (tokenData?.corporateActions?.length > 0) {
            setCorporateActions(tokenData.corporateActions);
            return;
          }
        }
      } catch {
        // Fall back to REST or demo
      }

      // 2. Query xStocks API or fallback to calibrated demo
      const assetsRes = await fetch('/api/xstocks/assets');
      if (!assetsRes.ok) throw new Error(`xStocks API unavailable (HTTP ${assetsRes.status})`);
      const assets = await assetsRes.json();
      if (!Array.isArray(assets)) throw new Error('Invalid assets format returned by xStocks API');
      const asset = assets.find((a: any) => a.symbol?.toUpperCase() === ticker);
      if (!asset) throw new Error(`Ticker ${ticker} not found in xStocks assets`);

      const mint = asset.mint;
      const [oracleRes, actionsRes] = await Promise.all([
        fetch(`/api/xstocks/oracles/${mint}/history`),
        fetch(`/api/xstocks/corporate-actions/${mint}`),
      ]);
      if (!oracleRes.ok) throw new Error(`Oracle price history unavailable (HTTP ${oracleRes.status})`);

      const oracleData = await oracleRes.json();
      const actionsData = actionsRes.ok ? await actionsRes.json() : [];

      const history: OracleDataPoint[] = (oracleData as any[]).map((d) => ({
        timestamp: d.timestamp,
        priceUsd: d.priceUsd ?? d.price,
        multiplier: d.multiplier ?? 1,
        normalizedPrice: (d.priceUsd ?? d.price) * (d.multiplier ?? 1),
      }));
      const liveActions: CorporateAction[] = (actionsData as CorporateAction[]).map((a) => ({
        ...a,
        isDemo: false,
      }));
      setPriceHistory(history);
      setCorporateActions(liveActions);
    } catch (err: any) {
      setError(err.message);
      setPriceHistory(generateDemoHistory(ticker, activeStock.basePrice, activeStock.multiplier));
      setCorporateActions(activeStock.corporateActions);
    } finally {
      setLoading(false);
    }
  }, [ticker, activeStock, customStock]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Compute stats for grounding
  const stats = useMemo(() => {
    if (priceHistory.length === 0) return null;
    const prices = priceHistory.map((p) => p.normalizedPrice);
    const entryPrice = prices[0] ?? 0;
    const latestPrice = prices[prices.length - 1] ?? 0;
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const maxPricePoint = priceHistory[prices.indexOf(maxPrice)];
    const minPricePoint = priceHistory[prices.indexOf(minPrice)];

    let maxDrawdown = 0;
    let peak = prices[0] ?? 0;
    let peakPoint = priceHistory[0];
    let maxDrawdownPeak = priceHistory[0];
    let maxDrawdownTrough = priceHistory[0];
    for (let index = 0; index < prices.length; index++) {
      const p = prices[index]!;
      if (p > peak) peak = p;
      if (p >= peak) peakPoint = priceHistory[index];
      const dd = peak > 0 ? (peak - p) / peak : 0;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownPeak = peakPoint;
        maxDrawdownTrough = priceHistory[index];
      }
    }

    return {
      entryPrice,
      latestPrice,
      maxPrice,
      minPrice,
      startDate: formatDate(priceHistory[0]?.timestamp ?? 0),
      endDate: formatDate(priceHistory[priceHistory.length - 1]?.timestamp ?? 0),
      maxPriceDate: maxPricePoint ? formatDate(maxPricePoint.timestamp) : undefined,
      minPriceDate: minPricePoint ? formatDate(minPricePoint.timestamp) : undefined,
      maxDrawdownPct: (maxDrawdown * 100).toFixed(1),
      maxDrawdownPeak: maxDrawdownPeak ? {
        timestamp: maxDrawdownPeak.timestamp,
        price: maxDrawdownPeak.normalizedPrice,
      } : undefined,
      maxDrawdownTrough: maxDrawdownTrough ? {
        timestamp: maxDrawdownTrough.timestamp,
        price: maxDrawdownTrough.normalizedPrice,
      } : undefined,
    };
  }, [priceHistory]);

  // Unified Handler: Merged Ask & Backtest
  const handleUnifiedQuery = async (customText?: string) => {
    const textToSubmit = (customText ?? queryInput).trim();
    if (!textToSubmit || priceHistory.length === 0 || isProcessing) return;

    setQueryInput('');
    setIsProcessing(true);

    const qLower = textToSubmit.toLowerCase();
    const isBacktestCommand =
      qLower.startsWith('backtest:') ||
      qLower.startsWith('backtest ') ||
      qLower.startsWith('policy:') ||
      /(if\s+.*(drop|fall|drawdown|loss).*exit)/i.test(textToSubmit) ||
      /(exit\s+\d+%\s+to)/i.test(textToSubmit) ||
      /(trigger\s+at\s+\d+%\s+drawdown)/i.test(textToSubmit);

    let backtestData: HistoryQueryRecord['backtestResult'] | undefined = undefined;
    let backtestSummaryText = '';

    // 1. If policy query, execute backtest simulation
    if (isBacktestCommand) {
      try {
        const pRes = await fetch('/api/parse-policy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ policyText: textToSubmit }),
        });
        const pJson = await pRes.json();
        const policy = pJson.policy;

        if (policy) {
          const firstPoint = priceHistory[0];
          if (firstPoint) {
            const entryPrice = firstPoint.normalizedPrice;
            const drawdownThreshold = policy.drawdownThresholdBps / 10_000;
            const deviationThreshold = policy.oracleDeviationThresholdBps / 10_000;
            const triggers: string[] = [];

            for (let i = 1; i < priceHistory.length; i++) {
              const currPoint = priceHistory[i];
              const prevPoint = priceHistory[i - 1];
              if (!currPoint || !prevPoint) continue;

              const curr = currPoint.normalizedPrice;
              const prev = prevPoint.normalizedPrice;
              const drawdown = (entryPrice - curr) / entryPrice;
              const deviation = Math.abs(curr - prev) / prev;

              const nearAction = corporateActions.find(
                (a) => Math.abs(a.activationTime - currPoint.timestamp) < 86400
              );
              if (nearAction) continue;

              if (drawdown >= drawdownThreshold) {
                triggers.push(
                  `${formatDate(currPoint.timestamp)}: Drawdown breach — ${(drawdown * 100).toFixed(1)}% (threshold ${(policy.drawdownThresholdBps / 100).toFixed(1)}%) → exit ${(policy.exitPercentBps / 100).toFixed(0)}% to ${policy.targetAsset || 'USDC'}`
                );
                break;
              }
              if (deviation >= deviationThreshold) {
                triggers.push(
                  `${formatDate(currPoint.timestamp)}: Oracle deviation breach — ${(deviation * 100).toFixed(1)}% jump (threshold ${(policy.oracleDeviationThresholdBps / 100).toFixed(1)}%)`
                );
              }
            }

            const triggeredCount = triggers.length;
            backtestSummaryText =
              triggeredCount > 0
                ? `Policy would have triggered ${triggeredCount} time(s):\n${triggers.join('\n')}`
                : `Policy would NOT have triggered over this period. Normalized drawdown never exceeded ${(policy.drawdownThresholdBps / 100).toFixed(1)}%.`;

            backtestData = {
              policyText: textToSubmit,
              drawdownThresholdPct: policy.drawdownThresholdBps / 100,
              exitPercentPct: policy.exitPercentBps / 100,
              targetAsset: policy.targetAsset || 'USDC',
              triggers,
              triggeredCount,
              summary: backtestSummaryText,
            };
          }
        }
      } catch (e) {
        console.warn('Policy parsing/backtesting error:', e);
      }
    }

    // 2. Fetch grounded response from QA engine
    let answer = '';
    try {
      const dataContext = [
        `Ticker: ${ticker}`,
        `Points count: ${priceHistory.length}`,
        stats && `Latest price: ${formatPrice(stats.latestPrice)}`,
        stats && `Entry price: ${formatPrice(stats.entryPrice)}`,
        stats && `Max price: ${formatPrice(stats.maxPrice)}`,
        stats && `Min price: ${formatPrice(stats.minPrice)}`,
        stats && `Coverage: ${stats.startDate} through ${stats.endDate}`,
        stats && `High: ${formatPrice(stats.maxPrice)} on ${stats.maxPriceDate}`,
        stats && `Low: ${formatPrice(stats.minPrice)} on ${stats.minPriceDate}`,
        stats && `Max drawdown: ${stats.maxDrawdownPct}%`,
        stats?.maxDrawdownPeak && `Max drawdown peak: ${formatIsoDate(stats.maxDrawdownPeak.timestamp)} at ${formatPrice(stats.maxDrawdownPeak.price)}`,
        stats?.maxDrawdownTrough && `Max drawdown trough: ${formatIsoDate(stats.maxDrawdownTrough.timestamp)} at ${formatPrice(stats.maxDrawdownTrough.price)}`,
        'Daily normalized price history:',
        ...priceHistory.map((point) => `${formatDate(point.timestamp)}: ${formatPrice(point.normalizedPrice)}`),
        corporateActions.length > 0 &&
          `Corporate actions: ${corporateActions
            .map((a) => `${formatIsoDate(a.activationTime)} ${actionLabel(a)} (${a.oldMultiplier}x -> ${a.newMultiplier}x)`)
            .join(', ')}`,
      ]
        .filter(Boolean)
        .join('\n');

      const res = await fetch('/api/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: textToSubmit,
          context: dataContext,
          ticker,
          stats,
          backtestInfo: backtestSummaryText || undefined,
        }),
      });

      const json = await res.json();
      answer = json.answer ?? 'No response generated.';
    } catch (err: any) {
      answer = backtestSummaryText || `Query processed for ${ticker}. (Service unavailable: ${err.message})`;
    }

    // 3. Record response in thread
    const newRecord: HistoryQueryRecord = {
      id: Date.now().toString(),
      query: textToSubmit,
      timestamp: Date.now(),
      backtestResult: backtestData,
      answer,
    };

    setQueryHistory((prev) => [...prev, newRecord]);
    setIsProcessing(false);

    setTimeout(() => {
      queryBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const candles = toCandles(priceHistory);

  // Filter stocks for dropdown
  const filteredStocks = useMemo(() => {
    return SOLANA_STOCKS.filter((s) => {
      const matchesSearch =
        s.symbol.toLowerCase().includes(searchFilter.toLowerCase()) ||
        s.name.toLowerCase().includes(searchFilter.toLowerCase());
      const matchesCategory =
        categoryFilter === 'All' || s.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [searchFilter, categoryFilter]);

  return (
    <div className="app" style={{ minHeight: '100vh', paddingBottom: 100 }}>
      {/* ── Top Header ── */}
      <div
        style={{
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          background: 'rgba(5, 12, 9, 0.75)',
          backdropFilter: 'blur(16px)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          padding: '0 40px',
          display: 'flex',
          alignItems: 'center',
          height: 58,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '.08em',
            textTransform: 'uppercase' as const,
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <a href="/app" style={{ color: '#94a3b8', textDecoration: 'none' }}>
            Aegis
          </a>
          <span style={{ color: '#334155' }}>/</span>
          <span style={{ color: '#4fe0a8', fontWeight: 600 }}>History & Analytics</span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Header Dropdown Quick Trigger */}
        <div style={{ position: 'relative' }}>
          <button
            id="nav-token-selector-btn"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid rgba(79, 224, 168, 0.35)',
              background: 'rgba(79, 224, 168, 0.08)',
              color: '#4fe0a8',
              fontFamily: 'var(--mono)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>{ticker}</span>
            <span style={{ color: '#94a3b8', fontWeight: 400 }}>· {formatPrice(activeStock.basePrice)}</span>
            <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
          </button>
        </div>
      </div>

        <div style={{ padding: '36px 40px', maxWidth: 1360, margin: '0 auto' }}>
        <div style={{ marginBottom: 18 }}>
          <a
            href="/app"
            id="history-back-to-overview"
            onClick={(event) => {
              const wallet = new URLSearchParams(window.location.search).get('wallet');
              if (wallet) {
                event.preventDefault();
                window.location.href = `/app?wallet=${encodeURIComponent(wallet)}`;
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '8px 12px',
              border: '1px solid rgba(79, 224, 168, 0.25)',
              borderRadius: 7,
              color: '#4fe0a8',
              background: 'rgba(79, 224, 168, 0.06)',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              textDecoration: 'none',
              letterSpacing: '.02em',
            }}
          >
            <span aria-hidden="true">←</span>
            Back to Overview
          </a>
        </div>

        {/* ── Status Notice ── */}
        {error && (
          <div
            style={{
              marginBottom: 24,
              padding: '10px 16px',
              border: '1px solid rgba(212, 170, 70, 0.25)',
              borderLeft: '3px solid rgba(212, 170, 70, 0.7)',
              borderRadius: '0 8px 8px 0',
              background: 'rgba(212, 170, 70, 0.05)',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              color: '#94a3b8',
              lineHeight: 1.6,
            }}
          >
            <span style={{ color: '#d4aa46', fontWeight: 600 }}>Price history is simulated</span>
            {' '}(xStocks API unavailable) — corporate-action events marked{' '}
            <span style={{ color: '#4fe0a8', fontWeight: 600 }}>Live On-Chain</span> reflect real on-chain state
          </div>
        )}

        {/* ── PROMINENT TOKEN SELECTOR DROP BAR & CHART HEADER ── */}
        <div style={{ marginBottom: 20, position: 'relative' }} ref={dropdownRef}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 16,
              padding: '14px 20px',
              background: 'linear-gradient(180deg, rgba(14, 28, 22, 0.7) 0%, rgba(8, 16, 13, 0.85) 100%)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25)',
            }}
          >
            {/* Left: Active Token Info & Interactive Dropdown Trigger */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button
                id="token-drop-bar"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(79, 224, 168, 0.3)',
                  padding: '8px 12px 8px 14px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontFamily: 'var(--display)',
                        fontSize: 20,
                        fontWeight: 700,
                        letterSpacing: '-0.03em',
                        color: 'var(--white)',
                      }}
                    >
                      {activeStock.symbol}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 9.5,
                        padding: '1.5px 6px',
                        borderRadius: 4,
                        background: 'rgba(79, 224, 168, 0.12)',
                        color: '#4fe0a8',
                        border: '1px solid rgba(79, 224, 168, 0.25)',
                      }}
                    >
                      {activeStock.category}
                    </span>
                    {activeStock.isVerifiedXStock ? (
                      <span
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 9.5,
                          padding: '1.5px 6px',
                          borderRadius: 4,
                          background: 'rgba(79, 224, 168, 0.12)',
                          color: '#4fe0a8',
                          border: '1px solid rgba(79, 224, 168, 0.35)',
                          fontWeight: 600,
                        }}
                      >
                        ✓ Verified xStock
                      </span>
                    ) : (
                      <span
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 9.5,
                          padding: '1.5px 6px',
                          borderRadius: 4,
                          background: 'rgba(245, 158, 11, 0.12)',
                          color: '#fbbf24',
                          border: '1px solid rgba(245, 158, 11, 0.35)',
                          fontWeight: 600,
                        }}
                      >
                        ⚠ Unverified Token
                      </span>
                    )}
                  </div>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 11.5, color: '#94a3b8', marginTop: 2, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>{activeStock.name}</span>
                    <span style={{ color: '#64748b', fontFamily: 'var(--mono)', fontSize: 10 }}>({activeStock.mint.slice(0, 4)}...{activeStock.mint.slice(-4)})</span>
                    <span style={{ color: '#4fe0a8', fontFamily: 'var(--mono)', fontSize: 10 }}>· Multiplier: {activeStock.multiplier.toFixed(4)}x</span>
                  </div>
                </div>

                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: 'rgba(79, 224, 168, 0.08)',
                    border: '1px solid rgba(79, 224, 168, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#4fe0a8',
                    fontSize: 11,
                    transition: 'transform 0.15s ease',
                    transform: isDropdownOpen ? 'rotate(180deg)' : 'none',
                    flexShrink: 0,
                  }}
                >
                  ▾
                </div>
              </button>

              {/* Price telemetry */}
              {priceHistory.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <div
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 24,
                      fontWeight: 600,
                      color: 'var(--white)',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {formatPrice(priceHistory[priceHistory.length - 1]?.normalizedPrice ?? activeStock.basePrice)}
                  </div>

                  <div
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: activeStock.dailyChangePct >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(244, 63, 94, 0.1)',
                      color: activeStock.dailyChangePct >= 0 ? '#10b981' : '#f43f5e',
                      border: `1px solid ${activeStock.dailyChangePct >= 0 ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)'}`,
                    }}
                  >
                    {activeStock.dailyChangePct >= 0 ? '+' : ''}
                    {activeStock.dailyChangePct.toFixed(2)}%
                  </div>
                </div>
              )}
            </div>

            {/* Right: Quick token pills */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>
                Popular:
              </span>
              {['SPYX', 'NVDAX', 'TSLAX', 'GLDX', 'QQQX'].map((sym) => (
                <button
                  key={sym}
                  onClick={() => selectToken(sym)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid',
                    borderColor: ticker === sym ? 'rgba(79, 224, 168, 0.45)' : 'rgba(255, 255, 255, 0.08)',
                    background: ticker === sym ? 'rgba(79, 224, 168, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                    color: ticker === sym ? '#4fe0a8' : '#94a3b8',
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  {sym}
                </button>
              ))}
              <button
                id="history-paste-address-btn"
                onClick={() => {
                  setIsDropdownOpen(true);
                  setTimeout(() => {
                    document.getElementById('token-search-input')?.focus();
                  }, 50);
                }}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px dashed rgba(79, 224, 168, 0.4)',
                  background: 'rgba(79, 224, 168, 0.06)',
                  color: '#4fe0a8',
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Paste Address
              </button>
            </div>
          </div>

          {/* ── POP-OUT TOKEN SELECTION MODAL / DROPDOWN ── */}
          {isDropdownOpen && (
            <div
              id="token-dropdown-menu"
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                marginTop: 8,
                zIndex: 200,
                background: 'rgba(8, 18, 14, 0.95)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(79, 224, 168, 0.25)',
                borderRadius: 14,
                padding: '18px',
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)',
              }}
            >
              {/* Search Bar & Filter Header */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <input
                  id="token-search-input"
                  type="text"
                  autoFocus
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Search symbol, name, or paste any Solana mint address (base58)..."
                  style={{
                    flex: 1,
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    color: 'var(--white)',
                    fontFamily: 'var(--sans)',
                    fontSize: 13.5,
                    outline: 'none',
                  }}
                />

                {/* Category Chips */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {['All', 'Index', 'Tech', 'Semiconductor', 'Commodity'].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(cat)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid',
                        borderColor: categoryFilter === cat ? 'rgba(79, 224, 168, 0.4)' : 'rgba(255, 255, 255, 0.06)',
                        background: categoryFilter === cat ? 'rgba(79, 224, 168, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                        color: categoryFilter === cat ? '#4fe0a8' : '#94a3b8',
                        fontFamily: 'var(--mono)',
                        fontSize: 10.5,
                        cursor: 'pointer',
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Direct Mint Address Card if address is typed/pasted */}
              {searchFilter.trim().length >= 32 && (
                <div
                  id="select-custom-mint"
                  onClick={() => selectMintAddress(searchFilter.trim())}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: 'rgba(79, 224, 168, 0.12)',
                    border: '1px solid rgba(79, 224, 168, 0.45)',
                    cursor: 'pointer',
                    marginBottom: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.15s',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: '#4fe0a8' }}>
                        Inspect Custom Solana Mint Address
                      </span>
                      <span style={{ fontSize: 9.5, color: '#94a3b8', background: 'rgba(255, 255, 255, 0.06)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--mono)' }}>
                        On-Chain / Jupiter Live
                      </span>
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#cbd5e1', marginTop: 3 }}>
                      {searchFilter.trim()}
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#4fe0a8', fontWeight: 600 }}>
                    Load Token →
                  </div>
                </div>
              )}

              {/* Tokens Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 8,
                  maxHeight: 320,
                  overflowY: 'auto',
                  paddingRight: 4,
                }}
              >
                {filteredStocks.map((s) => {
                  const isSelected = s.symbol === ticker;
                  return (
                    <div
                      key={s.symbol}
                      id={`select-stock-${s.symbol}`}
                      onClick={() => selectToken(s.symbol)}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 10,
                        background: isSelected ? 'rgba(79, 224, 168, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                        border: `1px solid ${isSelected ? 'rgba(79, 224, 168, 0.4)' : 'rgba(255, 255, 255, 0.05)'}`,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        transition: 'all 0.12s',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            style={{
                              fontFamily: 'var(--mono)',
                              fontSize: 13,
                              fontWeight: 700,
                              color: isSelected ? '#4fe0a8' : 'var(--white)',
                            }}
                          >
                            {s.symbol}
                          </span>
                          <span
                            style={{
                              fontFamily: 'var(--mono)',
                              fontSize: 9.5,
                              color: '#64748b',
                              background: 'rgba(255, 255, 255, 0.03)',
                              padding: '1px 5px',
                              borderRadius: 3,
                            }}
                          >
                            {s.category}
                          </span>
                        </div>
                        <div style={{ fontFamily: 'var(--sans)', fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                          {s.name}
                        </div>
                      </div>

                      {isSelected && (
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#4fe0a8' }}>✓</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── THE CANDLESTICK CHART ── */}
        <div
          style={{
            background: 'linear-gradient(180deg, rgba(8, 20, 15, 0.7) 0%, rgba(4, 12, 9, 0.85) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.07)',
            borderRadius: 14,
            overflow: 'hidden',
            padding: '16px 16px 12px',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
            marginBottom: 20,
          }}
        >
          <CandlestickChart data={candles} height={440} ticker={ticker} />
        </div>

        {/* ── Corporate Actions Strip ── */}
        {corporateActions.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 9.5,
                letterSpacing: '.1em',
                textTransform: 'uppercase' as const,
                color: '#64748b',
                marginBottom: 10,
              }}
            >
              Corporate Actions on Record ({ticker})
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 10,
              }}
            >
              {corporateActions.map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 8,
                    background: 'rgba(14, 28, 22, 0.5)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: a.needsReview ? '#f59e0b' : a.isDemo ? '#64748b' : '#4fe0a8',
                      }}
                    />
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--white)' }}>
                      {formatDate(a.activationTime)}: {actionLabel(a)}
                    </span>
                  </div>

                  <span
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 9,
                      letterSpacing: '.06em',
                      padding: '2px 7px',
                      borderRadius: 4,
                      background: a.isDemo ? 'rgba(255, 255, 255, 0.04)' : 'rgba(79, 224, 168, 0.08)',
                      color: a.isDemo ? '#94a3b8' : '#4fe0a8',
                      border: a.isDemo ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(79, 224, 168, 0.25)',
                      textTransform: 'uppercase' as const,
                    }}
                  >
                    {a.isDemo ? 'Simulated' : 'Live On-Chain'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ASK QUESTIONS: QUERY HISTORY ── */}
        <div
          id="query-history-section"
          style={{
            marginTop: 40,
            paddingTop: 32,
            borderTop: '1px solid rgba(255, 255, 255, 0.07)',
          }}
        >
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontFamily: 'var(--display)',
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: '-0.03em',
                color: 'var(--white)',
                marginBottom: 6,
              }}
            >
              Ask Questions
            </div>
          </div>

          {/* Quick Preset Prompts */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {[
              `What was the peak-to-trough maximum drawdown?`,
              `How did dividends affect the multiplier?`,
            ].map((preset) => (
              <button
                key={preset}
                onClick={() => handleUnifiedQuery(preset)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  background: 'rgba(255, 255, 255, 0.02)',
                  color: '#94a3b8',
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {preset}
              </button>
            ))}
          </div>

          {/* Unified Type Bar */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              background: 'linear-gradient(180deg, rgba(14, 28, 22, 0.6) 0%, rgba(8, 16, 13, 0.8) 100%)',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              borderRadius: 12,
              padding: '8px 10px 8px 18px',
              alignItems: 'center',
              boxShadow: '0 8px 30px rgba(0, 0, 0, 0.25)',
              marginBottom: 24,
            }}
          >
            <input
              id="unified-query-input"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnifiedQuery()}
              placeholder={`Ask anything about ${ticker} (e.g. "What was max drawdown?" or "How did dividends affect the multiplier?")...`}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: 'var(--white)',
                fontFamily: 'var(--sans)',
                fontSize: 14,
                outline: 'none',
              }}
            />

            <button
              id="unified-query-submit-btn"
              onClick={() => handleUnifiedQuery()}
              disabled={isProcessing || !queryInput.trim()}
              style={{
                padding: '10px 22px',
                borderRadius: 8,
                background: 'var(--mint)',
                color: '#091912',
                border: 'none',
                fontWeight: 600,
                fontSize: 13.5,
                cursor: isProcessing || !queryInput.trim() ? 'not-allowed' : 'pointer',
                opacity: isProcessing || !queryInput.trim() ? 0.5 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {isProcessing ? 'Analyzing…' : 'Query'}
            </button>
          </div>

          {/* Results Stream / Feed */}
          {queryHistory.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {queryHistory.map((item) => (
                <div
                  key={item.id}
                  style={{
                    background: 'linear-gradient(180deg, rgba(11, 24, 18, 0.65) 0%, rgba(6, 15, 11, 0.8) 100%)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    borderRadius: 12,
                    padding: '20px 24px',
                  }}
                >
                  {/* User Query Tag */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 14,
                      paddingBottom: 10,
                      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 10,
                          letterSpacing: '.08em',
                          textTransform: 'uppercase' as const,
                          color: '#64748b',
                        }}
                      >
                        Query
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--sans)',
                          fontSize: 14,
                          fontWeight: 600,
                          color: 'var(--white)',
                        }}
                      >
                        {item.query}
                      </span>
                    </div>

                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#475569' }}>
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* Backtest Result Card (if applicable) */}
                  {item.backtestResult && (
                    <div
                      style={{
                        marginBottom: 16,
                        padding: '14px 18px',
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(79, 224, 168, 0.2)',
                        borderLeft: '3px solid #4fe0a8',
                        borderRadius: '0 8px 8px 0',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 8,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: 10.5,
                            letterSpacing: '.08em',
                            textTransform: 'uppercase' as const,
                            color: '#4fe0a8',
                            fontWeight: 600,
                          }}
                        >
                          Backtest Simulation Result
                        </span>

                        <span
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: 10,
                            padding: '2px 8px',
                            borderRadius: 4,
                            background:
                              item.backtestResult.triggeredCount > 0
                                ? 'rgba(244, 63, 94, 0.12)'
                                : 'rgba(16, 185, 129, 0.12)',
                            color:
                              item.backtestResult.triggeredCount > 0 ? '#f43f5e' : '#10b981',
                            border: `1px solid ${
                              item.backtestResult.triggeredCount > 0
                                ? 'rgba(244, 63, 94, 0.25)'
                                : 'rgba(16, 185, 129, 0.25)'
                            }`,
                          }}
                        >
                          {item.backtestResult.triggeredCount > 0
                            ? `${item.backtestResult.triggeredCount} Breach Triggered`
                            : 'No Breaches (Safe)'}
                        </span>
                      </div>

                      <div
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 11,
                          color: '#cbd5e1',
                          lineHeight: 1.6,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {item.backtestResult.summary}
                      </div>
                    </div>
                  )}

                  {/* Grounded AI / Analytics Answer */}
                  <div
                    style={{
                      fontFamily: 'var(--sans)',
                      fontSize: 13.5,
                      lineHeight: 1.65,
                      color: '#94a3b8',
                    }}
                  >
                    {renderAnswerMarkdown(item.answer)}
                  </div>
                </div>
              ))}
              <div ref={queryBottomRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
