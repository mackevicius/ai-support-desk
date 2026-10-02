import { readFileSync, writeFileSync } from 'node:fs';
import { pipeline } from '@huggingface/transformers';

const model = 'Xenova/all-MiniLM-L6-v2';
const revision = '751bff37182d3f1213fa05d7196b954e230abad9';
const encoder = await pipeline('feature-extraction', model, {
  dtype: 'q8',
  revision,
});
const starter = JSON.parse(
  readFileSync(new URL('../starter-data.json', import.meta.url), 'utf8'),
);
const cases = JSON.parse(
  readFileSync(new URL('../retrieval-cases.json', import.meta.url), 'utf8'),
);
const vectors: Record<string, number[]> = {};
const texts: string[] = [
  ...starter.articles.map(
    (article: { title: string; body: string }) =>
      `${article.title}\n${article.body}`,
  ),
  ...cases.map((item: { question: string }) => item.question),
];
for (const text of texts) {
  const result = await encoder(text, { pooling: 'mean', normalize: true });
  vectors[text] = Array.from(result.data as Float32Array);
}
writeFileSync(
  new URL('../saved-embeddings.json', import.meta.url),
  JSON.stringify({ model, revision, vectors }) + '\n',
);
