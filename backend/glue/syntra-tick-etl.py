"""
SYNTRA 2.0 — syntra-tick-etl
AWS Glue Python Shell job.

Reads raw Deriv tick data from S3, builds OHLCV candles, computes
Stoch(5,3,3), extracts feature rows, and writes a labeled CSV for
XGBoost training.

Glue job arguments (--key value):
  --symbol   e.g. CRASH500
  --stage    e.g. prod
  --bucket   e.g. syntra-ml-data
"""

import sys
import io
import json
import math
import boto3
import statistics

# ---------------------------------------------------------------------------
# Glue arg parsing — works both in Glue and when called with sys.argv locally
# ---------------------------------------------------------------------------
from awsglue.utils import getResolvedOptions

args = getResolvedOptions(sys.argv, ['symbol', 'stage', 'bucket'])
SYMBOL = args['symbol'].upper()
STAGE  = args['stage']
BUCKET = args['bucket']

print(f"[syntra-tick-etl] symbol={SYMBOL}  stage={STAGE}  bucket={BUCKET}")

# ---------------------------------------------------------------------------
# S3 helpers
# ---------------------------------------------------------------------------
s3 = boto3.client('s3')

def list_s3_keys(prefix):
    """Return all object keys under prefix (handles pagination)."""
    keys = []
    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
        for obj in page.get('Contents', []):
            keys.append(obj['Key'])
    return keys


def read_s3_json(key):
    """Download an S3 object and parse as JSON."""
    resp = s3.get_object(Bucket=BUCKET, Key=key)
    body = resp['Body'].read()
    return json.loads(body)


def write_s3_text(key, text):
    """Upload text content to S3."""
    s3.put_object(
        Bucket=BUCKET,
        Key=key,
        Body=text.encode('utf-8'),
        ContentType='text/csv',
    )

# ---------------------------------------------------------------------------
# Step 1 — Load all raw tick files
# ---------------------------------------------------------------------------
raw_prefix = f"raw/{SYMBOL}/"
print(f"[step-1] Listing keys at s3://{BUCKET}/{raw_prefix} ...")
keys = list_s3_keys(raw_prefix)
if not keys:
    print(f"[step-1] ERROR: No files found at {raw_prefix}")
    sys.exit(0)

print(f"[step-1] Found {len(keys)} file(s). Loading ticks ...")

ticks = []
for key in keys:
    try:
        data = read_s3_json(key)
        # Each file is an array of {epoch, quote}
        if isinstance(data, list):
            ticks.extend(data)
        else:
            print(f"[step-1] WARN: {key} is not a list — skipped")
    except Exception as exc:
        print(f"[step-1] WARN: Could not read {key}: {exc}")

if not ticks:
    print("[step-1] ERROR: Zero ticks loaded.")
    sys.exit(0)

# Sort by epoch ascending
ticks.sort(key=lambda t: t['epoch'])
epochs = [float(t['epoch']) for t in ticks]
prices = [float(t['quote'])  for t in ticks]
n_ticks = len(ticks)
print(f"[step-1] Loaded {n_ticks} ticks spanning epoch "
      f"{int(epochs[0])}–{int(epochs[-1])}")

# ---------------------------------------------------------------------------
# Step 2 — Build OHLCV candles from raw ticks
# ---------------------------------------------------------------------------

def build_candles(tick_epochs, tick_prices, granularity):
    """
    Aggregate ticks into OHLCV candles.
    granularity: seconds per candle (3600 = 1H, 300 = 5M).
    Returns list of dicts sorted by candle_epoch ascending.
    """
    buckets = {}
    for ep, px in zip(tick_epochs, tick_prices):
        candle_ep = int(ep // granularity) * granularity
        if candle_ep not in buckets:
            buckets[candle_ep] = {'open': px, 'high': px, 'low': px, 'close': px, 'ticks': 1}
        else:
            b = buckets[candle_ep]
            if px > b['high']:  b['high']  = px
            if px < b['low']:   b['low']   = px
            b['close'] = px
            b['ticks'] += 1

    candles = []
    for ep in sorted(buckets.keys()):
        b = buckets[ep]
        candles.append({
            'epoch': ep,
            'open':  b['open'],
            'high':  b['high'],
            'low':   b['low'],
            'close': b['close'],
        })
    return candles

print("[step-2] Building 1H and 5M candles ...")
candles_1h = build_candles(epochs, prices, 3600)
candles_5m = build_candles(epochs, prices, 300)
print(f"[step-2] 1H candles: {len(candles_1h)}, 5M candles: {len(candles_5m)}")

# ---------------------------------------------------------------------------
# Step 3 — Stochastic (5, 3, 3) implementation
# ---------------------------------------------------------------------------

K_PERIOD = 5
SMOOTH   = 3
D_PERIOD = 3
MIN_CANDLES = K_PERIOD + SMOOTH + D_PERIOD - 2  # = 9


def sma_series(values, period):
    """Return SMA series; None for positions without enough data."""
    result = [None] * len(values)
    for i in range(period - 1, len(values)):
        window = values[i - period + 1 : i + 1]
        if any(v is None for v in window):
            continue
        result[i] = sum(window) / period
    return result


def calc_stoch(candles):
    """
    Compute Stoch(5,3,3) K and D arrays over the candle list.
    Returns (K_arr, D_arr) — same length as candles, None where insufficient data.
    """
    n = len(candles)
    raw_k = [None] * n

    for i in range(K_PERIOD - 1, n):
        lo = min(candles[j]['low']  for j in range(i - K_PERIOD + 1, i + 1))
        hi = max(candles[j]['high'] for j in range(i - K_PERIOD + 1, i + 1))
        if hi == lo:
            raw_k[i] = 50.0
        else:
            raw_k[i] = (candles[i]['close'] - lo) / (hi - lo) * 100.0

    # %K = SMA(3) of raw_k
    K = sma_series(raw_k, SMOOTH)

    # %D = SMA(3) of K
    D = sma_series(K, D_PERIOD)

    return K, D


def get_last_stoch(candles):
    """Return (k, d) for the last valid stoch values, or (None, None)."""
    if len(candles) < MIN_CANDLES:
        return None, None
    K, D = calc_stoch(candles)
    k = next((v for v in reversed(K) if v is not None), None)
    d = next((v for v in reversed(D) if v is not None), None)
    return k, d


print("[step-3] Computing Stoch(5,3,3) on 1H and 5M candles ...")

stoch_1h_K, stoch_1h_D = calc_stoch(candles_1h)
stoch_5m_K, stoch_5m_D = calc_stoch(candles_5m)

# Build epoch → stoch index maps for fast lookup
def build_epoch_index(candles):
    return {c['epoch']: idx for idx, c in enumerate(candles)}

idx_1h = build_epoch_index(candles_1h)
idx_5m = build_epoch_index(candles_5m)


def get_stoch_at_epoch(target_epoch, candles, K_arr, D_arr):
    """
    Return (k, d) for the candle whose epoch is closest to and <= target_epoch.
    Falls back to the last valid value up to that candle.
    """
    best_idx = None
    for i, c in enumerate(candles):
        if c['epoch'] <= target_epoch:
            best_idx = i
        else:
            break
    if best_idx is None:
        return None, None
    # Walk backwards from best_idx to find last non-None K and D
    k = next((K_arr[j] for j in range(best_idx, -1, -1) if K_arr[j] is not None), None)
    d = next((D_arr[j] for j in range(best_idx, -1, -1) if D_arr[j] is not None), None)
    return k, d

# ---------------------------------------------------------------------------
# Step 4 — Spike detection on raw ticks
# ---------------------------------------------------------------------------
print("[step-4] Detecting spikes ...")

SPIKE_WINDOW = 20
SPIKE_MULT   = 3.0

# Precompute price changes
price_changes = [0.0] * n_ticks
for i in range(1, n_ticks):
    price_changes[i] = abs(prices[i] - prices[i - 1])

is_spike = [False] * n_ticks
for i in range(SPIKE_WINDOW, n_ticks):
    window = price_changes[i - SPIKE_WINDOW : i]
    try:
        std = statistics.stdev(window)
    except statistics.StatisticsError:
        std = 0.0
    threshold = SPIKE_MULT * std
    is_spike[i] = price_changes[i] > threshold if threshold > 0 else False

spike_indices = [i for i, s in enumerate(is_spike) if s]
print(f"[step-4] Found {len(spike_indices)} spikes in {n_ticks} ticks")

# ---------------------------------------------------------------------------
# Step 5 — Feature extraction
# ---------------------------------------------------------------------------
print("[step-5] Extracting features ...")

LOOK_BACK_START = 300
LOOK_AHEAD      = 50
STEP            = 5

rows = []

def safe_std(values):
    if len(values) < 2:
        return 0.0
    try:
        return statistics.stdev(values)
    except statistics.StatisticsError:
        return 0.0


def safe_mean(values):
    if not values:
        return 0.0
    return sum(values) / len(values)


for tick_i in range(LOOK_BACK_START, n_ticks - LOOK_AHEAD, STEP):
    epoch_i = epochs[tick_i]

    # --- Stoch 1H at this tick's epoch ---
    k_1h, d_1h = get_stoch_at_epoch(epoch_i, candles_1h, stoch_1h_K, stoch_1h_D)
    if k_1h is None or d_1h is None:
        continue

    # --- Stoch 5M at this tick's epoch ---
    k_5m, d_5m = get_stoch_at_epoch(epoch_i, candles_5m, stoch_5m_K, stoch_5m_D)
    if k_5m is None or d_5m is None:
        continue

    # stoch_1m_k / stoch_1m_d — placeholder 50 (no 1M candles in this ETL)
    k_1m = 50.0
    d_1m = 50.0

    # --- Ticks since last spike ---
    prev_spikes = [idx for idx in spike_indices if idx < tick_i]
    if prev_spikes:
        ticks_since_last_spike = tick_i - prev_spikes[-1]
    else:
        ticks_since_last_spike = tick_i  # never spiked before

    # --- Drift velocity (price change over last N ticks) ---
    drift_velocity_10t = 0.0
    drift_velocity_50t = 0.0
    if tick_i >= 10:
        drift_velocity_10t = prices[tick_i] - prices[tick_i - 10]
    if tick_i >= 50:
        drift_velocity_50t = prices[tick_i] - prices[tick_i - 50]

    # --- Drift acceleration ---
    drift_acceleration = 0.0
    if tick_i >= 20:
        vel_now  = prices[tick_i]     - prices[tick_i - 10]
        vel_prev = prices[tick_i - 10] - prices[tick_i - 20]
        drift_acceleration = vel_now - vel_prev

    # --- Volatility ---
    vol_30_changes  = price_changes[max(0, tick_i - 30)  : tick_i]
    vol_300_changes = price_changes[max(0, tick_i - 300) : tick_i]
    volatility_30t  = safe_std(vol_30_changes)
    volatility_300t = safe_std(vol_300_changes)
    if volatility_300t > 0:
        volatility_ratio = volatility_30t / volatility_300t
    else:
        volatility_ratio = 1.0

    # --- Spike magnitude features ---
    recent_spikes = [idx for idx in spike_indices if idx < tick_i][-5:]  # last 5 spikes

    if recent_spikes:
        spike_magnitude_last = price_changes[recent_spikes[-1]]
    else:
        spike_magnitude_last = 0.0

    if len(recent_spikes) >= 3:
        spike_magnitude_avg_3 = safe_mean([price_changes[idx] for idx in recent_spikes[-3:]])
    else:
        spike_magnitude_avg_3 = spike_magnitude_last

    # Inter-spike interval stats (gaps between consecutive spikes)
    if len(recent_spikes) >= 2:
        gaps = [recent_spikes[j] - recent_spikes[j - 1] for j in range(1, len(recent_spikes))]
        inter_spike_avg = safe_mean(gaps)
        inter_spike_std = safe_std(gaps)
    else:
        inter_spike_avg = float(ticks_since_last_spike)
        inter_spike_std = 0.0

    # --- Temporal features ---
    # epoch_i is in seconds since Unix epoch
    import datetime
    dt = datetime.datetime.utcfromtimestamp(epoch_i)
    hour_of_day  = dt.hour
    day_of_week  = dt.weekday()  # 0=Mon

    # --- Label: spike in next LOOK_AHEAD ticks ---
    future_spikes = [idx for idx in spike_indices if tick_i < idx <= tick_i + LOOK_AHEAD]
    label = 1 if future_spikes else 0

    rows.append([
        label,
        round(k_1h,  6),
        round(d_1h,  6),
        round(k_5m,  6),
        round(d_5m,  6),
        round(k_1m,  6),
        round(d_1m,  6),
        ticks_since_last_spike,
        round(drift_velocity_10t,  8),
        round(drift_velocity_50t,  8),
        round(drift_acceleration,  8),
        round(volatility_30t,      8),
        round(volatility_300t,     8),
        round(volatility_ratio,    8),
        round(spike_magnitude_last,  8),
        round(spike_magnitude_avg_3, 8),
        round(inter_spike_avg,       4),
        round(inter_spike_std,       4),
        hour_of_day,
        day_of_week,
    ])

n_rows = len(rows)
print(f"[step-5] Generated {n_rows} feature rows")

# ---------------------------------------------------------------------------
# Step 6 — Minimum row check
# ---------------------------------------------------------------------------
if n_rows < 1000:
    print(f"[WARN] Only {n_rows} rows generated (minimum 1000 required). "
          "Increase tick data or lower LOOK_BACK_START. Exiting without writing.")
    sys.exit(0)

# ---------------------------------------------------------------------------
# Step 7 — Write CSV to S3 (no header, label first column)
# ---------------------------------------------------------------------------
out_key = f"processed/{SYMBOL}/features.csv"

buf = io.StringIO()
for row in rows:
    buf.write(','.join(str(v) for v in row) + '\n')

csv_text = buf.getvalue()

print(f"[step-7] Writing {n_rows} rows to s3://{BUCKET}/{out_key} ...")
write_s3_text(out_key, csv_text)

print(f"[step-7] Done. {n_rows} rows written to s3://{BUCKET}/{out_key}")
