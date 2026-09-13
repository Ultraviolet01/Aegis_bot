'use client';

import { useEffect, useRef, useState, useMemo } from 'react';

export interface OHLC {
  time: number | string; // unix timestamp in seconds OR 'YYYY-MM-DD'
  open: number;
  high: number;
  low: number;
  close: number;
}

interface CandlestickChartProps {
  data: OHLC[];
  height?: number;
  ticker?: string;
}

export default function CandlestickChart({
  data,
  height = 440,
  ticker = 'SPYX',
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);

  // Active hover candle info (falls back to latest candle)
  const [hoveredCandle, setHoveredCandle] = useState<OHLC | null>(null);

  // Deduplicate and strictly sort data by time
  const validatedData = useMemo(() => {
    if (!data || data.length === 0) return [];

    // Map to normalized items with numeric or string time
    const items = data.map((d) => {
      const open = Number(d.open);
      const close = Number(d.close);
      const high = Math.max(Number(d.high), open, close);
      const low = Math.min(Number(d.low), open, close);
      return {
        time: d.time,
        open,
        high,
        low,
        close,
      };
    });

    // Sort ascending
    items.sort((a, b) => {
      if (typeof a.time === 'number' && typeof b.time === 'number') {
        return a.time - b.time;
      }
      return String(a.time).localeCompare(String(b.time));
    });

    // Deduplicate duplicate times (keep last)
    const unique: typeof items = [];
    for (const item of items) {
      if (unique.length > 0 && unique[unique.length - 1]?.time === item.time) {
        unique[unique.length - 1] = item;
      } else {
        unique.push(item);
      }
    }

    return unique;
  }, [data]);

  const latestCandle = validatedData[validatedData.length - 1] ?? null;
  const activeCandle = hoveredCandle ?? latestCandle;

  useEffect(() => {
    if (!containerRef.current || validatedData.length === 0) return;

    let chart: any = null;
    let series: any = null;
    let resizeObserver: ResizeObserver | null = null;
    let isDisposed = false;

    const initChart = async () => {
      try {
        const { createChart, CandlestickSeries, CrosshairMode, ColorType } =
          await import('lightweight-charts');

        if (isDisposed || !containerRef.current) return;

        // Container width (fallback to 800 if 0)
        const containerWidth = containerRef.current.clientWidth || 800;

        chart = createChart(containerRef.current, {
          width: containerWidth,
          height,
          layout: {
            background: { type: ColorType.Solid, color: 'transparent' },
            textColor: '#64748b',
            fontFamily: '"DM Mono", ui-monospace, SFMono-Regular, monospace',
            fontSize: 11,
          },
          grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
          },
          crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: {
              color: 'rgba(79, 224, 168, 0.4)',
              width: 1,
              style: 3, // dashed
              labelBackgroundColor: '#0f241a',
            },
            horzLine: {
              color: 'rgba(79, 224, 168, 0.4)',
              width: 1,
              style: 3,
              labelBackgroundColor: '#0f241a',
            },
          },
          rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.06)',
            textColor: '#64748b',
            scaleMargins: { top: 0.12, bottom: 0.12 },
          },
          timeScale: {
            borderColor: 'rgba(255, 255, 255, 0.06)',
            timeVisible: true,
            secondsVisible: false,
            fixLeftEdge: true,
            fixRightEdge: true,
          },
          handleScroll: {
            mouseWheel: true,
            pressedMouseMove: true,
          },
          handleScale: {
            mouseWheel: true,
            pinch: true,
            axisPressedMouseMove: true,
          },
        });

        // Add Candlestick Series (Lightweight Charts v5 API)
        series = chart.addSeries(CandlestickSeries, {
          upColor: '#10b981', // vibrant green
          downColor: '#f43f5e', // vibrant red
          borderVisible: true,
          borderUpColor: '#10b981',
          borderDownColor: '#f43f5e',
          wickUpColor: '#10b981',
          wickDownColor: '#f43f5e',
        });

        series.setData(validatedData);
        chart.timeScale().fitContent();

        chartRef.current = chart;
        seriesRef.current = series;

        // Subscribe to crosshair move for real-time OHLC tooltip
        chart.subscribeCrosshairMove((param: any) => {
          if (
            !param ||
            !param.time ||
            !param.seriesData ||
            !param.seriesData.has(series)
          ) {
            setHoveredCandle(null);
            return;
          }
          const bar = param.seriesData.get(series);
          if (bar) {
            setHoveredCandle({
              time: param.time,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
            });
          }
        });

        // Resize observer to keep chart responsive
        resizeObserver = new ResizeObserver((entries) => {
          if (!chart || isDisposed) return;
          const entry = entries[0];
          if (entry && entry.contentRect.width > 0) {
            chart.applyOptions({ width: entry.contentRect.width });
          }
        });
        resizeObserver.observe(containerRef.current);
      } catch (err) {
        console.error('Failed to initialize TradingView CandlestickChart:', err);
      }
    };

    initChart();

    return () => {
      isDisposed = true;
      if (resizeObserver) resizeObserver.disconnect();
      if (chart) {
        chart.remove();
        chart = null;
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, [validatedData, height]);

  // Candle metrics
  const changeVal = activeCandle ? activeCandle.close - activeCandle.open : 0;
  const changePct = activeCandle && activeCandle.open > 0
    ? ((activeCandle.close - activeCandle.open) / activeCandle.open) * 100
    : 0;
  const isUp = changeVal >= 0;

  // Formatted date
  const formattedDate = useMemo(() => {
    if (!activeCandle?.time) return '';
    if (typeof activeCandle.time === 'number') {
      return new Date(activeCandle.time * 1000).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    return String(activeCandle.time);
  }, [activeCandle]);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Top OHLC Status Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          padding: '12px 18px',
          marginBottom: 10,
          background: 'rgba(10, 24, 18, 0.65)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              fontWeight: 600,
              color: '#4fe0a8',
              letterSpacing: '0.06em',
            }}
          >
            {ticker}/USD
          </span>

          {formattedDate && (
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                color: '#64748b',
              }}
            >
              {formattedDate}
            </span>
          )}
        </div>

        {activeCandle ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              fontFamily: 'var(--mono)',
              fontSize: 11,
            }}
          >
            <div style={{ display: 'flex', gap: 4 }}>
              <span style={{ color: '#64748b' }}>O</span>
              <span style={{ color: '#cbd5e1' }}>${activeCandle.open.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <span style={{ color: '#64748b' }}>H</span>
              <span style={{ color: '#cbd5e1' }}>${activeCandle.high.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <span style={{ color: '#64748b' }}>L</span>
              <span style={{ color: '#cbd5e1' }}>${activeCandle.low.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <span style={{ color: '#64748b' }}>C</span>
              <span style={{ color: isUp ? '#10b981' : '#f43f5e', fontWeight: 600 }}>
                ${activeCandle.close.toFixed(2)}
              </span>
            </div>
            <div
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 10.5,
                fontWeight: 600,
                background: isUp ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)',
                color: isUp ? '#10b981' : '#f43f5e',
                border: `1px solid ${isUp ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)'}`,
              }}
            >
              {isUp ? '+' : ''}{changeVal.toFixed(2)} ({isUp ? '+' : ''}{changePct.toFixed(2)}%)
            </div>
          </div>
        ) : (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#64748b' }}>
            Hover over candles to view OHLC data
          </div>
        )}
      </div>

      {/* Chart Canvas Container */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height,
          position: 'relative',
          minWidth: 200,
        }}
      />
    </div>
  );
}
