"""
SYNTRA 2.0 — Glue ETL Job (Fase 3)
Procesa ticks raw de S3 y construye feature matrix para SageMaker.

Input:  s3://syntra-data/{stage}/raw/{symbol}/{date}/ticks_*.json
Output: s3://syntra-data/{stage}/processed/{symbol}/features.csv

Ejecutado cada domingo antes del retraining-job.
Un job por índice (10 jobs total), pasando el símbolo como argumento.

Features calculados:
  - Stoch K y D en 1H, 5M, 1M (simulados desde ticks)
  - Spike labels: spike_in_next_50t, spike_in_next_100t, ticks_to_next_spike
  - Comportamiento del índice: drift, volatilidad, inter-spike
  - Contexto temporal: hour_of_day, day_of_week
"""

import sys
import json
import boto3
import numpy as np
import pandas as pd
from datetime import datetime, timezone
from awsglue.utils import getResolvedOptions
from awsglue.context import GlueContext
from pyspark.context import SparkContext

args = getResolvedOptions(sys.argv, ['symbol', 'stage', 'bucket_data'])
SYMBOL = args['symbol']
STAGE  = args.get('stage', 'dev')
BUCKET = args['bucket_data']

sc = SparkContext()
glueContext = GlueContext(sc)
logger = glueContext.get_logger()


def detect_spikes(quotes: np.ndarray, symbol: str) -> np.ndarray:
    """
    Detecta spikes en la serie de precios.
    Crash: caída brusca (un tick negativo grande)
    Boom:  subida brusca (un tick positivo grande)
    Usa Z-score > 3 sobre los retornos tick-a-tick.
    """
    returns = np.diff(quotes, prepend=quotes[0])
    mean_ret = np.mean(returns)
    std_ret  = np.std(returns)
    if std_ret == 0:
        return np.zeros(len(quotes), dtype=bool)

    z_scores = (returns - mean_ret) / std_ret
    threshold = 3.0

    if 'CRASH' in symbol:
        # Spikes de crash: caídas bruscas (z < -threshold)
        return z_scores < -threshold
    else:
        # Spikes de boom: subidas bruscas (z > threshold)
        return z_scores > threshold


def build_candles(ticks: pd.DataFrame, timeframe_minutes: int) -> pd.DataFrame:
    """
    Agrupa ticks en velas OHLC para el timeframe dado.
    """
    ticks = ticks.copy()
    ticks['dt'] = pd.to_datetime(ticks['epoch'], unit='s', utc=True)
    ticks.set_index('dt', inplace=True)
    rule = f'{timeframe_minutes}T'
    candles = ticks['quote'].resample(rule).ohlc()
    candles.columns = ['open', 'high', 'low', 'close']
    candles = candles.dropna()
    return candles


def calc_stoch_series(candles: pd.DataFrame, k=5, smooth=3, d=3) -> pd.DataFrame:
    """
    Calcula Stochastic (5,3,3) como series temporales.
    """
    lo = candles['low'].rolling(k).min()
    hi = candles['high'].rolling(k).max()
    raw_k = ((candles['close'] - lo) / (hi - lo) * 100).fillna(50)
    smooth_k = raw_k.rolling(smooth).mean()
    d_line   = smooth_k.rolling(d).mean()
    result = pd.DataFrame({
        'K': smooth_k,
        'D': d_line,
        'KD_diff': smooth_k - d_line,
        'D_slope': d_line.diff(3) / 3,
    }, index=candles.index)
    return result


def main():
    logger.info(f'Starting ETL for symbol: {SYMBOL}')
    s3 = boto3.client('s3')

    # Listar archivos raw del símbolo
    prefix   = f'raw/{SYMBOL}/'
    response = s3.list_objects_v2(Bucket=BUCKET, Prefix=prefix)
    objects  = response.get('Contents', [])
    logger.info(f'Found {len(objects)} raw files for {SYMBOL}')

    if not objects:
        logger.warn(f'No raw data found for {SYMBOL}. Exiting.')
        return

    # Cargar todos los ticks
    all_ticks = []
    for obj in objects:
        body = s3.get_object(Bucket=BUCKET, Key=obj['Key'])['Body'].read()
        data = json.loads(body)
        all_ticks.extend(data.get('ticks', []))

    df_ticks = pd.DataFrame(all_ticks).drop_duplicates('epoch').sort_values('epoch')
    logger.info(f'Total ticks loaded: {len(df_ticks)}')

    # Detectar spikes
    quotes = df_ticks['quote'].values
    spikes = detect_spikes(quotes, SYMBOL)
    df_ticks['is_spike'] = spikes
    spike_indices = np.where(spikes)[0]
    logger.info(f'Spikes detected: {len(spike_indices)}')

    # Labels por tick: ticks hasta el próximo spike
    ticks_to_next = np.full(len(df_ticks), 9999, dtype=int)
    for i in range(len(df_ticks)):
        future_spikes = spike_indices[spike_indices > i]
        if len(future_spikes) > 0:
            ticks_to_next[i] = future_spikes[0] - i

    df_ticks['ticks_to_next_spike'] = ticks_to_next
    df_ticks['spike_in_next_50t']   = (ticks_to_next <= 50).astype(int)
    df_ticks['spike_in_next_100t']  = (ticks_to_next <= 100).astype(int)

    # Ticks desde el último spike
    ticks_since = np.zeros(len(df_ticks), dtype=int)
    last_spike  = -9999
    for i in range(len(df_ticks)):
        if spikes[i]:
            last_spike = i
        ticks_since[i] = i - last_spike
    df_ticks['ticks_since_last_spike'] = ticks_since

    # Construir velas para Stoch en cada timeframe
    candles_1h = build_candles(df_ticks, 60)
    candles_5m = build_candles(df_ticks, 5)
    candles_1m = build_candles(df_ticks, 1)

    stoch_1h = calc_stoch_series(candles_1h).add_prefix('stoch_1h_')
    stoch_5m = calc_stoch_series(candles_5m).add_prefix('stoch_5m_')
    stoch_1m = calc_stoch_series(candles_1m).add_prefix('stoch_1m_')

    # Renombrar columnas
    stoch_1h.columns = ['stoch_1h_k','stoch_1h_d','stoch_1h_kd_diff','stoch_1h_d_slope']
    stoch_5m.columns = ['stoch_5m_k','stoch_5m_d','stoch_5m_kd_diff','stoch_5m_d_slope']
    stoch_1m.columns = ['stoch_1m_k','stoch_1m_d','stoch_1m_kd_diff','stoch_1m_d_slope']

    # Drift y volatilidad
    df_ticks['drift_velocity_10t']  = df_ticks['quote'].diff(10) / 10
    df_ticks['drift_velocity_50t']  = df_ticks['quote'].diff(50) / 50
    df_ticks['drift_acceleration']  = df_ticks['drift_velocity_10t'].diff(10)
    df_ticks['volatility_30t']      = df_ticks['quote'].rolling(30).std()
    df_ticks['volatility_300t']     = df_ticks['quote'].rolling(300).std()
    df_ticks['volatility_ratio']    = df_ticks['volatility_30t'] / df_ticks['volatility_300t'].replace(0, np.nan)

    # Spike magnitude
    df_ticks['returns']             = df_ticks['quote'].diff().abs()
    spike_mask = df_ticks['is_spike']
    df_ticks['spike_magnitude']     = df_ticks['returns'].where(spike_mask, 0)
    df_ticks['spike_magnitude_last'] = df_ticks['spike_magnitude'].replace(0, np.nan).ffill()
    df_ticks['spike_magnitude_avg_3'] = (
        df_ticks['spike_magnitude'].replace(0, np.nan)
        .rolling(window=1000, min_periods=1)
        .apply(lambda x: x[x > 0][-3:].mean() if (x > 0).any() else 0)
    )

    # Inter-spike
    spike_epochs = df_ticks.loc[spike_mask, 'epoch'].values
    inter_spike  = np.diff(spike_epochs) if len(spike_epochs) > 1 else np.array([0])
    df_ticks['inter_spike_avg'] = np.mean(inter_spike) if len(inter_spike) else 0
    df_ticks['inter_spike_std'] = np.std(inter_spike) if len(inter_spike) else 0

    # Contexto temporal
    df_ticks['dt']          = pd.to_datetime(df_ticks['epoch'], unit='s', utc=True)
    df_ticks['hour_of_day'] = df_ticks['dt'].dt.hour
    df_ticks['day_of_week'] = df_ticks['dt'].dt.dayofweek

    # Reindex stoch al nivel de tick (forward fill desde velas)
    df_ticks = df_ticks.set_index('dt')
    for stoch_df in [stoch_1h, stoch_5m, stoch_1m]:
        df_ticks = df_ticks.join(stoch_df, how='left')
    df_ticks = df_ticks.ffill().reset_index()

    # Columnas finales
    feature_cols = [
        'epoch', 'quote',
        'stoch_1h_k','stoch_1h_d','stoch_1h_kd_diff','stoch_1h_d_slope',
        'stoch_5m_k','stoch_5m_d','stoch_5m_kd_diff','stoch_5m_d_slope',
        'stoch_1m_k','stoch_1m_d','stoch_1m_kd_diff','stoch_1m_d_slope',
        'ticks_since_last_spike','drift_velocity_10t','drift_velocity_50t',
        'drift_acceleration','volatility_30t','volatility_300t','volatility_ratio',
        'spike_magnitude_last','spike_magnitude_avg_3','inter_spike_avg','inter_spike_std',
        'hour_of_day','day_of_week',
        'spike_in_next_50t','spike_in_next_100t','ticks_to_next_spike',
    ]
    df_out = df_ticks[[c for c in feature_cols if c in df_ticks.columns]].dropna()
    logger.info(f'Feature matrix: {df_out.shape}')

    # Guardar en S3
    csv_buffer = df_out.to_csv(index=False)
    out_key = f'processed/{SYMBOL}/features.csv'
    s3.put_object(Bucket=BUCKET, Key=out_key, Body=csv_buffer.encode(), ContentType='text/csv')
    logger.info(f'Saved feature matrix to s3://{BUCKET}/{out_key}')


if __name__ == '__main__':
    main()
