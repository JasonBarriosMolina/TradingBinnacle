'use strict';
/**
 * SYNTRA 2.0 — signal-worker (FASE 1)
 * Conecta Deriv WebSocket, calcula Stoch K y D en 1H+5M+1M,
 * evalúa condición según INDEX_CONFIG, dispara Step Functions.
 * TODO: Implementar en Fase 1
 */
exports.handler = async (event) => {
  console.log(JSON.stringify({ action: 'signal-worker-stub', event }));
  return { statusCode: 200, body: JSON.stringify({ status: 'stub — Fase 1 pendiente' }) };
};
