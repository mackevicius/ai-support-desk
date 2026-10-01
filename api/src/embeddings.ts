import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';

const saved = JSON.parse(
  readFileSync(new URL('../saved-embeddings.json', import.meta.url), 'utf8'),
) as {
  model: string;
  revision: string;
  vectors: Record<string, number[]>;
};
export const embeddingModel = saved.model;
let encoder: Promise<FeatureExtractionPipeline> | undefined;
const recent = new Map<string, number[]>();

export type EmbeddingUsage = {
  model: string;
  operation: 'document' | 'question';
  session: string | null;
  cached: boolean;
  succeeded: boolean;
  latency_ms: number;
};

export async function logEmbeddingUsage(
  pool: Pick<Pool, 'query'>,
  records: EmbeddingUsage[],
) {
  for (const record of records) {
    try {
      await pool.query(
        'INSERT INTO embedding_usage (model, operation, session_id, cached, succeeded, latency_ms) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          record.model,
          record.operation,
          record.session,
          record.cached,
          record.succeeded,
          record.latency_ms,
        ],
      );
    } catch {
      console.error(
        JSON.stringify({
          event: 'embedding_usage_write_failed',
          model: record.model,
          operation: record.operation,
          cached: record.cached,
          succeeded: record.succeeded,
          latency_ms: record.latency_ms,
        }),
      );
    }
  }
}

export async function embedText(
  pool: Pick<Pool, 'query'>,
  text: string,
  operation: 'document' | 'question',
  session: string | null = null,
  deferredUsage?: EmbeddingUsage[],
) {
  const started = performance.now();
  let vector = saved.vectors[text] ?? recent.get(text);
  const cached = !!vector;
  let succeeded = false;
  try {
    if (!vector) {
      encoder ??= import('@huggingface/transformers')
        .then(({ pipeline, env }) => {
          env.cacheDir =
            process.env.EMBEDDING_CACHE_DIR ??
            join(tmpdir(), 'support-embeddings');
          return pipeline('feature-extraction', embeddingModel, {
            dtype: 'q8',
            revision: saved.revision,
            session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
          });
        })
        .catch((error) => {
          encoder = undefined;
          throw error;
        });
      const result = await (
        await encoder
      )(text, { pooling: 'mean', normalize: true });
      vector = Array.from(result.data as Float32Array);
      if (vector.length !== 384 || !vector.every(Number.isFinite))
        throw new Error('Invalid sentence embedding');
      if (recent.size >= 256) recent.delete(recent.keys().next().value!);
      recent.set(text, vector);
    }
    succeeded = true;
    return vector;
  } finally {
    const usage: EmbeddingUsage = {
      model: embeddingModel,
      operation,
      session,
      cached,
      succeeded,
      latency_ms: Math.round(performance.now() - started),
    };
    if (deferredUsage) deferredUsage.push(usage);
    else await logEmbeddingUsage(pool, [usage]);
  }
}

export async function embedDocument(
  pool: Pick<Pool, 'query'>,
  title: string,
  body: string,
  session: string | null = null,
  deferredUsage?: EmbeddingUsage[],
) {
  return embedText(
    pool,
    `${title.trim()}\n${body.trim()}`,
    'document',
    session,
    deferredUsage,
  );
}
