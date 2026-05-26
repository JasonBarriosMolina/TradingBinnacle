"""
SYNTRA 2.0 — syntra-tick-etl (v2)
AWS Glue Python Shell job.

Lee velas OHLC multi-temporalidad desde S3, calcula Stoch(5,3,3) en cada
temporalidad, extrae 24 features por vela 5M y etiqueta si la operacion
habria sido profitable (TP alcanzado antes que SL).

S3 input:
  raw/{SYMBOL}/1H/candles_*.json   -> velas 1H para tendencia + stoch
  raw/{SYMBOL}/15M/candles_*.json  -> velas 15M para stoch
  raw/{SYMBOL}/5M/candles_*.json   -> velas 5M para stoch + label + features

S3 output:
  processed/{SYMBOL}/features.csv  -> label (col 0) + 24 features, sin header

Glue args: --symbol, --stage, --bucket
"""

import sys
import io
import json
import boto3
import datetime

from awsglue.utils import getResolvedOptions

args   = getResolvedOptions(sys.argv, ['symbol', 'stage', 'bucket'])
SYMBOL = args['symbol'].upper()
STAGE  = args['stage']
BUCKET = args['bucket']

IS_CRASH = SYMBOL.startswith('CRASH')

# SL/TP en puntos (debe coincidir con signal-worker)
SL_PTS       = 14
TP_PTS       = 28
LABEL_WINDOW = 20   # mirar N velas 5M hacia adelante para el label

print(f"[etl-v2] symbol={SYMBOL} is_crash={IS_CRASH} bucket={BUCKET}")

s3 = boto3.client('s3')

# ---------------------------------------------------------------------------
# S3 helpers
# ---------------------------------------------------------------------------

def list_s3_keys(prefix):
    keys = []
    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
        for obj in page.get('Contents', []):
            keys.append(obj['Key'])
    return keys


def read_s3_json(key):
    resp = s3.get_object(Bucket=BUCKET, Key=key)
    return json.loads(resp['Body'].read())


def write_s3_text(key, text):
    s3.put_object(Bucket=BUCKET, Key=key, Body=text.encode('utf-8'), ContentType='text/csv')

# ---------------------------------------------------------------------------
# Step 1 — Cargar velas de S3 por temporalidad
# ---------------------------------------------------------------------------

def load_candles(gran_label):
    """
    Lee todos los archivos de una temporalidad, junta, deduplica por epoch y ordena.
    Cada archivo tiene estructura: { candles: [{epoch, open, high, low, close}] }
    """
    prefix = f"raw/{SYMBOL}/{gran_label}/"
    keys   = list_s3_keys(prefix)
    if not keys:
        print(f"[load] WARN: No files at {prefix}")
        return []

    seen = {}
    for key in keys:
        try:
            data = read_s3_json(key)
            raw  = data.get('candles', data) if isinstance(data, dict) else data
            for c in raw:
                ep = int(c['epoch'])
                if ep not in seen:
                    seen[ep] = {
                        'epoch': ep,
                        'open':  float(c['open']),
                        'high':  float(c['high']),
                        'low':   float(c['low']),
                        'close': float(c['close']),
                    }
        except Exception as exc:
            print(f"[load] WARN: {key}: {exc}")

    candles = sorted(seen.values(), key=lambda c: c['epoch'])
    print(f"[load] {gran_label}: {len(candles)} candles from {len(keys)} file(s)")
    return candles


print("[step-1] Loading candles ...")
candles_1h  = load_candles('1H')
candles_15m = load_candles('15M')
candles_5m  = load_candles('5M')

if len(candles_5m) < 200:
    print(f"[step-1] ERROR: Insufficient 5M candles ({len(candles_5m)}). Aborting.")
    sys.exit(0)

# ---------------------------------------------------------------------------
# Step 2 — Stochastic (5, 3, 3)
# ---------------------------------------------------------------------------

K_PERIOD    = 5
SMOOTH      = 3
D_PERIOD    = 3
MIN_CANDLES = K_PERIOD + SMOOTH + D_PERIOD - 2  # = 9


def sma_series(values, period):
    result = [None] * len(values)
    for i in range(period - 1, len(values)):
        window = values[i - period + 1: i + 1]
        if any(v is None for v in window):
            continue
        result[i] = sum(window) / period
    return result


def calc_stoch(candles):
    n     = len(candles)
    raw_k = [None] * n
    for i in range(K_PERIOD - 1, n):
        lo = min(candles[j]['low']  for j in range(i - K_PERIOD + 1, i + 1))
        hi = max(candles[j]['high'] for j in range(i - K_PERIOD + 1, i + 1))
        if hi == lo:
            raw_k[i] = 50.0
        else:
            raw_k[i] = (candles[i]['close'] - lo) / (hi - lo) * 100.0
    K = sma_series(raw_k, SMOOTH)
    D = sma_series(K,     D_PERIOD)
    return K, D


def calc_slope(arr, n=3):
    valid = [v for v in arr if v is not None][-n:]
    if len(valid) < 2:
        return 0.0
    return (valid[-1] - valid[0]) / (len(valid) - 1)


print("[step-2] Computing Stoch(5,3,3) on all TFs ...")

K_1h,  D_1h  = calc_stoch(candles_1h)  if len(candles_1h)  >= MIN_CANDLES else ([], [])
K_15m, D_15m = calc_stoch(candles_15m) if len(candles_15m) >= MIN_CANDLES else ([], [])
K_5m,  D_5m  = calc_stoch(candles_5m)

print(f"[step-2] 1H:{len(K_1h)} 15M:{len(K_15m)} 5M:{len(K_5m)}")

# ---------------------------------------------------------------------------
# Step 3 — Lookup helpers
# ---------------------------------------------------------------------------

def build_stoch_lookup(candles, K, D):
    """
    Para cada candle, guarda k, d actuales y k_prev, d_prev (para hook detection).
    """
    records = []
    last_valid = {'k': None, 'd': None}
    prev_valid = {'k': None, 'd': None}

    for i in range(len(candles)):
        k_curr = K[i] if i < len(K) else None
        d_curr = D[i] if i < len(D) else None

        rec = {
            'k':      k_curr if k_curr is not None else last_valid['k'],
            'd':      d_curr if d_curr is not None else last_valid['d'],
            'k_prev': prev_valid['k'],
            'd_prev': prev_valid['d'],
        }
        records.append(rec)

        if k_curr is not None and d_curr is not None:
            prev_valid = dict(last_valid)
            last_valid = {'k': k_curr, 'd': d_curr}

    return records


def get_stoch_at_epoch(target_epoch, candles, records):
    """Devuelve el record del candle mas reciente con epoch <= target_epoch."""
    best = None
    for i, c in enumerate(candles):
        if c['epoch'] <= target_epoch:
            best = records[i]
        else:
            break
    return best


def get_d_slope_at_epoch(target_epoch, candles, D_arr, n=3):
    values = []
    for i, c in enumerate(candles):
        if c['epoch'] > target_epoch:
            break
        if i < len(D_arr) and D_arr[i] is not None:
            values.append(D_arr[i])
    return calc_slope(values, n)


print("[step-3] Building lookup tables ...")
stoch_1h_recs  = build_stoch_lookup(candles_1h,  K_1h,  D_1h)  if candles_1h  else []
stoch_15m_recs = build_stoch_lookup(candles_15m, K_15m, D_15m) if candles_15m else []

# ---------------------------------------------------------------------------
# Step 4 — Swing point detection
# ---------------------------------------------------------------------------

def find_swing_points(candles, swing_type='high', lookback=2):
    points = []
    for i in range(lookback, len(candles) - lookback):
        val = candles[i]['high'] if swing_type == 'high' else candles[i]['low']
        is_swing = True
        for j in range(i - lookback, i + lookback + 1):
            if j == i:
                continue
            cmp = candles[j]['high'] if swing_type == 'high' else candles[j]['low']
            if swing_type == 'high' and cmp >= val:
                is_swing = False; break
            if swing_type == 'low'  and cmp <= val:
                is_swing = False; break
        if is_swing:
            points.append({'price': val, 'epoch': candles[i]['epoch'], 'index': i})
    return points

# ---------------------------------------------------------------------------
# Step 5 — Hook detection
# ---------------------------------------------------------------------------

def detect_hook(record, is_crash):
    if not record or record['k'] is None or record['d'] is None:
        return 0
    if record['k_prev'] is None or record['d_prev'] is None:
        return 0
    k, d, kp, dp = record['k'], record['d'], record['k_prev'], record['d_prev']
    if is_crash:
        return 1 if (kp > dp and k < d and k > 80) else 0
    else:
        return 1 if (kp < dp and k > d and k < 20) else 0

# ---------------------------------------------------------------------------
# Step 6 — Feature extraction + labeling
# ---------------------------------------------------------------------------

print("[step-6] Extracting features ...")

BURN_IN = 30
rows    = []

for i in range(BURN_IN, len(candles_5m) - LABEL_WINDOW):
    candle  = candles_5m[i]
    epoch_i = candle['epoch']
    close_i = candle['close']

    # Stoch 1H
    r1h = get_stoch_at_epoch(epoch_i, candles_1h, stoch_1h_recs)
    if not r1h or r1h['k'] is None or r1h['d'] is None:
        continue
    stoch_1h_k       = round(r1h['k'], 6)
    stoch_1h_d       = round(r1h['d'], 6)
    stoch_1h_kd_diff = round(r1h['k'] - r1h['d'], 6)
    stoch_1h_d_slope = round(get_d_slope_at_epoch(epoch_i, candles_1h, D_1h), 6)
    stoch_1h_hook    = detect_hook(r1h, IS_CRASH)

    # Stoch 15M
    r15m = get_stoch_at_epoch(epoch_i, candles_15m, stoch_15m_recs)
    if not r15m or r15m['k'] is None or r15m['d'] is None:
        continue
    stoch_15m_k       = round(r15m['k'], 6)
    stoch_15m_d       = round(r15m['d'], 6)
    stoch_15m_kd_diff = round(r15m['k'] - r15m['d'], 6)
    stoch_15m_d_slope = round(get_d_slope_at_epoch(epoch_i, candles_15m, D_15m), 6)
    stoch_15m_hook    = detect_hook(r15m, IS_CRASH)

    # Stoch 5M
    if i >= len(K_5m) or K_5m[i] is None or D_5m[i] is None:
        continue
    stoch_5m_k       = round(K_5m[i], 6)
    stoch_5m_d       = round(D_5m[i], 6)
    stoch_5m_kd_diff = round(K_5m[i] - D_5m[i], 6)
    stoch_5m_d_slope = round(calc_slope(D_5m[:i+1]), 6)

    # TF alignment
    if IS_CRASH:
        tf_alignment = int(stoch_1h_k > 80 and stoch_1h_d > 80) + \
                       int(stoch_15m_k > 80 and stoch_15m_d > 80) + \
                       int(stoch_5m_k  > 80 and stoch_5m_d  > 80)
    else:
        tf_alignment = int(stoch_1h_k < 20 and stoch_1h_d < 20) + \
                       int(stoch_15m_k < 20 and stoch_15m_d < 20) + \
                       int(stoch_5m_k  < 20 and stoch_5m_d  < 20)

    # Tendencia en 1H (LH+LL o HH+HL)
    c1h_sub = [c for c in candles_1h if c['epoch'] <= epoch_i]
    sh = find_swing_points(c1h_sub, 'high', 2)
    sl_pts = find_swing_points(c1h_sub, 'low', 2)

    trend_confirmed = 0
    lh_magnitude    = 0.0
    hl_magnitude    = 0.0
    candles_since_swing = 0

    if len(sh) >= 2 and len(sl_pts) >= 2:
        last_h, prev_h = sh[-1]['price'], sh[-2]['price']
        last_l, prev_l = sl_pts[-1]['price'], sl_pts[-2]['price']
        lh_magnitude = round(abs((last_h - prev_h) / prev_h) * 100, 6)
        hl_magnitude = round(abs((last_l - prev_l) / prev_l) * 100, 6)
        if IS_CRASH:
            trend_confirmed = 1 if (last_h < prev_h and last_l < prev_l) else 0
        else:
            trend_confirmed = 1 if (last_h > prev_h and last_l > prev_l) else 0

        last_sw_ep = sh[-1]['epoch'] if IS_CRASH else sl_pts[-1]['epoch']
        candles_since_swing = sum(1 for c in candles_1h
                                  if last_sw_ep < c['epoch'] <= epoch_i)

    # Temporal
    dt          = datetime.datetime.utcfromtimestamp(epoch_i)
    hour_of_day = dt.hour
    day_of_week = dt.weekday()

    # Zona de reaccion
    zone_distance_pct = 0.0
    price_in_zone     = 0
    ref_swings = sh[-3:] if IS_CRASH else sl_pts[-3:]
    if len(ref_swings) >= 2:
        prices   = [s['price'] for s in ref_swings]
        raw_min  = min(prices)
        raw_max  = max(prices)
        mid      = sum(prices) / len(prices)
        buf      = 0.0015
        zone_min = raw_min * (1 - buf)
        zone_max = raw_max * (1 + buf)
        if mid != 0:
            zone_distance_pct = round((close_i - mid) / mid * 100, 4)
        price_in_zone = 1 if (zone_min <= close_i <= zone_max) else 0

    # Momentum 5M
    momentum_5m = 0.0
    if i >= 5 and candles_5m[i - 5]['close'] != 0:
        momentum_5m = round(
            (close_i - candles_5m[i - 5]['close']) / candles_5m[i - 5]['close'] * 100, 6
        )

    # Label: trade profitable?
    entry    = close_i
    tp_price = entry - TP_PTS if IS_CRASH else entry + TP_PTS
    sl_price = entry + SL_PTS if IS_CRASH else entry - SL_PTS

    label = 0
    for j in range(i + 1, min(i + 1 + LABEL_WINDOW, len(candles_5m))):
        c = candles_5m[j]
        if IS_CRASH:
            if c['low']  <= tp_price: label = 1; break
            if c['high'] >= sl_price: label = 0; break
        else:
            if c['high'] >= tp_price: label = 1; break
            if c['low']  <= sl_price: label = 0; break

    rows.append([
        label,
        stoch_1h_k,  stoch_1h_d,  stoch_1h_kd_diff,  stoch_1h_d_slope,
        stoch_15m_k, stoch_15m_d, stoch_15m_kd_diff, stoch_15m_d_slope,
        stoch_5m_k,  stoch_5m_d,  stoch_5m_kd_diff,  stoch_5m_d_slope,
        tf_alignment, trend_confirmed,
        lh_magnitude, hl_magnitude,
        hour_of_day, day_of_week,
        zone_distance_pct, price_in_zone,
        candles_since_swing, momentum_5m,
        stoch_1h_hook, stoch_15m_hook,
    ])

n_rows = len(rows)
print(f"[step-6] Generated {n_rows} feature rows")

# ---------------------------------------------------------------------------
# Step 7 — Minimo de filas + distribucion de clases
# ---------------------------------------------------------------------------
if n_rows < 1000:
    print(f"[WARN] Only {n_rows} rows (minimum 1000). Exiting without writing.")
    sys.exit(0)

positive = sum(1 for r in rows if r[0] == 1)
negative = n_rows - positive
scale_pos_weight = round(negative / max(positive, 1), 2)
print(f"[step-7] Classes — profitable:{positive} ({100*positive//n_rows}%), "
      f"not:{negative} ({100*negative//n_rows}%)")
print(f"[step-7] Recommended scale_pos_weight for XGBoost: {scale_pos_weight}")

# ---------------------------------------------------------------------------
# Step 8 — Escribir CSV a S3
# ---------------------------------------------------------------------------
out_key = f"processed/{SYMBOL}/features.csv"

buf = io.StringIO()
for row in rows:
    buf.write(','.join(str(v) for v in row) + '\n')

print(f"[step-8] Writing {n_rows} rows -> s3://{BUCKET}/{out_key} ...")
write_s3_text(out_key, buf.getvalue())
print(f"[step-8] Done. {n_rows} rows, {len(rows[0])-1} features, label=col0.")
