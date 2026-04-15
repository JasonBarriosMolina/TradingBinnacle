'use strict';
/**
 * SYNTRA 2.0 — weekly-report (FASE 2)
 * EventBridge domingo → Bedrock genera reporte → Telegram a cada usuario pro/elite.
 * TODO: Implementar en Fase 2
 */
exports.handler = async (event) => {
  console.log(JSON.stringify({ action: 'weekly-report-stub', event }));
  return { statusCode: 200, body: JSON.stringify({ status: 'stub — Fase 2 pendiente' }) };
};
