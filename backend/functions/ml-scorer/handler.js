'use strict';
/**
 * SYNTRA 2.0 — ml-scorer (FASE 2/3)
 * Invoca SageMaker endpoint del índice (55%) + Bedrock claude-sonnet-4-5 (25%)
 * + Historial personal (20%). Retorna score final 0-100.
 * TODO: Implementar en Fase 2 (Bedrock) y Fase 3 (SageMaker)
 */

/**
 * Fallback score mientras el modelo acumula 200 trades mínimos.
 * Basado solo en calidad del Stochastic.
 */
function calculateStochQualityScore(features) {
  let score = 50;
  if (features.stoch_1h_kd_diff !== null && Math.abs(features.stoch_1h_kd_diff) > 2) score += 15;
  if (features.stoch_5m_kd_diff !== null && Math.abs(features.stoch_5m_kd_diff) > 2) score += 15;
  if (features.stoch_1h_d_slope !== null && Math.abs(features.stoch_1h_d_slope) > 0.5) score += 10;
  if (features.ticks_since_last_spike !== null && features.ticks_since_last_spike > 200) score += 10;
  return Math.min(score, 100);
}

exports.handler = async (event) => {
  console.log(JSON.stringify({ action: 'ml-scorer', event }));
  const features = event.features || {};
  const score = calculateStochQualityScore(features);
  return {
    sagemaker_score: null,
    bedrock_score:   null,
    journal_score:   null,
    final_score:     score,
    fallback:        true,
    reason:          'Modelo no entrenado — usando Stoch quality score',
  };
};
