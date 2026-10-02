FROM python:3.13-alpine
WORKDIR /app
COPY ai/server.py ai/server.py
COPY ai/retrieval.py ai/retrieval.py
COPY ai/retrieval-results.json ai/retrieval-results.json
COPY ai/evaluation.py ai/evaluation.py
COPY api/starter-data.json api/starter-data.json
COPY api/retrieval-cases.json api/retrieval-cases.json
COPY api/saved-embeddings.json api/saved-embeddings.json
EXPOSE 8000
CMD ["python", "ai/server.py"]