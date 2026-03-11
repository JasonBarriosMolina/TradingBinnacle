import { createCanvas, type CanvasRenderingContext2D } from 'canvas'
import { uploadPng } from '../../lib/s3'
import type { Trade, Candle, StochResult } from '../../../shared/types'

const W = 1200
const H = 700
const CHART_H = 460
const STOCH_H = 180
const STOCH_Y = CHART_H + 40
const PAD = { left: 60, right: 20, top: 20, bottom: 20 }

// Colors
const C = {
  bg: '#0D1117',
  surface: '#161B22',
  border: '#21262D',
  grid: '#1C2128',
  text: '#7D8590',
  textBright: '#E6EDF3',
  green: '#2EA043',
  greenLight: '#3FB950',
  red: '#F85149',
  blue: '#388BFD',
  yellow: '#D29922',
  up: '#2EA043',
  down: '#F85149',
  wick: '#484F58',
}

export async function generateTradeChart(
  trade: Trade,
  candles: Candle[],
  stoch: StochResult,
): Promise<string> {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D

  // Background
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)

  // Draw header info
  drawHeader(ctx, trade)

  // Draw candlestick chart
  const chartArea = { x: PAD.left, y: PAD.top + 50, w: W - PAD.left - PAD.right, h: CHART_H }
  drawCandlesticks(ctx, candles, chartArea, trade)

  // Separator
  ctx.strokeStyle = C.border
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD.left, STOCH_Y - 10)
  ctx.lineTo(W - PAD.right, STOCH_Y - 10)
  ctx.stroke()

  // Stochastic label
  ctx.fillStyle = C.text
  ctx.font = '11px monospace'
  ctx.fillText('STOCH 5,3,3', PAD.left, STOCH_Y - 14)

  // Stoch panel
  const stochArea = { x: PAD.left, y: STOCH_Y, w: W - PAD.left - PAD.right, h: STOCH_H }
  drawStochastic(ctx, stoch, stochArea)

  const buffer = canvas.toBuffer('image/png')
  const key = `charts/${trade.userId}/${trade.tradeId}.png`
  return uploadPng(key, buffer)
}

function drawHeader(ctx: CanvasRenderingContext2D, trade: Trade) {
  const isWin = trade.resultado === 'WIN'
  const color = isWin ? C.green : C.red

  ctx.font = 'bold 14px monospace'
  ctx.fillStyle = C.textBright
  ctx.fillText(`${trade.indice.replace('_', ' ')} — ${trade.direccion}`, PAD.left, 40)

  ctx.font = '12px monospace'
  ctx.fillStyle = C.text
  ctx.fillText(`Entrada: ${trade.precioEntrada.toFixed(4)}`, PAD.left + 220, 40)
  ctx.fillText(`Cierre: ${trade.precioCierre.toFixed(4)}`, PAD.left + 380, 40)
  ctx.fillText(`Stake: $${trade.stake.toFixed(2)}`, PAD.left + 530, 40)

  ctx.font = 'bold 14px monospace'
  ctx.fillStyle = color
  const pnl = `${trade.gananciaUSD >= 0 ? '+' : ''}$${trade.gananciaUSD.toFixed(2)}`
  ctx.fillText(`${trade.resultado}  ${pnl}`, W - 160, 40)

  ctx.font = '11px monospace'
  ctx.fillStyle = isWin ? C.green : C.red
  ctx.fillText(trade.senalValida ? 'SEÑAL VÁLIDA ✓' : 'SIN SEÑAL', W - 160, 58)
}

function drawCandlesticks(
  ctx: CanvasRenderingContext2D,
  candles: Candle[],
  area: { x: number; y: number; w: number; h: number },
  trade: Trade,
) {
  if (candles.length === 0) return

  const prices = candles.flatMap((c) => [c.high, c.low])
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)
  const pRange = maxP - minP || 1

  const scaleY = (p: number) => area.y + area.h - ((p - minP) / pRange) * area.h
  const candleW = Math.max(2, Math.floor(area.w / candles.length) - 1)
  const step = area.w / candles.length

  // Grid lines
  ctx.strokeStyle = C.grid
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = area.y + (area.h / 4) * i
    ctx.beginPath()
    ctx.moveTo(area.x, y)
    ctx.lineTo(area.x + area.w, y)
    ctx.stroke()
    const price = maxP - (pRange / 4) * i
    ctx.fillStyle = C.text
    ctx.font = '10px monospace'
    ctx.fillText(price.toFixed(3), 2, y + 4)
  }

  // Candles
  candles.forEach((c, i) => {
    const x = area.x + i * step + step / 2
    const isUp = c.close >= c.open
    const color = isUp ? C.up : C.down

    const openY = scaleY(c.open)
    const closeY = scaleY(c.close)
    const highY = scaleY(c.high)
    const lowY = scaleY(c.low)

    // Wick
    ctx.strokeStyle = C.wick
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, highY)
    ctx.lineTo(x, lowY)
    ctx.stroke()

    // Body
    ctx.fillStyle = color
    const bodyTop = Math.min(openY, closeY)
    const bodyH = Math.max(1, Math.abs(openY - closeY))
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH)
  })

  // Entry/exit markers
  const entryTs = new Date(trade.horaEntrada).getTime() / 1000
  const exitTs = new Date(trade.horaCierre).getTime() / 1000

  const firstTs = candles[0].time
  const lastTs = candles[candles.length - 1].time
  const tsRange = lastTs - firstTs || 1

  const entryX = area.x + ((entryTs - firstTs) / tsRange) * area.w
  const exitX = area.x + ((exitTs - firstTs) / tsRange) * area.w

  // Entry line
  if (entryX >= area.x && entryX <= area.x + area.w) {
    ctx.strokeStyle = C.blue
    ctx.lineWidth = 2
    ctx.setLineDash([6, 3])
    ctx.beginPath()
    ctx.moveTo(entryX, area.y)
    ctx.lineTo(entryX, area.y + area.h)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = C.blue
    ctx.font = 'bold 11px monospace'
    ctx.fillText('ENTRADA', entryX + 4, area.y + 16)
    ctx.font = '10px monospace'
    ctx.fillText(trade.precioEntrada.toFixed(4), entryX + 4, area.y + 30)
  }

  // Exit line
  if (exitX >= area.x && exitX <= area.x + area.w) {
    const exitColor = trade.gananciaUSD >= 0 ? C.green : C.red
    ctx.strokeStyle = exitColor
    ctx.lineWidth = 2
    ctx.setLineDash([6, 3])
    ctx.beginPath()
    ctx.moveTo(exitX, area.y)
    ctx.lineTo(exitX, area.y + area.h)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = exitColor
    ctx.font = 'bold 11px monospace'
    ctx.fillText('CIERRE', exitX + 4, area.y + 16)
    ctx.font = '10px monospace'
    const pnl = `${trade.gananciaUSD >= 0 ? '+' : ''}$${trade.gananciaUSD.toFixed(2)}`
    ctx.fillText(pnl, exitX + 4, area.y + 30)
  }
}

function drawStochastic(
  ctx: CanvasRenderingContext2D,
  stoch: StochResult,
  area: { x: number; y: number; w: number; h: number },
) {
  const { k, d } = stoch
  if (k.length === 0) return

  const scaleY = (v: number) => area.y + area.h - (v / 100) * area.h

  // Zone fills
  ctx.fillStyle = 'rgba(248,81,73,0.08)'
  ctx.fillRect(area.x, area.y, area.w, scaleY(80) - area.y)
  ctx.fillStyle = 'rgba(46,160,67,0.08)'
  ctx.fillRect(area.x, scaleY(20), area.w, area.y + area.h - scaleY(20))

  // Zone lines
  for (const level of [80, 50, 20]) {
    const y = scaleY(level)
    ctx.strokeStyle = level === 50 ? C.border : (level === 80 ? C.red : C.green)
    ctx.lineWidth = 1
    ctx.globalAlpha = level === 50 ? 0.3 : 0.5
    ctx.beginPath()
    ctx.moveTo(area.x, y)
    ctx.lineTo(area.x + area.w, y)
    ctx.stroke()
    ctx.globalAlpha = 1

    ctx.fillStyle = C.text
    ctx.font = '9px monospace'
    ctx.fillText(String(level), 2, y + 4)
  }

  const step = area.w / (k.length - 1)

  // Draw K line
  ctx.strokeStyle = C.blue
  ctx.lineWidth = 1.5
  ctx.beginPath()
  k.forEach((v, i) => {
    const x = area.x + i * step
    const y = scaleY(v)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.stroke()

  // Draw D line
  ctx.strokeStyle = C.yellow
  ctx.lineWidth = 1
  ctx.beginPath()
  d.forEach((v, i) => {
    const offset = k.length - d.length
    const x = area.x + (i + offset) * step
    const y = scaleY(v)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.stroke()

  // Legend
  ctx.font = '10px monospace'
  ctx.fillStyle = C.blue
  ctx.fillText(`%K ${k[k.length - 1]?.toFixed(1)}`, area.x + 4, area.y - 4)
  ctx.fillStyle = C.yellow
  ctx.fillText(`%D ${d[d.length - 1]?.toFixed(1)}`, area.x + 70, area.y - 4)
}
