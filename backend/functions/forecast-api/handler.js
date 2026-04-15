'use strict';
/**
 * SYNTRA 2.0 — forecast-api (FASE 4)
 * Proyección capital usando Amazon Forecast.
 * TODO: Implementar en Fase 4
 */
exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ forecast: [], message: 'Forecast disponible en Fase 4' }),
  };
};
