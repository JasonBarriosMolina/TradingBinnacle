// esbuild bundler for Lambda functions
import { build } from 'esbuild'
import { readdirSync, mkdirSync } from 'fs'
import { join } from 'path'

const entryPoints = [
  'functions/auth/handler.ts',
  'functions/trades/sync.ts',
  'functions/trades/get.ts',
  // generateChart.ts removed — chart rendering is now client-side (TradeChart component)
  // canvas native binary is incompatible with Lambda Linux when compiled on Windows
  'functions/trades/mt5sync.ts',
  'functions/signals/monitor.ts',
  'functions/signals/get.ts',
  'functions/admin/users.ts',
]

await build({
  entryPoints,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: 'dist',
  external: [
    // AWS SDK v3 is available in Lambda Node20 runtime
    '@aws-sdk/*',
  ],
  sourcemap: false,
  minify: false,
  treeShaking: true,
})

console.log('✅ Backend built successfully')
