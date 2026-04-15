'use strict';
/**
 * SYNTRA 2.0 — feature-engine
 *
 * Calculates all 20+ ML features for a given signal event.
 * Stores snapshot in DynamoDB tick-snapshots (TTL 7 days).
 * Writes to Timestream for real-time queries.
 *
 * Input event:
 *   symbol, features (stoch features from Layer),
 *   candles (recent tick data), timestamp
 */

const { DynamoDBClient, PutItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { TimestreamWriteClient, WriteRecordsCommand } = require('@aws-sdk/client-timestream-write');

const dynamo = new DynamoDBClient({ region: 'us-east-1' });
const timestream = new TimestreamWriteClient({ region: 'us-east-1' });

const SNAPSHOTS_TABLE = process.env.DYNAMODB_TABLE_SNAPSHOTS || 'syntra-tick-snapshots';
const TIMESTREAM_DB    = process.env.TIMESTREAM_DB    || 'syntra-timestream';
const TIMESTREAM_TABLE = process.env.TIMESTREAM_TABLE || 'tick-data';
const TTL_7_DAYS       = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

/**
 * Queries DynamoDB tick-snapshots to calculate spike-related features
 * for a given symbol.
 *
 * @param {string} symbol
 * @returns {Promise<Object>} spike features
 */
async function calcSpikeFeatures(symbol) {
  // Query last 500 snapshots to find spikes and timing
  const result = await dynamo.send(new QueryCommand({
    TableName: SNAPSHOTS_TABLE,
    KeyConditionExpression: '#sym = :sym',
    ExpressionAttributeNames: { '#sym': 'symbol' },
    ExpressionAttributeValues: { ':sym': { S: symbol } },
    ScanIndexForward: false,
    Limit: 500,
  }));

  const snapshots = (result.Items || []).map(i => unmarshall(i));

  if (!snapshots.length) {
    return {
      ticks_since_last_spike:  null,
      drift_velocity_10t:      null,
      drift_velocity_50t:      null,
      drift_acceleration:      null,
      volatility_30t:          null,
      volatility_300t:         null,
      volatility_ratio:        null,
      spike_magnitude_last:    null,
      spike_magnitude_avg_3:   null,
      inter_spike_avg:         null,
      inter_spike_std:         null,
    };
  }

  // Extract prices (close prices from snapshots, sorted by epoch desc)
  const prices = snapshots.map(s => s.price).filter(p => p != null);

  // Spike detection: a spike is a price move > 3 std devs in single tick
  const spikes = [];
  for (let i = 1; i < prices.length; i++) {
    const move = Math.abs(prices[i - 1] - prices[i]);
    const recentPrices = prices.slice(Math.max(0, i - 20), i);
    if (recentPrices.length < 5) continue;
    const avg = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const variance = recentPrices.reduce((s, v) => s + (v - avg) ** 2, 0) / recentPrices.length;
    const std = Math.sqrt(variance);
    if (std > 0 && move > std * 3) {
      spikes.push({ idx: i, magnitude: move });
    }
  }

  const ticks_since_last_spike = spikes.length > 0 ? spikes[0].idx : prices.length;

  // Drift velocities (desc order, so idx 0 is newest)
  const v10 = prices.length >= 10
    ? (prices[0] - prices[9]) / 10
    : null;
  const v50 = prices.length >= 50
    ? (prices[0] - prices[49]) / 50
    : null;
  const drift_acceleration = (v10 != null && v50 != null)
    ? v10 - v50
    : null;

  // Volatility (std dev of returns)
  function calcVolatility(priceArr, n) {
    if (priceArr.length < n + 1) return null;
    const slice = priceArr.slice(0, n + 1);
    const returns = [];
    for (let i = 0; i < n; i++) {
      if (slice[i] != null && slice[i + 1] != null) {
        returns.push(slice[i] - slice[i + 1]);
      }
    }
    if (!returns.length) return null;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  }

  const volatility_30t  = calcVolatility(prices, 30);
  const volatility_300t = calcVolatility(prices, 300);
  const volatility_ratio = (volatility_30t != null && volatility_300t != null && volatility_300t > 0)
    ? volatility_30t / volatility_300t
    : null;

  // Spike magnitudes
  const spike_magnitude_last  = spikes.length > 0 ? spikes[0].magnitude : null;
  const recentSpikes = spikes.slice(0, 3).map(s => s.magnitude);
  const spike_magnitude_avg_3 = recentSpikes.length > 0
    ? recentSpikes.reduce((a, b) => a + b, 0) / recentSpikes.length
    : null;

  // Inter-spike intervals
  const intervals = [];
  for (let i = 1; i < spikes.length; i++) {
    intervals.push(spikes[i - 1].idx - spikes[i].idx);
  }
  const inter_spike_avg = intervals.length > 0
    ? intervals.reduce((a, b) => a + b, 0) / intervals.length
    : null;
  const inter_spike_std = intervals.length > 1
    ? Math.sqrt(intervals.reduce((s, v) => s + (v - inter_spike_avg) ** 2, 0) / intervals.length)
    : null;

  return {
    ticks_since_last_spike,
    drift_velocity_10t:   v10   != null ? Math.round(v10   * 10000) / 10000 : null,
    drift_velocity_50t:   v50   != null ? Math.round(v50   * 10000) / 10000 : null,
    drift_acceleration:   drift_acceleration != null ? Math.round(drift_acceleration * 10000) / 10000 : null,
    volatility_30t:       volatility_30t  != null ? Math.round(volatility_30t  * 10000) / 10000 : null,
    volatility_300t:      volatility_300t != null ? Math.round(volatility_300t * 10000) / 10000 : null,
    volatility_ratio:     volatility_ratio != null ? Math.round(volatility_ratio * 1000) / 1000 : null,
    spike_magnitude_last: spike_magnitude_last  != null ? Math.round(spike_magnitude_last  * 10000) / 10000 : null,
    spike_magnitude_avg_3: spike_magnitude_avg_3 != null ? Math.round(spike_magnitude_avg_3 * 10000) / 10000 : null,
    inter_spike_avg:      inter_spike_avg != null ? Math.round(inter_spike_avg) : null,
    inter_spike_std:      inter_spike_std != null ? Math.round(inter_spike_std * 100) / 100 : null,
  };
}

/**
 * Builds time-context features.
 * @param {string} isoTimestamp
 */
function calcTimeFeatures(isoTimestamp) {
  const d = new Date(isoTimestamp);
  return {
    hour_of_day:  d.getUTCHours(),
    day_of_week:  d.getUTCDay(),
  };
}

/**
 * Stores the full feature snapshot in DynamoDB tick-snapshots (TTL 7d).
 */
async function saveSnapshot(symbol, epoch, features, price) {
  const item = {
    symbol,
    epoch: String(epoch),
    price,
    ...features,
    ttl: TTL_7_DAYS,
    created_at: new Date().toISOString(),
  };

  await dynamo.send(new PutItemCommand({
    TableName: SNAPSHOTS_TABLE,
    Item: marshall(item, { removeUndefinedValues: true }),
  }));
}

/**
 * Writes feature record to Timestream for real-time dashboards.
 */
async function writeTimestream(symbol, epoch, features) {
  const time = String(epoch * 1000);  // ms

  const dimensions = [
    { Name: 'symbol', Value: symbol },
  ];

  // Only write numeric non-null features
  const records = Object.entries(features)
    .filter(([, v]) => typeof v === 'number' && v !== null)
    .map(([name, value]) => ({
      Dimensions: dimensions,
      MeasureName: name,
      MeasureValue: String(value),
      MeasureValueType: 'DOUBLE',
      Time: time,
      TimeUnit: 'MILLISECONDS',
    }));

  if (!records.length) return;

  try {
    await timestream.send(new WriteRecordsCommand({
      DatabaseName: TIMESTREAM_DB,
      TableName: TIMESTREAM_TABLE,
      Records: records,
    }));
  } catch (e) {
    // Timestream write is best-effort — don't fail the signal pipeline
    console.log(JSON.stringify({ action: 'timestreamWriteWarn', symbol, error: e.message }));
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const {
    symbol,
    timestamp,
    entrada,        // current price
    features: stochFeatures = {},
  } = event;

  if (!symbol) {
    console.log(JSON.stringify({ action: 'feature-engine-error', error: 'symbol required' }));
    return { error: 'symbol required' };
  }

  console.log(JSON.stringify({ action: 'feature-engine-start', symbol, timestamp }));

  const epoch = Math.floor(new Date(timestamp || Date.now()).getTime() / 1000);

  // Fetch spike-related features from historical snapshots
  const spikeFeatures = await calcSpikeFeatures(symbol);

  // Time context features
  const timeFeatures = calcTimeFeatures(timestamp || new Date().toISOString());

  // Combine all features
  const allFeatures = {
    ...stochFeatures,
    ...spikeFeatures,
    ...timeFeatures,
  };

  // Persist snapshot
  try {
    await saveSnapshot(symbol, epoch, allFeatures, entrada);
  } catch (e) {
    console.log(JSON.stringify({ action: 'snapshotSaveWarn', symbol, error: e.message }));
  }

  // Write to Timestream (best-effort)
  await writeTimestream(symbol, epoch, allFeatures);

  console.log(JSON.stringify({
    action: 'feature-engine-done',
    symbol,
    featureCount: Object.keys(allFeatures).length,
    ticks_since_last_spike: allFeatures.ticks_since_last_spike,
  }));

  return { symbol, features: allFeatures, epoch };
};
