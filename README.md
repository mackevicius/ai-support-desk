# AI Support Desk

Browse a fictional support inbox. The current slice is read-only: it shows seeded requests and their history through a Node API backed by Postgres. No AI provider or paid service is needed.

## Run locally

With Docker Compose installed, run from the repository root:

```sh
docker compose up --build
```

Open http://localhost:3000 to browse requests. The API is available at http://localhost:3001/tickets. On first start, Postgres loads fictional requests from `db/seed.sql`. A persistent Docker volume keeps later database changes; use `docker compose down -v` only if you deliberately want to clear it and reload the sample data.

## Checks

With Node.js 24+, run `npm ci`, `npm run typecheck`, and `npm test`. Tests use an in-memory database and saved responses, so they need neither Docker nor credentials. The current scope is browsing; submitting requests, owner authentication, AI generation, and replies are later work.
