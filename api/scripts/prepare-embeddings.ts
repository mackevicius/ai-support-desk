import { pipeline, env } from '@huggingface/transformers';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const saved = JSON.parse(
  readFileSync(new URL('../saved-embeddings.json', import.meta.url), 'utf8'),
);
env.cacheDir =
  process.env.EMBEDDING_CACHE_DIR ?? join(tmpdir(), 'support-embeddings');
await pipeline('feature-extraction', saved.model, {
  dtype: 'q8',
  revision: saved.revision,
});
