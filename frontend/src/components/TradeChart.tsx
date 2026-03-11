import { useEffect, useRef } from 'react'
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  type IChartApi,
  type CandlestickSeriesOptions,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts'
import type { Candle } from '../shared/types'

interface TradeChartProps {
  candles: Candle[]
  entryTime?: number
  exitTime?: number
  entryPrice?: number
  exitPrice?: number
  height?: number
}

export function TradeChart({
  candles,
  entryTime,
  exitTime,
  entryPrice,
  exitPrice,
  height = 300,
}: TradeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return

    // Shift UTC epochs → local time so the x-axis labels match the user's clock.
    // getTimezoneOffset() returns minutes *west* of UTC (positive for UTC-N zones).
    // Costa Rica UTC-6 → 360 min → 21600 sec.
    // Subtracting the offset makes the chart render epoch-UTC as local time.
    const tzSec = new Date().getTimezoneOffset() * 60

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { color: '#FFFFFF' },
        textColor: '#9CA3AF',
      },
      grid: {
        vertLines: { color: '#F3F4F6' },
        horzLines: { color: '#F3F4F6' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#E5E7EB' },
      timeScale: {
        borderColor: '#E5E7EB',
        timeVisible: true,
        secondsVisible: false,
        // Always render tick marks as HH:MM using the shifted (local) epoch.
        // getUTCHours() on the shifted timestamp gives the correct local hour,
        // so midnight shows "00:00" instead of the day number "4".
        tickMarkFormatter: (time: number) => {
          const d = new Date(time * 1000)
          const h = d.getUTCHours().toString().padStart(2, '0')
          const m = d.getUTCMinutes().toString().padStart(2, '0')
          return `${h}:${m}`
        },
      },
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#16A34A',
      downColor: '#DC2626',
      borderUpColor: '#16A34A',
      borderDownColor: '#DC2626',
      wickUpColor: '#16A34A',
      wickDownColor: '#DC2626',
    } as Partial<CandlestickSeriesOptions>)

    candleSeries.setData(
      candles.map((c) => ({
        time: (c.time - tzSec) as unknown as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )

    // Add entry / exit markers on the candlestick series
    const markers: SeriesMarker<Time>[] = []

    if (entryTime && entryPrice) {
      markers.push({
        time: (entryTime - tzSec) as unknown as Time,
        position: 'belowBar',
        color: '#2563EB',
        shape: 'arrowUp',
        text: `Entrada ${entryPrice.toFixed(5)}`,
        size: 1,
      })
    }

    if (exitTime && exitPrice) {
      const isWin = exitPrice > (entryPrice ?? 0)
      markers.push({
        time: (exitTime - tzSec) as unknown as Time,
        position: 'aboveBar',
        color: isWin ? '#16A34A' : '#DC2626',
        shape: 'arrowDown',
        text: `Cierre ${exitPrice.toFixed(5)}`,
        size: 1,
      })
    }

    if (markers.length > 0) {
      createSeriesMarkers(candleSeries, markers)
    }

    chart.timeScale().fitContent()
    chartRef.current = chart

    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: containerRef.current?.clientWidth ?? 600 })
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      chart.remove()
    }
  }, [candles, entryTime, exitTime, entryPrice, exitPrice, height])

  return <div ref={containerRef} className="chart-container w-full" />
}
