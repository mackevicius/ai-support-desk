# Free embedding model research

Date: 2026-10-20. Research only; no alternative model was run or application setting changed.

Follow-up: the research below predates the [isolated BGE-small trial](embedding-model-trial.md). That trial found 11/11 expected articles versus MiniLM's 10/11, but needed a different cutoff and was slower locally. The decision is to keep MiniLM and preserve the current learning baseline. The application model has not changed.

## Try first

Try **BAAI/bge-small-en-v1.5**, using the **Xenova/bge-small-en-v1.5** ONNX export with `dtype: 'q8'`, in a separately authorized experiment.
It keeps the application's 384 dimensions and has promising creator-reported English retrieval results, with a much smaller q8 file than the two alternatives below. This is a practical trial recommendation, not proof it beats MiniLM here. [BAAI][bge] / [export][small-js] / [files][small-files].
It is **not a model-name-only swap**: BGE needs different pooling and query formatting.

## Verified from sources

### Candidates

| Creator model | Dimensions / input limit | Creator weight license | Transformers.js export / q8 file |
| --- | --- | --- | --- |
| [BAAI/bge-small-en-v1.5][bge] | 384 / 512 tokens | MIT | [Xenova/bge-small-en-v1.5][small-js] / [about 34 MB][small-files] |
| [sentence-transformers/all-mpnet-base-v2][mpnet] | 768 / 384 word pieces by creator default; export tokenizer allows 512 | Apache-2.0 | [Xenova/all-mpnet-base-v2][mpnet-js] / [about 110 MB][mpnet-files] |
| [BAAI/bge-base-en-v1.5][base] | 768 / 512 tokens | MIT | [Xenova/bge-base-en-v1.5][base-js] / [about 110 MB][base-files] |

MPNet's [creator configuration][mpnet-limit] says 384; its [export tokenizer][mpnet-tokenizer] says 512. Choose an explicit limit in both embedding paths; do not assume the pipeline preserves the creator default. BGE's [small][small-tokenizer] and [base][base-tokenizer] export tokenizers both specify 512. Prefixes and special tokens consume input space.

### Quality evidence

- **Direct MiniLM comparison:** Sentence Transformers' own semantic-search table reports **57.02 for all-mpnet-base-v2 versus 49.54 for all-MiniLM-L6-v2** on that table's evaluation. This supports trying MPNet as a higher-quality alternative, not a measured application improvement. [Creator comparison][st-comparison].
- **Separate BGE evidence:** BAAI's published English MTEB **Retrieval** column reports **51.68 for BGE-small v1.5, 53.25 for BGE-base v1.5, and 43.81 for MPNet**. These are the same column within BAAI's table, not its overall MTEB averages. [BAAI evaluation][bge-evaluation].
- Do **not** compare 51.68 directly with MiniLM's 49.54: those come from different evaluations. BAAI's cited table does not include MiniLM, so this is not a direct BGE-versus-MiniLM result. Nor do the creator scores establish the quality of these q8 exports.

BGE-base adds a useful tradeoff: a higher reported retrieval score than BGE-small in the same BAAI table, but a larger q8 file and a required 768-dimensional migration. MPNet is the alternative with a direct creator comparison against MiniLM and the current mean-pooling approach. [BAAI][bge-evaluation] / [Sentence Transformers][st-comparison].

### Encoding and compatibility

- **BGE-small and BGE-base:** use `pooling: 'cls'` (the first token's vector) and `normalize: true`. BAAI's actual [small][small-pooling] and [base][base-pooling] pooling configurations enable CLS and disable mean pooling; its [usage instructions][bge-usage] normalize the result.
- For BGE query-to-article retrieval, BAAI recommends `Represent this sentence for searching relevant passages:` followed by one space and the question. Do **not** prefix articles; keep their title + newline + body. The instruction is recommended for this retrieval task, not universally mandatory; v1.5 also supports retrieval without it. [Creator guidance][bge].
- **Source conflict:** Xenova's BGE examples use mean pooling. Treat those cards as evidence for their ONNX artifacts and JS loading, not authority over BAAI's encoding recipe or quality. Follow the creator's CLS configuration. [Small export example][small-js] / [base export example][base-js].
- **MPNet:** attention-mask-aware mean pooling, then normalization; its creator specifies no query/document prefix in the documented recipe. Use unprefixed questions and articles. [Creator usage][mpnet].
- All three export repositories document `@huggingface/transformers` feature-extraction pipelines and contain both full-precision and quantized ONNX files. Transformers.js **3.8.1** supports CLS/mean pooling and normalization; its dtype mapping makes `q8` select `onnx/model_quantized.onnx`. This is source-level compatibility evidence, **not a successful run in this app**. [BGE-small export][small-js] / [MPNet export][mpnet-js] / [BGE-base export][base-js] / [HF pipeline API][js-pipeline] / [HF dtype mapping][js-dtypes].

### Free weights, not free hosting

BAAI explicitly permits commercial use of its released models free of charge under MIT; retain its copyright/license notice. MPNet's creator card declares Apache-2.0, whose grant permits commercial use without royalties, subject to its redistribution, notice, and modification conditions. This verifies the **weight licenses**, not merely a library license. [BAAI license statement][bge-license] / [MIT text][mit] / [MPNet declaration][mpnet] / [Apache terms][apache].

Running downloaded weights locally through Transformers.js does **not** entail a model-provider per-request API bill. You supply CPU, RAM, storage, electricity and any cloud/network costs. Hugging Face's paid hosted Inference Providers are a separate service, not required for this approach. [HF local Node inference/caching][js-node] / [hosted-service billing][hf-billing].

The sizes above are rounded sizes of **one q8 ONNX file**, not total installation size or peak RAM. The current pinned MiniLM q8 file is [about 23 MB][minilm-files]. BGE-small therefore adds download size too. Actual CPU latency, peak memory, cold starts, and Docker/Vercel suitability are **unmeasured**; no deployment limits are asserted.

## App-specific checklist for a future trial

No checklist action below was performed by this research.

1. Keep [api/src/embeddings.ts](../api/src/embeddings.ts) and [api/scripts/save-embeddings.ts](../api/scripts/save-embeddings.ts) identical in model, pinned export revision, q8 dtype, pooling, normalization, token limit, and role-specific input formatting. Runtime reads model/revision from [api/saved-embeddings.json](../api/saved-embeddings.json); the generator currently hard-codes them.
2. BGE-small retains 384 components, but its vectors still belong to a different model space. MPNet/BGE-base require changing both the TS 384-component validation and [ai/server.py](../ai/server.py#L161) validation to 768, plus affected fixtures/contracts. Keeping the same dimension does not make old/new vectors compatible.
3. Re-embed **all existing PostgreSQL article vectors**, not just starter data. [api/src/schema.ts](../api/src/schema.ts#L374) checks `embedding_model` by model name, not revision; revision, pooling or prefix changes under the same name can otherwise leave stale vectors. Do not mix embedding configurations in one retrieval comparison.
4. Regenerate article/question snapshots together, including [api/saved-embeddings.json](../api/saved-embeddings.json), then refresh its evaluation copies and reports through the existing `quality:snapshot` workflow in [package.json](../package.json). Never reuse MiniLM test vectors with new-model runtime vectors.
5. Invalidate the existing 256-entry text-to-vector cache. Keep question/document roles distinct when formatting and looking up snapshots/cache entries, because BGE questions gain a prefix while articles do not. [Runtime cache and encoding](../api/src/embeddings.ts).
6. Recalibrate the strict `score > 0.25` cutoff in [ai/retrieval.py](../ai/retrieval.py); model score distributions differ. Keep top 3 for comparison and use relevant **and unrelated/negative** questions to check unwanted matches. A score is not a calibrated probability.
7. Rerun the **unchanged 11 English questions and expected article IDs**, retaining all original examples. Current recorded baseline: embeddings **10/11**, word matching **7/11**. Receipt/subscription and sound/fidelity paraphrases hit; `Where can I edit my nickname?` misses because nothing exceeds 0.25. Check its expected display-name article **id 4**, not merely whether any result appears. [Cases](../api/retrieval-cases.json) / [recorded results](../ai/retrieval-results.json).
8. Check snapshot/live-vector agreement and measure cold/warm CPU latency, RAM and download/cache behavior on the intended target. Include the [Docker preloader](../api/scripts/prepare-embeddings.ts) and any [Vercel deployment](../vercel.json); do not infer feasibility from ONNX file size alone.

## Not benchmarked here

No alternative weights were downloaded or executed. q8 accuracy, numerical parity, actual Node 24 deployment behavior, resource use, and an appropriate replacement threshold remain unverified. No source proves that any candidate fixes the nickname example; only a future controlled application evaluation can answer that.

## Primary sources

Claim owners: [BAAI][bge] and [Sentence Transformers][st-comparison] for model recipes/quality; [Hugging Face][js-node] for JS behavior; the linked Xenova repositories for their exported files.

[bge]: https://huggingface.co/BAAI/bge-small-en-v1.5
[base]: https://huggingface.co/BAAI/bge-base-en-v1.5
[bge-evaluation]: https://huggingface.co/BAAI/bge-small-en-v1.5#evaluation
[bge-usage]: https://huggingface.co/BAAI/bge-small-en-v1.5#using-huggingface-transformers
[bge-license]: https://huggingface.co/BAAI/bge-small-en-v1.5#license
[mit]: https://github.com/FlagOpen/FlagEmbedding/blob/master/LICENSE
[mpnet]: https://huggingface.co/sentence-transformers/all-mpnet-base-v2
[apache]: https://www.apache.org/licenses/LICENSE-2.0.txt
[st-comparison]: https://sbert.net/docs/sentence_transformer/pretrained_models.html#original-models
[small-js]: https://huggingface.co/Xenova/bge-small-en-v1.5
[mpnet-js]: https://huggingface.co/Xenova/all-mpnet-base-v2
[base-js]: https://huggingface.co/Xenova/bge-base-en-v1.5
[small-files]: https://huggingface.co/Xenova/bge-small-en-v1.5/tree/main/onnx
[mpnet-files]: https://huggingface.co/Xenova/all-mpnet-base-v2/tree/main/onnx
[base-files]: https://huggingface.co/Xenova/bge-base-en-v1.5/tree/main/onnx
[minilm-files]: https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/751bff37182d3f1213fa05d7196b954e230abad9/onnx
[small-pooling]: https://huggingface.co/BAAI/bge-small-en-v1.5/blob/main/1_Pooling/config.json
[base-pooling]: https://huggingface.co/BAAI/bge-base-en-v1.5/blob/main/1_Pooling/config.json
[mpnet-limit]: https://huggingface.co/sentence-transformers/all-mpnet-base-v2/blob/main/sentence_bert_config.json
[mpnet-tokenizer]: https://huggingface.co/Xenova/all-mpnet-base-v2/blob/main/tokenizer_config.json
[small-tokenizer]: https://huggingface.co/Xenova/bge-small-en-v1.5/blob/main/tokenizer_config.json
[base-tokenizer]: https://huggingface.co/Xenova/bge-base-en-v1.5/blob/main/tokenizer_config.json
[js-pipeline]: https://huggingface.co/docs/transformers.js/v3.8.1/api/pipelines#module_pipelines..FeatureExtractionPipelineType
[js-dtypes]: https://github.com/huggingface/transformers.js/blob/3.8.1/src/utils/dtypes.js
[js-node]: https://huggingface.co/docs/transformers.js/v3.8.1/tutorials/node
[hf-billing]: https://huggingface.co/docs/inference-providers/en/pricing