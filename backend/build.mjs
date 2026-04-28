/**
 * SYNTRA 2.0 — esbuild bundler
 * Compila cada función Lambda en un bundle único dentro de infrastructure/dist/
 *
 * Uso:
 *   node build.mjs           # build de todas las funciones
 *   node build.mjs signal-worker  # build de una función específica
 */

import esbuild from 'esbuild';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Funciones a compilar ──────────────────────────────────────────────────────
// Agrega nuevas funciones aquí
const FUNCTIONS = [
  'signal-worker',
  'feature-engine',
  'ml-scorer',
  'step-orchestrator',
  'trades-api',
  'signals-api',
  'stats-api',
  'forecast-api',
  'copilot-api',
  'admin-api',
  'auth-triggers',
  'plan-checker',
  'weekly-report',
  'retraining-job',
  'retraining-poller',
  'ml-status-api',
  'data-collector',
  'users-api',
  'deriv-connect',
  'backtest-api',
];

// Paquetes disponibles en el runtime de Lambda Node.js 20 — no bundlear
const EXTERNAL = [
  // AWS SDK v3 está disponible en Lambda Node.js 20
  '@aws-sdk/*',
  // Lambda Layers — resueltos en runtime como /opt/nodejs/...
  '/opt/nodejs/*',
  '/opt/nodejs/index',
  '/opt/nodejs/stoch-calculator',
  // Módulos nativos de Node
  'stream', 'fs', 'path', 'os', 'crypto', 'url', 'http', 'https', 'zlib',
  'util', 'events', 'buffer', 'querystring', 'net', 'tls', 'child_process',
];

const outDir = resolve(__dirname, '../infrastructure/dist');

// Filtrar si se pasó una función específica como argumento
const targetFn = process.argv[2];
const toBuild = targetFn
  ? FUNCTIONS.filter(f => f === targetFn)
  : FUNCTIONS;

if (targetFn && toBuild.length === 0) {
  console.error(`Función no encontrada: ${targetFn}`);
  console.error(`Disponibles: ${FUNCTIONS.join(', ')}`);
  process.exit(1);
}

// Limpiar output si es build completo
if (!targetFn) {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
}

console.log(`\n🔨 Building ${toBuild.length} function(s)...\n`);

const results = await Promise.allSettled(
  toBuild.map(async (fnName) => {
    const entryPoint = resolve(__dirname, `functions/${fnName}/handler.js`);
    const fnOutDir   = resolve(outDir, fnName);

    if (!existsSync(entryPoint)) {
      throw new Error(`Entry point not found: ${entryPoint}`);
    }

    mkdirSync(fnOutDir, { recursive: true });

    // signal-worker, deriv-connect, and backtest-api need ws bundled (not available in Lambda runtime)
    const needsWs = ['signal-worker', 'deriv-connect', 'backtest-api'];
    const external = needsWs.includes(fnName)
      ? EXTERNAL.filter(e => e !== 'ws' && !e.startsWith('ws'))
      : EXTERNAL;

    await esbuild.build({
      entryPoints: [entryPoint],
      bundle:      true,
      platform:    'node',
      target:      'node20',
      format:      'cjs',
      outfile:     resolve(fnOutDir, 'handler.js'),
      external,
      minify:      false,  // keep readable for CloudWatch debugging
      sourcemap:   false,
      logLevel:    'warning',
    });

    console.log(`  ✓ ${fnName}`);
    return fnName;
  })
);

let hasError = false;
for (const result of results) {
  if (result.status === 'rejected') {
    console.error(`  ✗ ${result.reason}`);
    hasError = true;
  }
}

if (hasError) {
  console.error('\nBuild failed.\n');
  process.exit(1);
} else {
  console.log(`\n✅ Build complete → infrastructure/dist/\n`);
}
