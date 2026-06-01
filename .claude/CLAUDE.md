<!-- CODEGRAPH_START -->
## CodeGraph

This project has a CodeGraph MCP server (`codegraph_*` tools) configured. CodeGraph is a tree-sitter-parsed knowledge graph of every symbol, edge, and file. Reads are sub-millisecond and return structural information grep cannot.

### When to prefer codegraph over native search

Use codegraph for **structural** questions — what calls what, what would break, where is X defined, what is X's signature. Use native grep/read only for **literal text** queries (string contents, comments, log messages) or after you already have a specific file open.

| Question | Tool |
|---|---|
| "Where is X defined?" / "Find symbol named X" | `codegraph_search` |
| "What calls function Y?" | `codegraph_callers` |
| "What does Y call?" | `codegraph_callees` |
| "How does X reach/become Y? / trace the flow from X to Y" | `codegraph_trace` (one call = the whole path, incl. callback/React/JSX dynamic hops) |
| "What would break if I changed Z?" | `codegraph_impact` |
| "Show me Y's signature / source / docstring" | `codegraph_node` |
| "Give me focused context for a task/area" | `codegraph_context` |
| "See several related symbols' source at once" | `codegraph_explore` |
| "What files exist under path/" | `codegraph_files` |
| "Is the index healthy?" | `codegraph_status` |
<!-- CODEGRAPH_END -->

---

# SYNTRA — Contexto del Proyecto

## ¿Qué es SYNTRA?
Sistema de trading automatizado para índices sintéticos **Crash/Boom de Deriv**. Genera señales de entrada basadas en análisis técnico multi-timeframe + ML, las envía por Telegram, y tiene un journal web para registrar resultados.

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 14 (App Router) + Tailwind, desplegado en **Vercel** |
| Backend | AWS Lambda (Node.js 20) vía **Serverless Framework** |
| Base de datos | DynamoDB |
| ML | AWS SageMaker (XGBoost serverless endpoints) + Bedrock (Claude claude-sonnet-4-5) |
| ETL | AWS Glue (Python Shell, GlueVersion 1.0) |
| Datos | Deriv WebSocket API — índices Crash/Boom OHLC |
| Notificaciones | Telegram Bot API |

## Paths clave

```
D:\InHouse\TradingBinnacle\
├── frontend/                          # Next.js app
│   ├── app/(app)/                     # Páginas autenticadas
│   │   ├── dashboard/page.tsx         # Dashboard + ML status card
│   │   ├── signals/page.tsx           # Señales activas/historial
│   │   ├── journal/page.tsx           # Journal de trades
│   │   └── ml-insights/page.tsx      # Estado detallado del ML
│   ├── lib/api.ts                     # Tipos e interfaces + fetch helpers
│   └── components/ui/                 # Badge, Card, StatCard, etc.
├── backend/
│   ├── functions/
│   │   ├── signal-worker/             # Detector de señales (EventBridge 5min)
│   │   ├── step-orchestrator/         # Orquesta: score ML → guarda → Telegram
│   │   ├── ml-scorer/                 # 70% SageMaker + 30% Bedrock
│   │   ├── retraining-job/            # Lanza Glue ETL (domingos 13:00 UTC)
│   │   ├── retraining-poller/         # Avanza pipeline ML (EventBridge 2h)
│   │   ├── data-collector/            # Fetch OHLC desde Deriv (EventBridge 3am UTC)
│   │   ├── signals-api/               # GET/PATCH /signals
│   │   ├── trades-api/                # CRUD /trades
│   │   ├── stats-api/                 # /stats, /stats/equity
│   │   └── ml-status-api/             # GET /ml/status
│   ├── layers/stoch-calculator/       # Layer compartido (versión :9 en prod)
│   │   ├── index.js                   # Código fuente (EDITAR AQUÍ)
│   │   └── nodejs/index.js            # Copia para empaquetado Lambda (SYNC CON index.js)
│   └── glue/syntra-tick-etl.py        # ETL: S3 candles → features.csv
├── serverless.yml                     # Config Serverless Framework (raíz)
├── infrastructure/serverless.yml      # Alternativo (NO usar — usar raíz)
└── build.mjs                          # esbuild — SIEMPRE correr antes de deploy
```

## Índices monitoreados (10 total)

```
CRASH300N, CRASH500, CRASH600, CRASH900, CRASH1000
BOOM300N,  BOOM500,  BOOM600,  BOOM900,  BOOM1000
```

- **CRASH**: dirección SELL, spikes bajistas aleatorios
- **BOOM**: dirección BUY, spikes alcistas aleatorios
- SL: 14 pts | TP: 28 pts | RR 1:2

## Pipeline de señal (flujo completo)

```
EventBridge (5 min)
  → signal-worker
      1. Cooldown check (30 min, DynamoDB syntra-ml-status)
      2. Fetch candles: 1H (50), 15M (30), 5M (30) via Deriv WebSocket
      3. Trend filter: LH+LL (CRASH) o HH+HL (BOOM) en 1H swing points  ← HARD STOP
      4. 5M K en zona extrema: K > 80 (crash) / K < 20 (boom)           ← SIEMPRE obligatorio
      5. DOS ESTRATEGIAS EN PARALELO — señal si CUALQUIERA pasa:
         ┌─ Estrategia A (Zona Extrema):
         │   1H K>80 AND D>80 + 15M K>80 AND D>80 + Hook en 1H o 15M
         └─ Estrategia B (Trend + Crossover):
             K cruzó D en dirección correcta en 1H o 15M, CUALQUIER nivel
             CRASH: kPrev>dPrev && kCurr<dCurr
             BOOM:  kPrev<dPrev && kCurr>dCurr
      → payload incluye campo `strategy: 'zona_extrema' | 'trend_crossover'`
      → invoke step-orchestrator (async)

  → step-orchestrator
      1. Anti-duplicado (30 min, DynamoDB syntra-signals)
      2. invoke ml-scorer (sync)
      3. Guardar señal en DynamoDB (syntra-signals)
      4. Si score >= 65 → send Telegram

  → ml-scorer
      - 70% SageMaker XGBoost endpoint (syntra-{symbol}-endpoint)
      - 30% Bedrock claude-sonnet-4-5 (análisis cualitativo)
      - Si SageMaker no está InService → stoch quality fallback
      - Retorna: { final_score, sagemaker_score, bedrock_score, bedrock_razon, fallback }
```

## Pipeline ML / Retraining

```
EventBridge (domingos 13:00 UTC)
  → retraining-job
      → StartJobRun en Glue para cada símbolo
      → Guarda status "glue_running" en DynamoDB

EventBridge (cada 2 horas)
  → retraining-poller
      → glue_running → polling Glue → si SUCCEEDED → CreateTrainingJob (SageMaker)
      → training → polling SageMaker → si Completed → CreateEndpoint (serverless)
      → deployed → idle
      ⚠️ Jobs de training se lanzan SECUENCIALMENTE (1.5s delay) para evitar rate limit

data-collector (EventBridge 3:00 AM UTC diario)
  → Fetch OHLC candles (1H/15M/5M) desde Deriv WebSocket
  → Guarda en S3: raw/{SYMBOL}/{TF}/candles_{ts}.json
  → Modo historical (event.historical=true): backfill 6 meses

Glue ETL (syntra-tick-etl-prod)
  → Lee S3: raw/{SYMBOL}/1H/, 15M/, 5M/
  → Calcula Stoch(5,3,3), trend, hooks, zona, momentum
  → Escribe: processed/{SYMBOL}/features.csv (24 features + label)
  → Label: trade_profitable (TP antes que SL en próximas 20 velas 5M)
```

## Features del modelo (24 total)

```
stoch_1h_k/d/kd_diff/d_slope    (4)
stoch_15m_k/d/kd_diff/d_slope   (4)
stoch_5m_k/d/kd_diff/d_slope    (4)
tf_alignment (0-3)               (1)
trend_confirmed (0/1)            (1)
lh_magnitude / hl_magnitude      (2)
hour_of_day / day_of_week        (2)
zone_distance_pct / price_in_zone(2)
candles_since_swing              (1)
momentum_5m                      (1)
stoch_1h_hook / stoch_15m_hook   (2)
```

## Layer stoch-calculator

**CRÍTICO**: Hay DOS copias del index.js. Siempre editar ambas:
- `backend/layers/stoch-calculator/index.js` — fuente de verdad
- `backend/layers/stoch-calculator/nodejs/index.js` — copia que Lambda empaqueta

Si se edita solo el primero y no el segundo, Lambda usará el código viejo.

Funciones exportadas clave:
- `calcStoch(candles)` → `{ K[], D[] }`
- `getLastStoch(candles)` → `{ k, d }`
- `findSwingPoints(candles, 'high'|'low', lookback)` → `[{ price, epoch }]`
- `detectHook(K, D, 'crash'|'boom')` → `0 | 1` — cruce K/D estando en zona extrema (>80 crash / <20 boom)
- `detectCrossoverAny(K, D, 'crash'|'boom')` → `0 | 1` — cruce K/D en CUALQUIER nivel (Estrategia B)
- `analyzeReactionZone(candles1H, type, price)` → `{ priceInZone, distancePct, zone }`
- `calcSlope(series)` → number
- `extractStochFeaturesMTF(c1H, c15M, c5M, type, price)` → 24 features

## Build & Deploy

```powershell
# ⚠️ CRÍTICO: Build + cargar .env + deploy deben ir en UN SOLO bloque PowerShell.
# Las variables de entorno NO persisten entre llamadas PowerShell separadas.
# Si se separan en pasos distintos, el deploy quedará con vars vacías en Lambda.

# Build + deploy completo (TODO EN UN BLOQUE):
Get-Content D:\InHouse\TradingBinnacle\backend\.env | ForEach-Object {
  if ($_ -match '^([^=]+)=(.+)$') {
    [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
  }
}
Set-Location D:\InHouse\TradingBinnacle\backend
node build.mjs
Set-Location D:\InHouse\TradingBinnacle
serverless deploy

# Deploy función específica (también en un solo bloque):
Get-Content D:\InHouse\TradingBinnacle\backend\.env | ForEach-Object {
  if ($_ -match '^([^=]+)=(.+)$') {
    [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
  }
}
Set-Location D:\InHouse\TradingBinnacle
serverless deploy --function signal-worker

# 5. Frontend
cd D:\InHouse\TradingBinnacle\frontend
vercel --prod
```

**NUNCA** usar `infrastructure/serverless.yml` — el correcto es el de la raíz.

## AWS

- **Stack**: `syntra-backend-prod`, región `us-east-1`
- **Account**: `798694628803`
- **API Gateway**: `https://d27tq40lb8.execute-api.us-east-1.amazonaws.com/prod`
- **Cognito**: Pool `us-east-1_0clKOkutx`, Client `5i6fcdqqbcor7lge2tb7ql0q53`
- **S3**: `syntra-data-prod` (candles raw + features procesadas + modelos)
- **DynamoDB tables**: `syntra-trades`, `syntra-signals`, `syntra-ml-status`, `syntra-users`
- **Glue job**: `syntra-tick-etl-prod` (GlueVersion 1.0, MaxConcurrentRuns 10)
- **Layer**: `syntra-stoch-calculator-prod:10` (versión actual)
- **SageMaker endpoints**: `syntra-{symbol-lowercase-sin-N}-endpoint` (serverless, 2048MB)
- **Bedrock model**: `us.anthropic.claude-sonnet-4-5-20251001-v1:0`

## Vercel

- **Proyecto**: `syntra`
- **URL producción**: `syntra-journal.vercel.app`
- **Deploy**: `vercel --prod` desde `frontend/`

## DynamoDB — Keys importantes

- `syntra-ml-status`: PK = `symbol` (string)
  - Estados ML: `glue_running` | `training` | `deployed` | `error`
  - Cooldown señales: key = `signal_cooldown_{SYMBOL}`
  - Heartbeat Telegram: key = `heartbeat_status`
- `syntra-signals`: PK = `userId`, SK = `timestampSignalId` (ISO + UUID)
  - Index: `userId-fecha-index`
- `syntra-trades`: PK = `userId`, SK = `tradeId`

## Telegram

- Variables de entorno Lambda: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (señales), `ADMIN_TELEGRAM_CHAT_ID` (admin/heartbeat)
- **Señal** → `step-orchestrator` → `TELEGRAM_CHAT_ID`
- **Heartbeat** (cada 2h sin señales) → `signal-worker` → `ADMIN_TELEGRAM_CHAT_ID`
- **Alertas ML** (training completado/error) → `retraining-poller` → `ADMIN_TELEGRAM_CHAT_ID`

## Score de señal

| Fuente | Peso | Descripción |
|--------|------|-------------|
| SageMaker XGBoost | 70% | Probabilidad de trade_profitable |
| Bedrock Claude | 30% | Análisis cualitativo contexto |
| **Umbral mínimo** | **65/100** | Por debajo → status `low_score`, no se envía |

Si SageMaker no está InService → fallback stoch quality score.

## Stochastic — Parámetros

- Configuración: Stoch(5, 3, 3) — kPeriod=5, smooth=3, dPeriod=3
- **Zona CRASH**: K > 80 AND D > 80
- **Zona BOOM**: K < 20 AND D < 20
- **Hook CRASH** (Estrategia A): kPrev > dPrev AND kCurr < dCurr AND kCurr > 80 (K cruzó D hacia abajo, en zona)
- **Hook BOOM** (Estrategia A): kPrev < dPrev AND kCurr > dCurr AND kCurr < 20 (K cruzó D hacia arriba, en zona)
- **Crossover CRASH** (Estrategia B): kPrev > dPrev AND kCurr < dCurr (cualquier nivel)
- **Crossover BOOM** (Estrategia B): kPrev < dPrev AND kCurr > dCurr (cualquier nivel)
- **tf_alignment** (actualizado): cuenta TFs donde K está en relación correcta con D (K<D crash, K>D boom) → 0-3

## Heartbeat Telegram (sin señales)

Cada 2 horas, si no disparó ninguna señal, `signal-worker` manda resumen al `ADMIN_TELEGRAM_CHAT_ID` clasificando índices por:
1. Sin tendencia confirmada
2. 5M fuera de zona de entrada
3. Sin setup (ni Estrategia A ni B cumple)
4. Cooldown activo

**Si el heartbeat no llega:** verificar que `heartbeat_status` en DynamoDB no esté stale (marcado como enviado con token vacío). Fix: borrar el registro y reinvocar el worker.

## Patrones de código importantes

### Endpoint name de SageMaker
```javascript
`syntra-${symbol.toLowerCase().replace(/n$/, '')}-endpoint`
// CRASH300N → syntra-crash300-endpoint
// BOOM1000  → syntra-boom1000-endpoint
```

### Glue job args
```python
args = getResolvedOptions(sys.argv, ['JOB_NAME', 'symbol', 'stage', 'bucket'])
```

### Deriv WebSocket
```javascript
wss://ws.binaryws.com/websockets/v3?app_id=1089
// Request: { ticks_history, count, granularity, style: 'candles', end: 'latest' }
```

## Cosas pendientes / Roadmap

- **Geometría de mercado**: Usuario mostrará con dibujos qué patrones detectar — NO implementar hasta eso
- **Volatility Indices**: Posible futura fuente de contexto adicional para el ML
- **SageMaker retraining**: En proceso para los 10 símbolos — se completa automáticamente vía retraining-poller cada 2h
- **Mejoras de estrategia**: Dual strategy (A+B) acaba de implementarse — observar resultados antes de ajustar umbrales

## Errores conocidos / Lecciones aprendidas

1. **Layer nodejs/**: SIEMPRE sync `layers/stoch-calculator/nodejs/index.js` con el fuente. Lambda solo lee el subdirectorio `nodejs/`.
2. **Glue GlueVersion**: Python Shell solo acepta `1.0`, no `3.0`.
3. **SageMaker AddTags**: El rol Lambda no tiene permiso `sagemaker:AddTags` — no incluir `Tags` en `CreateTrainingJobCommand`.
4. **SageMaker rate limit**: `CreateTrainingJob` tiene límite de 1 req/s — lanzar secuencialmente con 1.5s delay.
5. **Hyperparámetros XGBoost**: Solo parámetros estándar de XGBoost — NO incluir `label_col`, `index_type` ni campos custom.
6. **infrastructure/serverless.yml vs serverless.yml raíz**: Usar SIEMPRE el de la raíz.
7. **Variables de entorno en deploy**: `serverless.yml` usa `${env:VAR, ''}` — si la terminal no tiene las vars cargadas al momento del deploy, quedan como strings vacíos en Lambda. SIEMPRE cargar `backend/.env` antes de `serverless deploy` (ver sección Build & Deploy). Afecta: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ADMIN_TELEGRAM_CHAT_ID` y otras vars sensibles.
   - **Síntoma**: No llegan señales ni heartbeats a Telegram, pero los logs muestran `heartbeat_sent` y la Lambda corre sin errores.
   - **Diagnóstico**: `aws lambda get-function-configuration --function-name syntra-backend-prod-signal-worker --query "Environment.Variables.{BOT:TELEGRAM_BOT_TOKEN}" --region us-east-1` → si retorna `""` las vars están vacías.
   - **Fix rápido sin redeploy**: Cargar `.env`, hacer `serverless deploy` con las vars cargadas. Luego borrar el registro stale del heartbeat en DynamoDB y reinvocar el worker:
     ```powershell
     # 1. Borrar heartbeat stale (quedó marcado "enviado" con token vacío)
     '{"symbol":{"S":"heartbeat_status"}}' | Out-File "$env:TEMP\hb.json" -Encoding ascii
     aws dynamodb delete-item --table-name syntra-ml-status --region us-east-1 --key "file://$env:TEMP\hb.json"
     # 2. Disparar heartbeat inmediatamente
     $p = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('{}'))
     aws lambda invoke --function-name syntra-backend-prod-signal-worker --region us-east-1 --payload $p --cli-binary-format base64 /dev/null
     ```
   - **Causa raíz del bug**: `markHeartbeatSent()` se llama siempre aunque `sendHeartbeat()` salga sin enviar nada (token vacío). Resultado: DynamoDB queda marcado como "enviado" y el sistema espera 2h antes de intentarlo de nuevo — en loop infinito nunca enviando.
