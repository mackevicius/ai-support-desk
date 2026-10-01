FROM node:24-bookworm-slim
WORKDIR /app
ENV EMBEDDING_CACHE_DIR=/app/embedding-model
COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm ci --no-audit --no-fund
COPY api api
RUN npm run prepare:embeddings --workspace api
EXPOSE 3001
CMD ["npm", "run", "start", "--workspace", "api"]