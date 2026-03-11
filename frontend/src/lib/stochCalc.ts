// Re-export shared stoch calculator for use in frontend
export {
  sma,
  calculateEMA,
  calculateStochastic,
  detectCross,
  getStochZone,
  getEMATrend,
  getTrend,
  validateSignal,
} from '../shared/stochCalc'

export type { SignalCheck } from '../shared/stochCalc'
