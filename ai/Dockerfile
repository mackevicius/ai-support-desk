FROM python:3.13-alpine
WORKDIR /app
COPY ai/server.py ai/server.py
COPY ai/retrieval.py ai/retrieval.py
COPY ai/retrieval-results.json ai/retrieval-results.json
EXPOSE 8000
CMD ["python", "ai/server.py"]