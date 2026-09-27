# AI Support Desk

Browse a fictional support inbox and submit a support request. Seeded requests have saved AI drafts with fictional help articles. You can edit or reject a suggestion, approve an in-app reply, reopen a resolved request, and move to the next request. Reviews are stored per visitor session; other visitors still see the original examples. New requests are stored in a visitor's demo session with an open status and a "Request received" history event. Other visitor sessions cannot see them. New requests do not generate an answer draft or call an AI provider. No email is sent.

## Run locally

With Docker Compose installed, run from the repository root:

```sh
docker compose up --build
```

Open http://localhost:3000 to browse or submit requests. The API is available at http://localhost:3001/tickets. The browser gets a 24-hour demo session cookie; submitted requests stop appearing after 24 hours and expired rows are cleaned up on later submissions. On first start, Postgres loads fictional requests from `db/seed.sql`. The API also applies the additive session schema on startup, so existing Docker volumes keep their data.

## Checks

With Node.js 24+, run `npm ci`, `npx playwright install chromium`, `npm run typecheck`, and `npm test`. The browser test starts Next.js and an in-memory API on ports 3100 and 3101; it needs neither Docker nor credentials. Owner authentication and live AI generation are later work.
