'use strict';
/**
 * SYNTRA 2.0 — copilot-api (FASE 2)
 * Chat con Bedrock claude-sonnet-4-5. Contexto: últimos 100 trades + stats.
 * TODO: Implementar en Fase 2
 */
exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ reply: 'Copiloto IA disponible en Fase 2. ¡Pronto!' }),
  };
};
