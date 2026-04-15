"""
SYNTRA 2.0 — XGBoost Training Script (Fase 3)
SageMaker Training Job — uno por índice (10 total)

Entrada:
  - s3://syntra-data/processed/{symbol}/features.csv
  - Columnas: stoch_1h_k, stoch_1h_d, stoch_1h_kd_diff, stoch_1h_d_slope,
              stoch_5m_k, stoch_5m_d, stoch_5m_kd_diff, stoch_5m_d_slope,
              stoch_1m_k, stoch_1m_d, stoch_1m_kd_diff, stoch_1m_d_slope,
              ticks_since_last_spike, drift_velocity_10t, drift_velocity_50t,
              drift_acceleration, volatility_30t, volatility_300t, volatility_ratio,
              spike_magnitude_last, spike_magnitude_avg_3, inter_spike_avg,
              inter_spike_std, hour_of_day, day_of_week,
              spike_in_next_50t (label), ticks_to_next_spike (label)

Salida:
  - /opt/ml/model/xgboost_model.json
  - Checkpointing en /opt/ml/checkpoints/ para Spot training

Uso:
  sagemaker.estimator.Estimator con esta imagen como script_mode
"""

import os
import json
import argparse
import logging
import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

FEATURE_COLS = [
    'stoch_1h_k', 'stoch_1h_d', 'stoch_1h_kd_diff', 'stoch_1h_d_slope',
    'stoch_5m_k', 'stoch_5m_d', 'stoch_5m_kd_diff', 'stoch_5m_d_slope',
    'stoch_1m_k', 'stoch_1m_d', 'stoch_1m_kd_diff', 'stoch_1m_d_slope',
    'ticks_since_last_spike', 'drift_velocity_10t', 'drift_velocity_50t',
    'drift_acceleration', 'volatility_30t', 'volatility_300t', 'volatility_ratio',
    'spike_magnitude_last', 'spike_magnitude_avg_3', 'inter_spike_avg',
    'inter_spike_std', 'hour_of_day', 'day_of_week',
]
LABEL_COL = 'spike_in_next_50t'


def load_checkpoint(checkpoint_dir: str):
    """Carga checkpoint para reanudar training en Spot instance."""
    checkpoint_path = os.path.join(checkpoint_dir, 'checkpoint.json')
    if os.path.exists(checkpoint_path):
        with open(checkpoint_path) as f:
            return json.load(f)
    return None


def save_checkpoint(checkpoint_dir: str, data: dict):
    """Guarda checkpoint para resumir si la Spot instance es terminada."""
    os.makedirs(checkpoint_dir, exist_ok=True)
    checkpoint_path = os.path.join(checkpoint_dir, 'checkpoint.json')
    with open(checkpoint_path, 'w') as f:
        json.dump(data, f)
    logger.info(f'Checkpoint saved to {checkpoint_path}')


def train(args):
    logger.info(f'Training for symbol: {args.symbol}')
    logger.info(f'Training data dir: {args.train}')

    # Cargar datos
    data_path = os.path.join(args.train, 'features.csv')
    df = pd.read_csv(data_path)
    logger.info(f'Loaded {len(df)} rows')

    # Limpiar NaNs
    df = df.dropna(subset=FEATURE_COLS + [LABEL_COL])
    logger.info(f'{len(df)} rows after dropping NaN')

    X = df[FEATURE_COLS].values
    y = df[LABEL_COL].astype(int).values

    # Split
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # Verificar checkpoint
    checkpoint = load_checkpoint(args.checkpoint_path)
    start_round = 0
    if checkpoint:
        start_round = checkpoint.get('n_estimators', 0)
        logger.info(f'Resuming from round {start_round}')

    # Scale positives (spikes son raros)
    pos_weight = (y_train == 0).sum() / max((y_train == 1).sum(), 1)
    logger.info(f'scale_pos_weight: {pos_weight:.2f}')

    model = xgb.XGBClassifier(
        n_estimators=args.n_estimators,
        max_depth=args.max_depth,
        learning_rate=args.learning_rate,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=pos_weight,
        use_label_encoder=False,
        eval_metric='auc',
        random_state=42,
        verbosity=1,
    )

    # Entrenar con eval set para early stopping
    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        early_stopping_rounds=20,
        verbose=50,
    )

    # Guardar checkpoint
    save_checkpoint(args.checkpoint_path, {
        'n_estimators': model.best_iteration,
        'symbol': args.symbol,
        'val_auc': float(roc_auc_score(y_val, model.predict_proba(X_val)[:, 1])),
    })

    # Métricas
    y_pred = model.predict(X_val)
    y_prob = model.predict_proba(X_val)[:, 1]
    auc = roc_auc_score(y_val, y_prob)
    logger.info(f'\nValidation AUC: {auc:.4f}')
    logger.info(f'\n{classification_report(y_val, y_pred, target_names=["no_spike","spike"])}')

    # Feature importance
    importances = dict(zip(FEATURE_COLS, model.feature_importances_))
    top_features = sorted(importances.items(), key=lambda x: x[1], reverse=True)[:10]
    logger.info(f'Top features: {top_features}')

    # Guardar modelo
    os.makedirs(args.model_dir, exist_ok=True)
    model_path = os.path.join(args.model_dir, 'xgboost_model.json')
    model.save_model(model_path)
    logger.info(f'Model saved to {model_path}')

    # Guardar metadata
    metadata = {
        'symbol': args.symbol,
        'val_auc': auc,
        'n_estimators': model.best_iteration,
        'feature_cols': FEATURE_COLS,
        'label_col': LABEL_COL,
        'top_features': top_features,
        'train_rows': len(X_train),
        'val_rows': len(X_val),
    }
    with open(os.path.join(args.model_dir, 'metadata.json'), 'w') as f:
        json.dump(metadata, f, indent=2)

    return auc


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--symbol',         type=str,   default='CRASH300N')
    parser.add_argument('--n-estimators',   type=int,   default=300)
    parser.add_argument('--max-depth',      type=int,   default=6)
    parser.add_argument('--learning-rate',  type=float, default=0.05)
    # SageMaker paths
    parser.add_argument('--train',          type=str, default=os.environ.get('SM_CHANNEL_TRAIN', '/opt/ml/input/data/train'))
    parser.add_argument('--model-dir',      type=str, default=os.environ.get('SM_MODEL_DIR', '/opt/ml/model'))
    parser.add_argument('--checkpoint-path',type=str, default=os.environ.get('SM_CHECKPOINT_DIR', '/opt/ml/checkpoints'))
    args = parser.parse_args()
    train(args)
