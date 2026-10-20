import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

type TrialCase = { id: string; question: string; expected_id: number };
type Dataset = {
  articles: { id: number; title: string; body: string }[];
  cases: TrialCase[];
  negatives: { id: string; question: string }[];
  fingerprints: Record<string, string>;
};
type Configuration = {
  key: string;
  model: string;
  revision: string;
  pooling: 'mean' | 'cls';
  query_prefix: string;
  dtype: 'q8';
  normalize: true;
  dimensions: number;
  max_length: number;
};

const configurations: Configuration[] = [
  {
    key: 'minilm',
    model: 'Xenova/all-MiniLM-L6-v2',
    revision: '751bff37182d3f1213fa05d7196b954e230abad9',
    pooling: 'mean',
    query_prefix: '',
    dtype: 'q8',
    normalize: true,
    dimensions: 384,
    max_length: 512,
  },
  {
    key: 'bge',
    model: 'Xenova/bge-small-en-v1.5',
    revision: 'ea104dacec62c0de699686887e3f920caeb4f3e3',
    pooling: 'cls',
    query_prefix: 'Represent this sentence for searching relevant passages: ',
    dtype: 'q8',
    normalize: true,
    dimensions: 384,
    max_length: 512,
  },
];

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(import.meta.url);
const rounded = (value: number) => Math.round(value * 100) / 100;
const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return rounded(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
};

function directoryBytes(path: string): number {
  if (!existsSync(path)) return 0;
  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    const child = join(path, entry.name);
    return total + (entry.isDirectory() ? directoryBytes(child) : entry.isFile() ? statSync(child).size : 0);
  }, 0);
}

async function encodeDataset(config: Configuration, dataset: Dataset) {
  const cacheDir = process.env.EMBEDDING_TRIAL_CACHE_DIR!;
  const modelDir = join(cacheDir, config.model, config.revision);
  const cacheBytesBefore = directoryBytes(modelDir);
  const started = performance.now();
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  const encoder = await pipeline('feature-extraction', config.model, {
    device: 'cpu',
    dtype: config.dtype,
    revision: config.revision,
    session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
  });
  encoder.tokenizer.model_max_length = config.max_length;
  const loadMs = performance.now() - started;
  const vectors: Record<'documents' | 'questions' | 'negatives', Record<string, number[]>> = {
    documents: {}, questions: {}, negatives: {},
  };
  const inputs: { role: keyof typeof vectors; key: string; text: string }[] = [
    ...dataset.articles.map((article) => ({
      role: 'documents' as const,
      key: String(article.id),
      text: `${article.title.trim()}\n${article.body.trim()}`,
    })),
    ...dataset.cases.map((item) => ({ role: 'questions' as const, key: item.id, text: item.question })),
    ...dataset.negatives.map((item) => ({ role: 'negatives' as const, key: item.id, text: item.question })),
  ];
  const timings: Record<keyof typeof vectors, number[]> = { documents: [], questions: [], negatives: [] };
  const saved = JSON.parse(readFileSync(join(root, 'api/saved-embeddings.json'), 'utf8')) as {
    model: string; revision: string; vectors: Record<string, number[]>;
  };
  if (config.key === 'minilm' && (saved.model !== config.model || saved.revision !== config.revision)) {
    throw new Error('The saved baseline no longer matches the pinned MiniLM recipe');
  }
  let maxDifference = 0;
  let compared = 0;
  const missingQuestionSnapshots: string[] = [];

  async function encode(text: string) {
    const before = performance.now();
    const output = await encoder(text, {
      pooling: config.pooling, normalize: config.normalize,
    });
    const vector = Array.from(output.data as Float32Array);
    if (vector.length !== config.dimensions || !vector.every(Number.isFinite)) {
      throw new Error(`Invalid ${config.key} embedding`);
    }
    return { vector, ms: performance.now() - before };
  }

  for (const input of inputs) {
    const text = input.role === 'documents' ? input.text : config.query_prefix + input.text;
    const result = await encode(text);
    vectors[input.role][input.key] = result.vector;
    timings[input.role].push(result.ms);
    if (config.key === 'minilm' && input.role !== 'negatives') {
      const snapshot = saved.vectors[input.text];
      if (!snapshot && input.role === 'questions') {
        missingQuestionSnapshots.push(input.key);
        continue;
      }
      if (!snapshot || snapshot.length !== config.dimensions) {
        throw new Error(`Missing baseline snapshot for ${input.role}/${input.key}`);
      }
      maxDifference = Math.max(maxDifference, ...result.vector.map((value, index) => Math.abs(value - snapshot[index])));
      compared += 1;
    }
  }
  const warmMs: number[] = [];
  for (let repeat = 0; repeat < 5; repeat += 1) {
    warmMs.push((await encode(config.query_prefix + dataset.cases[0].question)).ms);
  }
  const measurements = {
    fresh_process: true,
    cache_bytes_before_load: cacheBytesBefore,
    load_ms: rounded(loadMs),
    first_embedding_ms: rounded(timings.documents[0]),
    document_median_ms: median(timings.documents),
    question_median_ms: median(timings.questions),
    warm_query_median_ms: median(warmMs),
    warm_query_repeats: warmMs.length,
    peak_rss_mib: rounded(process.resourceUsage().maxRSS / 1024),
    model_cache_bytes: directoryBytes(modelDir),
    q8_onnx_bytes: statSync(join(modelDir, 'onnx/model_quantized.onnx')).size,
    snapshot_agreement: config.key === 'minilm' ? {
      compared, max_absolute_difference: maxDifference, tolerance: 0.00001,
      missing_question_ids: missingQuestionSnapshots,
      passed: maxDifference <= 0.00001,
    } : null,
  };
  await encoder.dispose();
  return { config, ...vectors, measurements };
}

function runTrial(output?: string, replay?: string) {
  const starterText = readFileSync(join(root, 'api/starter-data.json'), 'utf8');
  const casesText = readFileSync(join(root, 'api/retrieval-cases.json'), 'utf8');
  const starterHash = createHash('sha256').update(starterText).digest('hex');
  const recorded = replay
    ? JSON.parse(readFileSync(resolve(replay), 'utf8')).dataset as Omit<Dataset, 'articles'>
    : undefined;
  if (recorded && recorded.fingerprints.starter_sha256 !== starterHash) {
    throw new Error('Starter documents do not match the recorded trial');
  }
  const dataset: Dataset = {
    articles: JSON.parse(starterText).articles,
    cases: recorded?.cases ?? JSON.parse(casesText),
    negatives: recorded?.negatives ?? [
      { id: 'passport', question: 'How do I renew my passport?' },
      { id: 'weather', question: 'What is the weather in Tokyo tomorrow?' },
      { id: 'tax', question: 'Can you help me file my income tax return?' },
      { id: 'bread', question: 'How long should I bake sourdough bread?' },
      { id: 'plumbing', question: 'How do I fix a leaking kitchen tap?' },
      { id: 'mortgage', question: 'Where do I apply for a mortgage?' },
    ],
    fingerprints: {
      starter_sha256: starterHash,
      cases_sha256: recorded?.fingerprints.cases_sha256 ?? createHash('sha256').update(casesText).digest('hex'),
    },
  };
  const cacheDir = process.env.EMBEDDING_TRIAL_CACHE_DIR ?? mkdtempSync(join(tmpdir(), 'tunely-embedding-trial-'));
  const runs = configurations.map((config) => {
    process.stderr.write(`Encoding ${config.model} at ${config.revision}\n`);
    const worker = spawnSync(process.execPath, ['--import', 'tsx', script, '--worker', config.key], {
      input: JSON.stringify(dataset), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, EMBEDDING_TRIAL_CACHE_DIR: cacheDir },
      cwd: root,
    });
    if (worker.error) throw worker.error;
    if (worker.status !== 0) throw new Error(worker.stderr || `Embedding worker exited ${worker.status}`);
    return JSON.parse(worker.stdout);
  });
  const require = createRequire(import.meta.url);
  const transformers = JSON.parse(readFileSync(join(dirname(require.resolve('@huggingface/transformers')), '../package.json'), 'utf8'));
  const scored = spawnSync(process.env.PYTHON ?? 'python3', [join(root, 'ai/embedding_trial.py')], {
    input: JSON.stringify({
      dataset, runs,
      environment: {
        recorded_at: new Date().toISOString(), node: process.version,
        replayed_from: replay ? resolve(replay) : null,
        platform: process.platform, architecture: process.arch,
        cpu: cpus()[0]?.model, logical_cpus: cpus().length,
        transformers: transformers.version, cache_dir: cacheDir,
      },
    }),
    encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  });
  if (scored.error) throw scored.error;
  if (scored.status !== 0) throw new Error(scored.stderr || `Trial scorer exited ${scored.status}`);
  if (output) {
    const path = resolve(output);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, scored.stdout);
    process.stderr.write(`Trial report written to ${path}\n`);
  } else process.stdout.write(scored.stdout);
}

const args = process.argv.slice(2);
if (args[0] === '--worker' && args.length === 2) {
  const config = configurations.find((item) => item.key === args[1]);
  if (!config) throw new Error('Unknown trial model');
  process.stdout.write(JSON.stringify(await encodeDataset(config, JSON.parse(readFileSync(0, 'utf8')))));
} else if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  process.stdout.write('Usage: npm run trial:embeddings --workspace api -- [--replay report.json] [--output report.json]\nOptional: EMBEDDING_TRIAL_CACHE_DIR, PYTHON. No production data is written.\n');
} else {
  const options: { output?: string; replay?: string } = {};
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('Expected --output <report.json> or --replay <report.json>');
    if (args[index] === '--output' && !options.output) options.output = value;
    else if (args[index] === '--replay' && !options.replay) options.replay = value;
    else throw new Error('Expected --output <report.json> or --replay <report.json>');
  }
  runTrial(options.output, options.replay);
}