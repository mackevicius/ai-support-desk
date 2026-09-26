# AI Support Desk

Browse a fictional support inbox and submit a support request. Seeded requests and their history are read-only examples; new requests are stored in a visitor's demo session, with an open status and a "Request received" history event. Other visitor sessions cannot see them. New requests do not generate an answer draft or call an AI provider.

## Run locally

With Docker Compose installed, run from the repository root:

```sh
docker compose up --build
```

Open http://localhost:3000 to browse or submit requests. The API is available at http://localhost:3001/tickets. The browser gets a 24-hour demo session cookie. On first start, Postgres loads fictional requests from `db/seed.sql`. A persistent Docker volume keeps later database changes; existing volumes created before the session schema need to be migrated or deliberately cleared with `docker compose down -v` before restarting.

## Checks

With Node.js 24+, run `npm ci`, `npm run typecheck`, and `npm test`. Tests use an in-memory database and saved responses, so they need neither Docker nor credentials. Owner authentication, AI generation, and replies are later work.
