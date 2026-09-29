FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm ci --no-audit --no-fund
COPY api api
EXPOSE 3001
CMD ["npm", "run", "start", "--workspace", "api"]