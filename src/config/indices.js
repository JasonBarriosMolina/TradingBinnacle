'use strict';

const INDEX_CONFIG = {
  "CRASH300N": {
    type: "crash", direction: "SELL",
    require_1m: false, use_k_and_d: true,
    stoch_entry: { k: 80, d: 80 },
    sl_points: 14, tp_points: 28,
    ml_model: "crash-300-model",
    min_trades_train: 200,
    deriv_symbol: "CRASH300N",
    display_name: "Crash 300"
  },
  "CRASH500N": {
    type: "crash", direction: "SELL",
    require_1m: false, use_k_and_d: true,
    stoch_entry: { k: 80, d: 80 },
    sl_points: 14, tp_points: 28,
    ml_model: "crash-500-model",
    min_trades_train: 200,
    deriv_symbol: "CRASH500N",
    display_name: "Crash 500"
  },
  "CRASH600N": {
    type: "crash", direction: "SELL",
    require_1m: true, use_k_and_d: true,
    stoch_entry: { k: 80, d: 80 },
    sl_points: 14, tp_points: 28,
    ml_model: "crash-600-model",
    min_trades_train: 200,
    deriv_symbol: "CRASH600N",
    display_name: "Crash 600"
  },
  "CRASH900N": {
    type: "crash", direction: "SELL",
    require_1m: true, use_k_and_d: true,
    stoch_entry: { k: 80, d: 80 },
    sl_points: 14, tp_points: 28,
    ml_model: "crash-900-model",
    min_trades_train: 200,
    deriv_symbol: "CRASH900N",
    display_name: "Crash 900"
  },
  "CRASH1000N": {
    type: "crash", direction: "SELL",
    require_1m: false, use_k_and_d: true,
    stoch_entry: { k: 80, d: 80 },
    sl_points: 14, tp_points: 28,
    ml_model: "crash-1000-model",
    min_trades_train: 200,
    deriv_symbol: "CRASH1000N",
    display_name: "Crash 1000"
  },
  "BOOM300N": {
    type: "boom", direction: "BUY",
    require_1m: false, use_k_and_d: true,
    stoch_entry: { k: 20, d: 20 },
    sl_points: 14, tp_points: 28,
    ml_model: "boom-300-model",
    min_trades_train: 200,
    deriv_symbol: "BOOM300N",
    display_name: "Boom 300"
  },
  "BOOM500N": {
    type: "boom", direction: "BUY",
    require_1m: false, use_k_and_d: true,
    stoch_entry: { k: 20, d: 20 },
    sl_points: 14, tp_points: 28,
    ml_model: "boom-500-model",
    min_trades_train: 200,
    deriv_symbol: "BOOM500N",
    display_name: "Boom 500"
  },
  "BOOM600N": {
    type: "boom", direction: "BUY",
    require_1m: true, use_k_and_d: true,
    stoch_entry: { k: 20, d: 20 },
    sl_points: 14, tp_points: 28,
    ml_model: "boom-600-model",
    min_trades_train: 200,
    deriv_symbol: "BOOM600N",
    display_name: "Boom 600"
  },
  "BOOM900N": {
    type: "boom", direction: "BUY",
    require_1m: true, use_k_and_d: true,
    stoch_entry: { k: 20, d: 20 },
    sl_points: 14, tp_points: 28,
    ml_model: "boom-900-model",
    min_trades_train: 200,
    deriv_symbol: "BOOM900N",
    display_name: "Boom 900"
  },
  "BOOM1000N": {
    type: "boom", direction: "BUY",
    require_1m: false, use_k_and_d: true,
    stoch_entry: { k: 20, d: 20 },
    sl_points: 14, tp_points: 28,
    ml_model: "boom-1000-model",
    min_trades_train: 200,
    deriv_symbol: "BOOM1000N",
    display_name: "Boom 1000"
  }
};

const ALL_SYMBOLS     = Object.keys(INDEX_CONFIG);
const CRASH_SYMBOLS   = ALL_SYMBOLS.filter(s => INDEX_CONFIG[s].type === 'crash');
const BOOM_SYMBOLS    = ALL_SYMBOLS.filter(s => INDEX_CONFIG[s].type === 'boom');
const REQUIRE_1M      = ALL_SYMBOLS.filter(s => INDEX_CONFIG[s].require_1m);

module.exports = { INDEX_CONFIG, ALL_SYMBOLS, CRASH_SYMBOLS, BOOM_SYMBOLS, REQUIRE_1M };
