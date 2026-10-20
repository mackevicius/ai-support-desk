# BGE-small embedding trial

Measured on 2026-10-20. This is an isolated experiment; the application still uses MiniLM and its strict `score > 0.25` cutoff. No database vectors, application snapshots, public quality scores, or runtime model settings were changed.

## Result

BGE-small found the expected article for all 11 existing English questions, including the previously missed nickname question. It needs a different cutoff: keeping `0.25` also retrieved documents for every unrelated question. A strict `score > 0.60` retained all 11 hits and rejected all six unrelated questions in this trial.

| Method | Cutoff | Right document in top 3 | Unrelated questions returning documents |
| --- | --- | --- | --- |
| Word matching | Existing word-overlap rule | 7/11 | Not measured |
| MiniLM q8 | `> 0.25` | 10/11 | 0/6 |
| BGE-small q8 | `> 0.25` | 11/11 | 6/6 |
| BGE-small q8 | `> 0.60` | 11/11 | 0/6 |

At `0.60`, `Where can I edit my nickname?` returns only the expected display-name help article, ID 4. MiniLM returns no documents for that question at `0.25`.

Keep MiniLM in the application for now. BGE-small is promising, but this cutoff was selected on the same small dataset used to report the result. There is no independent test set, and unrelated questions do not represent difficult, in-domain knowledge gaps. More cases and deployment measurements are needed before a production migration.

## Method

- The same 20 starter documents, 11 questions, and expected article IDs were used for both models. No articles or expected answers were rewritten to help BGE.
- Six fixed negative questions cover passports, weather, income tax, bread, plumbing, and mortgages. They are preserved alongside every original question in the [machine-readable report](embedding-model-trial.json).
- The scorer calls the application's [retrieval function](../ai/retrieval.py), keeping its top-three limit, retired-document handling, cosine scoring, and strict cutoff comparison.
- Both models were tested at cutoffs `0.25` through `0.95`, in steps of `0.05`. The reported calibrated cutoff maximizes correct-document hits among settings with zero negative-question matches; ties prefer the lower cutoff. This is exploratory calibration, not evidence that the cutoff generalizes.
- Every document and question was encoded live. MiniLM's 31 corresponding saved vectors matched exactly in this run. Replay can encode questions absent from an older snapshot; those entries are explicitly listed as unverified in `missing_question_ids`.
- Vectors are separated by model and by document/question role. No BGE vector is compared with a MiniLM vector, and no application embedding cache is reused.

## Encoding Recipes

| Setting | MiniLM baseline | BGE-small candidate |
| --- | --- | --- |
| Export | `Xenova/all-MiniLM-L6-v2` | `Xenova/bge-small-en-v1.5` |
| Pinned revision | `751bff37182d3f1213fa05d7196b954e230abad9` | `ea104dacec62c0de699686887e3f920caeb4f3e3` |
| Pooling | Attention-mask-aware mean | First token / CLS |
| Normalization | L2 | L2 |
| Dimensions / weights | 384 / q8 | 384 / q8 |
| Token limit | 512, including special tokens | 512, including prefix and special tokens |
| Document input | Trimmed title + newline + trimmed body | Same, without a prefix |
| Query input | Unprefixed question | `Represent this sentence for searching relevant passages: ` + question |

The BGE recipe follows the [creator's guidance](https://huggingface.co/BAAI/bge-small-en-v1.5) and [CLS pooling configuration](https://huggingface.co/BAAI/bge-small-en-v1.5/blob/main/1_Pooling/config.json), rather than the conflicting mean-pooling example on the export card. Its [pinned export](https://huggingface.co/Xenova/bge-small-en-v1.5/tree/ea104dacec62c0de699686887e3f920caeb4f3e3) was actually executed here, not just checked for compatibility.

## Local Cost

Apple M4 Pro, macOS, Node 24.21.0 **x64**, Transformers.js 3.8.1, CPU execution. Each model ran in its own fresh process with one intra-operation thread and one inter-operation thread. Both started with an empty, separate revision-scoped cache.

| Measurement | MiniLM q8 | BGE-small q8 |
| --- | --- | --- |
| Cold load, including download and initialization | 3.74 s | 4.71 s |
| First document encoding | 34.70 ms | 49.48 ms |
| Median document encoding | 18.53 ms | 34.92 ms |
| Median question encoding | 5.17 ms | 16.86 ms |
| Warm repeated-query median, 5 encodes | 4.50 ms | 15.46 ms |
| Process peak RSS | 280.10 MiB | 281.84 MiB |
| q8 ONNX file | 22.97 MB | 34.01 MB |
| Total downloaded model cache | 23.69 MB | 34.73 MB |

These are single local runs, not a deployment benchmark. Cold load includes network time. Warm measurements execute the model again, not a text-to-vector cache lookup. RSS is the whole worker's peak resident memory, not model weights alone. No provider API was called; CPU, memory, disk, and network are still real costs.

## Reproduce

After the normal repository dependency setup, run from the repository root:

```sh
npm run trial:embeddings --workspace api -- \
  --replay ../docs/embedding-model-trial.json \
  --output /tmp/tunely-embedding-replay.json
```

Replay takes the exact questions and negatives from the recorded report and verifies the starter-document SHA-256 before loading either model. It does not depend on uncommitted additions to the main retrieval-case file. Model revisions and encoding settings are pinned in the [runner](../api/scripts/trial-embeddings.ts); [scoring](../ai/embedding_trial.py) uses the real retrieval interface.

Without `--replay`, the runner uses the current API retrieval cases. Without `--output`, it prints JSON. Each default invocation creates a new temporary model cache. Set `EMBEDDING_TRIAL_CACHE_DIR` to reuse a trial cache for a warm-load measurement; `cache_bytes_before_load` records whether files were already present. `PYTHON` can select the Python executable. The opt-in command downloads models; the new trial tests use fixed vectors and need no model downloads.

No PostgreSQL re-embedding, runtime cache migration, Docker or Vercel resource test, or answer-quality evaluation was performed. Those remain separate requirements for any future application model switch.