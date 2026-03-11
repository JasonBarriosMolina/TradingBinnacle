# SYNTRA

Plataforma SaaS de bitácora de trading automatizada y sistema de señales para índices sintéticos de Deriv (Crash 500, Crash 1000, Boom 500, Boom 1000).

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS + Lightweight Charts |
| PWA | Workbox + Web Push API |
| Estado | Zustand + React Query |
| Backend | AWS Lambda (Node 20) + API Gateway HTTP |
| Base de datos | DynamoDB (3 tablas) |
| Auth | AWS Cognito |
| Storage | S3 + CloudFront |
| Email | AWS SES |
| Señales | EventBridge (1 min) + Web Push |
| Charts server | canvas npm package en Lambda |

## Estructura

```
syntra/
├── frontend/          # React PWA
│   ├── src/
│   │   ├── components/    # TradeCard, StochBadge, PlanGate, SignalFeed, TradeChart, Layout
│   │   ├── pages/         # Dashboard, Journal, Signals, Stats, Settings, Admin + auth
│   │   ├── hooks/         # useDerivAuth, useTrades, useSignals
│   │   ├── store/         # authStore (Zustand)
│   │   └── lib/           # api.ts, derivApi.ts, stochCalc.ts, dateUtils.ts
│   └── .env.example
│
├── backend/           # AWS Lambda funciones
│   ├── functions/
│   │   ├── auth/          # register, login, forgot-pw, confirm-reset, deriv-token, me
│   │   ├── trades/        # sync, get/list, stats, generateChart
│   │   ├── signals/       # monitor (EventBridge), get/list, watchlist, push-sub
│   │   └── admin/         # users CRUD
│   ├── lib/               # dynamo, s3, ses, deriv, auth helpers
│   ├── stoch/             # calculator.ts (re-exports shared)
│   ├── template.yaml      # AWS SAM
│   └── .env.example
│
└── shared/            # Tipos TypeScript + Stoch 5,3,3 compartido
    ├── types.ts
    └── stochCalc.ts
```

## Setup local

### Frontend
```bash
cd frontend
cp .env.example .env
# Editar .env con tus valores
npm install
npm run dev
```

### Backend
```bash
cd backend
cp .env.example .env
# Editar .env con tus valores de AWS
npm install
npm run build
# Deploy con SAM:
sam build && sam deploy --guided
```

## Variables de entorno

Ver `frontend/.env.example` y `backend/.env.example`.

### Generar VAPID keys
```bash
npx web-push generate-vapid-keys
```

## Planes

| Feature | Free | Trader | Pro |
|---------|------|--------|-----|
| Trades registrados | 30 | ∞ | ∞ |
| Cuenta real Deriv | ❌ | ✅ | ✅ |
| Sistema de señales | ❌ | ❌ | ✅ |
| Exportar datos | ❌ | ❌ | ✅ |
| Push notifications | ❌ | ❌ | ✅ |

Trial: **30 días** de Plan Pro al registrarse.
Precio: configurable via `MONTHLY_PRICE_USD` (sin redeploy).
Activación: manual por admin tras confirmar SINPE/transferencia.

## Algoritmo de señales

- **CRASH (SELL):** Stoch 1H + 15M + 5M > 80 + cruce bajista 5M + EMA20 < EMA50
- **BOOM (BUY):** Stoch 1H + 15M + 5M < 20 + cruce alcista 5M + EMA20 > EMA50
- Monitor corre cada 1 minuto vía EventBridge
- Notificación push inmediata a usuarios Pro con ese índice en watchlist

## Deploy producción

1. Deploy backend: `sam deploy --guided` → toma nota de ApiUrl, UserPoolId, ClientId
2. Configurar SSM Parameters con los valores de `.env`
3. Build frontend con los valores de Cognito + API URL
4. Deploy frontend a S3 + CloudFront
