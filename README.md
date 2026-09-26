# AI Support Desk

Browse a fictional support inbox and submit a support request. Seeded requests and their history are read-only examples; new requests are stored in a visitor's demo session, with an open status and a "Request received" history event. Other visitor sessions cannot see them. New requests do not generate an answer draft or call an AI provider.

## Run locally

With Docker Compose installed, run from the repository root:

```sh
docker compose up --build
```

Open http://localhost:3000 to browse or submit requests. The API is available at http://localhost:3001/tickets. The browser gets a 24-hour demo session cookie; submitted requests stop appearing after 24 hours and expired rows are cleaned up on later submissions. On first start, Postgres loads fictional requests from `db/seed.sql`. The API also applies the additive session schema on startup, so existing Docker volumes keep their data.

## Checks

With Node.js 24+, run `npm ci`, `npm run typecheck`, and `npm test`. Tests use an in-memory database and saved responses, so they need neither Docker nor credentials. Owner authentication, AI generation, and replies are later work.
