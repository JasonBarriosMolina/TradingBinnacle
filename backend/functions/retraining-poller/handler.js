'use strict';
/**
 * SYNTRA 2.0 — retraining-poller (FASE 3)
 * EventBridge cada 2 horas → avanza el pipeline de retraining.
 *
 * Máquina de estados por símbolo (guardada en syntra-ml-status):
 *   glue_running  → polling Glue → si SUCCEEDED: lanza SageMaker → training
 *   training      → polling SageMaker → si Completed: despliega endpoint → deployed
 *   deployed      → idle
 *   error         → idle (requiere intervención manual)
 *
 * Cada ejecución del poller avanza TODOS los símbolos pendientes.
 * Lambda timeout: 5 min — más que suficiente para solo hacer API calls.
 */

const {
  GlueClient,
  GetJobRunCommand,
} = require('@aws-sdk/client-glue');
const {
  SageMakerClient,
  CreateTrainingJobCommand,
  DescribeTrainingJobCommand,
  CreateModelCommand,
  CreateEndpointConfigCommand,
  CreateEndpointCommand,
  UpdateEndpointCommand,
  DescribeEndpointCommand,
} = require('@aws-sdk/client-sagemaker');
const {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
} = require('@aws-sdk/client-dynamodb');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const glue      = new GlueClient({ region: 'us-east-1' });
const sagemaker = new SageMakerClient({ region: 'us-east-1' });
const dynamo    = new DynamoDBClient({ region: 'us-east-1' });
const s3        = new S3Client({ region: 'us-east-1' });

const ML_TABLE      = process.env.DYNAMODB_TABLE_ML_STATUS || 'syntra-ml-status';
const DATA_BUCKET   = process.env.SAGEMAKER_BUCKET         || 'syntra-data-prod';
const SM_ROLE       = process.env.SAGEMAKER_ROLE_ARN;
const GLUE_JOB_NAME = process.env.GLUE_JOB_NAME           || 'syntra-tick-etl-prod';
const TELEGRAM_BOT  = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID;

const XGBOOST_IMAGE = '683313688378.dkr.ecr.us-east-1.amazonaws.com/sagemaker-xgboost:1.7-1';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function notifyAdmin(msg) {
  if (!ADMIN_CHAT_ID || !TELEGRAM_BOT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: 'HTML' }),
    });
  } catch { /* non-critical */ }
}

async function saveMLStatus(symbol, data) {
  await dynamo.send(new PutItemCommand({
    TableName: ML_TABLE,
    Item: {
      symbol:     { S: symbol },
      updated_at: { S: new Date().toISOString() },
      status:     { S: data.status },
      ...(data.glue_run_id    && { glue_run_id:   { S: data.glue_run_id } }),
      ...(data.training_job   && { training_job:  { S: data.training_job } }),
      ...(data.endpoint_name  && { endpoint_name: { S: data.endpoint_name } }),
      ...(data.error          && { last_error:     { S: data.error } }),
    },
  }));
}

function endpointName(symbol) {
  return `syntra-${symbol.toLowerCase().replace(/n$/, '')}-endpoint`;
}

// ── Phase: Glue polling ───────────────────────────────────────────────────────

async function checkGlueJob(rec) {
  const { symbol, glue_run_id } = rec;

  try {
    const resp = await glue.send(new GetJobRunCommand({
      JobName: GLUE_JOB_NAME,
      RunId: glue_run_id,
    }));
    const state = resp.JobRun.JobRunState;
    console.log(JSON.stringify({ action: 'glue-poll', symbol, state }));

    if (state === 'SUCCEEDED') {
      // Verify S3 data exists before starting training
      try {
        await s3.send(new HeadObjectCommand({
          Bucket: DATA_BUCKET,
          Key: `processed/${symbol}/features.csv`,
        }));
      } catch {
        throw new Error(`features.csv not found in S3 after Glue success`);
      }

      // Start SageMaker training
      const jobName = await startTrainingJob(symbol);
      await saveMLStatus(symbol, {
        status: 'training',
        glue_run_id,
        training_job: jobName,
      });
      console.log(JSON.stringify({ action: 'sm-training-started', symbol, jobName }));

    } else if (['FAILED', 'ERROR', 'TIMEOUT', 'STOPPED'].includes(state)) {
      throw new Error(`Glue job ${state}: ${resp.JobRun.ErrorMessage || ''}`);
    }
    // RUNNING / STARTING → no-op, wait for next poll

  } catch (err) {
    await saveMLStatus(symbol, { status: 'error', glue_run_id, error: err.message });
    await notifyAdmin(`❌ <b>${symbol}</b> — Glue ETL falló\n${err.message}`);
  }
}

// ── Phase: SageMaker training ─────────────────────────────────────────────────

async function startTrainingJob(symbol) {
  const jobName  = `syntra-${symbol.toLowerCase().replace(/n$/, '')}-${Date.now()}`;
  const s3Input  = `s3://${DATA_BUCKET}/processed/${symbol}/`;
  const s3Output = `s3://${DATA_BUCKET}/models/${symbol}/`;
  const s3Ckpt   = `s3://${DATA_BUCKET}/checkpoints/${symbol}/`;
  const indexType = symbol.includes('CRASH') ? 'crash' : 'boom';

  await sagemaker.send(new CreateTrainingJobCommand({
    TrainingJobName: jobName,
    RoleArn: SM_ROLE,
    AlgorithmSpecification: {
      TrainingImage: XGBOOST_IMAGE,
      TrainingInputMode: 'File',
    },
    InputDataConfig: [{
      ChannelName: 'train',
      DataSource: {
        S3DataSource: {
          S3DataType: 'S3Prefix',
          S3Uri: s3Input,
          S3DataDistributionType: 'FullyReplicated',
        },
      },
      ContentType: 'text/csv',
    }],
    OutputDataConfig: { S3OutputPath: s3Output },
    CheckpointConfig: { S3Uri: s3Ckpt, LocalPath: '/opt/ml/checkpoints' },
    ResourceConfig: { InstanceType: 'ml.m5.large', InstanceCount: 1, VolumeSizeInGB: 10 },
    EnableManagedSpotTraining: true,
    StoppingCondition: { MaxRuntimeInSeconds: 3600, MaxWaitTimeInSeconds: 7200 },
    HyperParameters: {
      objective:             'binary:logistic',
      num_round:             '200',
      max_depth:             '6',
      eta:                   '0.05',
      subsample:             '0.8',
      colsample_bytree:      '0.8',
      min_child_weight:      '5',
      scale_pos_weight:      '10',   // ~10:1 neg:pos typical for these signals; ETL logs exact ratio
      eval_metric:           'auc',
      early_stopping_rounds: '20',
    },
  }));

  return jobName;
}

async function checkTrainingJob(rec) {
  const { symbol, training_job, glue_run_id } = rec;

  try {
    const resp = await sagemaker.send(new DescribeTrainingJobCommand({
      TrainingJobName: training_job,
    }));
    const status = resp.TrainingJobStatus;
    console.log(JSON.stringify({ action: 'sm-train-poll', symbol, status }));

    if (status === 'Completed') {
      const modelArtifact = resp.ModelArtifacts?.S3ModelArtifacts;
      const epName = await deployEndpoint(symbol, modelArtifact);
      await saveMLStatus(symbol, {
        status:        'deployed',
        glue_run_id,
        training_job,
        endpoint_name: epName,
      });
      await notifyAdmin(`✅ <b>${symbol}</b> — modelo desplegado\nEndpoint: <code>${epName}</code>`);

    } else if (['Failed', 'Stopped'].includes(status)) {
      throw new Error(`Training ${status}: ${resp.FailureReason || ''}`);
    }
    // InProgress → no-op

  } catch (err) {
    await saveMLStatus(symbol, { status: 'error', training_job, glue_run_id, error: err.message });
    await notifyAdmin(`❌ <b>${symbol}</b> — SageMaker training falló\n${err.message}`);
  }
}

// ── Phase: Deploy endpoint ────────────────────────────────────────────────────

async function deployEndpoint(symbol, modelArtifactPath) {
  const ts         = Date.now();
  const modelName  = `syntra-${symbol.toLowerCase().replace(/n$/, '')}-model-${ts}`;
  const configName = `syntra-${symbol.toLowerCase().replace(/n$/, '')}-config-${ts}`;
  const epName     = endpointName(symbol);

  await sagemaker.send(new CreateModelCommand({
    ModelName: modelName,
    PrimaryContainer: { Image: XGBOOST_IMAGE, ModelDataUrl: modelArtifactPath },
    ExecutionRoleArn: SM_ROLE,
  }));

  await sagemaker.send(new CreateEndpointConfigCommand({
    EndpointConfigName: configName,
    ProductionVariants: [{
      VariantName: 'AllTraffic',
      ModelName: modelName,
      ServerlessConfig: { MemorySizeInMB: 2048, MaxConcurrency: 5 },
    }],
  }));

  let exists = false;
  try {
    await sagemaker.send(new DescribeEndpointCommand({ EndpointName: epName }));
    exists = true;
  } catch { /* doesn't exist yet */ }

  if (exists) {
    await sagemaker.send(new UpdateEndpointCommand({ EndpointName: epName, EndpointConfigName: configName }));
  } else {
    await sagemaker.send(new CreateEndpointCommand({ EndpointName: epName, EndpointConfigName: configName }));
  }

  return epName;
}

// ── Main handler ──────────────────────────────────────────────────────────────

exports.handler = async () => {
  console.log(JSON.stringify({ action: 'retraining-poller-start' }));

  // Scan all ML status records
  let items = [];
  let lastKey;
  do {
    const resp = await dynamo.send(new ScanCommand({
      TableName: ML_TABLE,
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }));
    items = items.concat((resp.Items || []).map(i => unmarshall(i)));
    lastKey = resp.LastEvaluatedKey;
  } while (lastKey);

  console.log(JSON.stringify({ action: 'poller-records', count: items.length }));

  // Split records by phase
  const glueRunning = items.filter(r => r.status === 'glue_running');
  const training    = items.filter(r => r.status === 'training');

  // Poll SageMaker training status in parallel (just DescribeTrainingJob — no rate issues)
  await Promise.allSettled(training.map(rec => checkTrainingJob(rec)));

  // Poll Glue status sequentially — if a Glue job completes, it calls CreateTrainingJob
  // which has a strict rate limit (1 req/s). Sequential + delay prevents "Rate exceeded".
  for (const rec of glueRunning) {
    await checkGlueJob(rec);
    if (glueRunning.length > 1) {
      await new Promise(r => setTimeout(r, 1500)); // 1.5s gap between potential CreateTrainingJob calls
    }
  }

  console.log(JSON.stringify({ action: 'retraining-poller-done' }));
};
