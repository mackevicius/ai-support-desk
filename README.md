# AI Support Desk

Browse a fictional support inbox and submit a support request. Seeded requests have saved AI drafts with fictional help articles. You can edit or reject a suggestion, approve its priority independently, approve an in-app reply, reopen a resolved request, move to the next request, and reset your demo workspace. Reviews and new requests belong to each visitor's temporary session; reset does not change another visitor's data. New requests do not generate an answer draft or call an AI provider for visitors. A signed-in owner can request a live draft, inspect its cited articles, and approve or reject it. No email is sent.

## Run locally

With Docker Compose installed, run from the repository root:

```sh
docker compose up --build
```

Open http://localhost:3000 to browse or submit requests. The API is available at http://localhost:3001/tickets. The browser gets a 24-hour demo session cookie; submitted requests stop appearing after 24 hours and expired rows are cleaned up on later submissions. On first start, Postgres loads fictional requests from `db/seed.sql`. The API also applies the additive session schema on startup, so existing Docker volumes keep their data.

To enable owner sign-in and live generation, set `OWNER_PASSWORD` to a strong password, `OWNER_SESSION_SECRET` and `AI_SERVICE_SECRET` to different random secrets, and `OPENAI_API_KEY` in your shell before starting Compose. Do not commit these values. Open **Owner sign in** in the web app. The owner login lasts eight hours in the current demo session. The Node API checks owner authorization and holds database-backed caps of 20 generation requests and 400,000 conservatively reserved input/output tokens per UTC day across all sessions (failed provider calls count). Python selects relevant fictional articles and asks for clarification when none match; supported questions use the fixed `gpt-4o-mini` model with a 300-token output cap, a 32 KB input limit, and an eight-second provider timeout. Replies introducing words or numbers absent from their cited articles are turned into clarification requests; this deliberately rejects some valid paraphrases and cannot prove every supported-sounding claim is true. A person must explicitly approve priority changes or delivery of a reply, separately. The Python service is internal to Compose and requires `AI_SERVICE_SECRET`; provider credentials never reach the browser. Without these settings, the public saved-result demo still works.

## Public demo

The [Render Blueprint](render.yaml) runs the Next.js site and Express API on free web services with a free [Neon](https://neon.com/pricing) Postgres database. To publish it:

1. Create a Neon Free project. Copy its Postgres connection string with SSL enabled; do not commit it. Choose a Neon region near the Render services (the Blueprint defaults to Oregon).
2. After merging this branch into `master` and confirming the GitHub Actions check passes, connect this repository to Render and create a Blueprint from `render.yaml`. When prompted for the API's `DATABASE_URL`, enter the Neon connection string. To enable owner generation, set the API's `OWNER_PASSWORD` and the Python service's `OPENAI_API_KEY` securely in Render. The Blueprint generates separate owner-session and internal-service secrets and passes only the internal secret to the API. The API seeds an empty database on first startup; subsequent starts preserve visitor data. The web service receives the API's public URL from Render automatically.
3. Open the web service's `https://...onrender.com` URL. Submit a request, approve a saved reply, reset the demo, and verify the seeded inbox returns. Open a private browser session to verify visitors remain independent.

GitHub Actions runs typechecking, API, Python, and browser tests, and a production build without AI credentials. Render's `checksPass` setting deploys later commits on `master` only after checks succeed. The first Blueprint creation triggers an initial deployment, so create it only after the initial CI check passes. Public visitors cannot initiate paid AI calls: the Node API denies guest generation and Python requires a server-only service secret.

The API's `/health` checks database availability. Render's health checks and service logs show outages and failed API routes; error logs contain the HTTP method, route pattern, and status, not ticket text, cookies, or connection strings. Render Free web services sleep after 15 minutes idle and may take around a minute to wake; Neon Free compute scales to zero after five minutes. These free tiers provide a near-zero idle-cost path, subject to their usage limits. Monitor Render's usage and Neon storage/compute; heavy public traffic can exhaust the free allowances. The deployed demo uses fictional data only.

## Checks

With Node.js 24+ and Python 3.13+, run `npm ci`, `npx playwright install chromium`, `npm run typecheck`, `npm test`, and `npm run build --workspace web`. The browser test starts Next.js and an in-memory API on ports 3100 and 3101; it needs neither Docker nor paid credentials. The API and Python tests use fake provider responses.
