import { createCanvas, loadImage } from 'canvas'
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const logoPath  = resolve(__dirname, '../frontend/public/icons/logo.png')
const outDir    = resolve(__dirname, '../frontend/public')

async function generateIcon(size, outFile, paddingPct = 0.1) {
  const canvas = createCanvas(size, size)
  const ctx    = canvas.getContext('2d')

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  // Load and draw logo centered with padding
  const img     = await loadImage(logoPath)
  const pad     = Math.round(size * paddingPct)
  const drawSize = size - pad * 2

  // Keep aspect ratio
  const ratio = Math.min(drawSize / img.width, drawSize / img.height)
  const w     = img.width  * ratio
  const h     = img.height * ratio
  const x     = (size - w) / 2
  const y     = (size - h) / 2

  ctx.drawImage(img, x, y, w, h)

  writeFileSync(outFile, canvas.toBuffer('image/png'))
  console.log(`✓ ${outFile} (${size}×${size})`)
}

await generateIcon(512, resolve(outDir, 'icon-512.png'), 0.08)
await generateIcon(192, resolve(outDir, 'icon-192.png'), 0.08)
await generateIcon(72,  resolve(outDir, 'badge-72.png'), 0.10)

console.log('Done.')
