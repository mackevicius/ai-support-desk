# AI Support Desk

Browse a fictional support inbox and submit a support request. Seeded requests have saved AI drafts with fictional help articles. You can edit or reject a suggestion, approve its priority independently, approve an in-app reply, reopen a resolved request, move to the next request, and reset your demo workspace. Reviews and new requests belong to each visitor's temporary session; reset does not change another visitor's data. New requests do not generate an answer draft or call an AI provider for visitors. A signed-in owner can add, edit, and retire help articles, generate or regenerate a live draft from current articles, inspect its citations, and approve or reject it. Retired articles are excluded from new drafts; guest saved drafts keep their original citations. No email is sent.

## Run locally

With Docker Compose installed, run from the repository root:

```sh
docker compose up --build
```

Open http://localhost:3000 to browse or submit requests. The API is available at http://localhost:3001/tickets. The browser gets a 24-hour demo session cookie; submitted requests stop appearing after 24 hours and expired rows are cleaned up on later submissions. On first start, Postgres loads fictional requests from `db/seed.sql`. The API also applies the additive session schema on startup, so existing Docker volumes keep their data.

### Enable live generation locally

Run these steps from the repository root. You do not need any credentials to browse the saved-result demo.

1. Run `openssl rand -hex 24` once to create an owner password. Run `openssl rand -hex 32` twice more to create **two different** secrets: one for the owner session and one for communication between the API and Python. Keep the three outputs private.
2. Sign in at the [OpenAI API keys page](https://platform.openai.com/api-keys), create a **new secret key**, and copy it when shown. This is an API key, not your ChatGPT password or subscription. Check your OpenAI API billing/credits before making paid requests.
3. Create or edit a file named `.env` in the **repository root**, next to `compose.yaml`. Put the four values in it, replacing each placeholder with its actual value (without angle brackets or quotes):

	```dotenv
	OWNER_PASSWORD=PASTE_FIRST_OPENSSL_OUTPUT
	OWNER_SESSION_SECRET=PASTE_SECOND_OPENSSL_OUTPUT
	AI_SERVICE_SECRET=PASTE_THIRD_OPENSSL_OUTPUT
	OPENAI_API_KEY=PASTE_OPENAI_SECRET_KEY
	```

4. Run `chmod 600 .env` to restrict local file access, then `docker compose up --build -d` to start or recreate the services with the new values. Compose reads the root `.env` automatically; do not use a file under `web/` or `api/`. If you change a value later, run `docker compose up -d --force-recreate api ai` to apply it. Changing `OWNER_SESSION_SECRET` also signs out existing owner sessions.
5. Check that the containers received the values without printing them:

	```sh
	docker compose exec -T api node -e 'for (const name of ["OWNER_PASSWORD", "OWNER_SESSION_SECRET", "AI_SERVICE_SECRET"]) console.log(name, !process.env[name] ? "missing" : name === "AI_SERVICE_SECRET" && process.env[name] === "local-service-secret" ? "using local default" : "set")'
	docker compose exec -T ai python -c 'import os; print("OPENAI_API_KEY", "set" if os.getenv("OPENAI_API_KEY") else "missing")'
	```

	All four should say `set`. If `AI_SERVICE_SECRET` says `using local default`, replace it with your own value in `.env`. For missing values, check that the file is named exactly `.env`, has no blank values, and is in the repository root. Values already exported in your shell take precedence over the file when Compose starts; unset conflicting exports and recreate the containers.
6. Open http://localhost:3000, select **Owner sign in**, and enter the value of `OWNER_PASSWORD`. Use **Help articles** to add, edit, or retire fictional documentation. Open an unresolved request and select **Generate live draft**; after a document change, use **Regenerate live draft** to replace an unreviewed live suggestion. The owner password is for the app; the OpenAI key goes only to the Python service. Never paste either key or secret into the browser, a ticket, a commit, or chat.

The root `.env` is ignored by Git. The owner login lasts eight hours in the current demo session. The Node API checks owner authorization and holds database-backed caps of 20 generation requests and 400,000 conservatively reserved input/output tokens per UTC day across all sessions (failed provider calls count). Python retrieves up to three relevant current articles and asks for clarification when none match. Supported questions use the fixed `gpt-4o-mini` model with a 300-token output cap, a 3.2 MB internal input limit, and an eight-second provider timeout. If a draft introduces words or numbers absent from its cited articles, the service uses a matching sentence from those articles instead; if no sentence supports the question, it asks for clarification. This lexical check cannot prove every supported-sounding claim is true. A person must explicitly approve priority changes or delivery of a reply, separately. The Python service is internal to Compose and requires `AI_SERVICE_SECRET`; provider credentials never reach the browser.

## Public demo

The [Render Blueprint](render.yaml) runs the Next.js site and Express API on free web services with a free [Neon](https://neon.com/pricing) Postgres database. To publish it:

1. Create a Neon Free project. Copy its Postgres connection string with SSL enabled; do not commit it. Choose a Neon region near the Render services (the Blueprint defaults to Oregon).
2. After merging this branch into `master` and confirming the GitHub Actions check passes, connect this repository to Render and create a Blueprint from `render.yaml`. When prompted for the API's `DATABASE_URL`, enter the Neon connection string. For live generation, enter `OWNER_PASSWORD` for `ai-support-desk-api` and `OPENAI_API_KEY` for `ai-support-desk-ai` when Render prompts for environment variables. Use a strong password and a key from the [OpenAI API keys page](https://platform.openai.com/api-keys). The Blueprint generates `OWNER_SESSION_SECRET` on the API and `AI_SERVICE_SECRET` on the Python service, then copies that service secret to the API automatically. Do not create or paste a local `.env` file into Render, and do not put the OpenAI key on the web service. For an existing Blueprint, set or update the two supplied values under **Dashboard > service > Environment**, save, and redeploy both services. The API seeds an empty database on first startup; subsequent starts preserve visitor data. The web service receives the API's public URL from Render automatically.
3. Open the web service's `https://...onrender.com` URL. Submit a request, approve a saved reply, reset the demo, and verify the seeded inbox returns. Open a private browser session to verify visitors remain independent.

GitHub Actions runs typechecking, API, Python, and browser tests, and a production build without AI credentials. Render's `checksPass` setting deploys later commits on `master` only after checks succeed. The first Blueprint creation triggers an initial deployment, so create it only after the initial CI check passes. Public visitors cannot initiate paid AI calls: the Node API denies guest generation and Python requires a server-only service secret.

## Answer quality

Sign in as the owner and open **Answer quality** to inspect fictional evaluation cases. Each case shows the question, expected behavior, actual answer, cited and available documents, and individual checks. The checked-in deterministic report uses fixed provider replies, calls the real draft generator, and requires no provider key. It intentionally records a wrong priority suggestion and a semantic contradiction that the lexical grounding guard does not catch. These are known limitations, not passing results or evidence of real-user adoption. Changed and untrusted documents are included.

Regenerate the checked-in report after changing the dataset or generator:

```sh
python3 ai/evaluation.py --deterministic --output web/app/quality/results.json
```

CI regenerates this report and fails if it differs from the checked-in version. To run a **separate paid live evaluation**, set `OPENAI_API_KEY` in your local shell and explicitly run:

```sh
python3 ai/evaluation.py --live --output web/app/quality/live-results.json
```

The local owner **Live** tab displays that untracked report, including the dataset version, returned model version (when reported), per-case latency, provider token usage, and estimated cost. Compose mounts the local quality directory into the web container so a live run on the host appears there. Failed provider calls are retained as failed cases without logging their error details or estimating an unreported cost. It is not run in CI or published with the demo. Cost uses reference rates of $0.15 per million input tokens and $0.60 per million output tokens for `gpt-4o-mini`; check current provider prices before budgeting. Exact example matching and lexical support are limited checks, not proof of semantic grounding; inspect the sources when a reply differs from the reference. No live results are shown until you run it. Do not commit the live results or your provider key.

The API's `/health` checks database availability. Render's health checks and service logs show outages and failed API routes; error logs contain the HTTP method, route pattern, and status, not ticket text, cookies, or connection strings. Render Free web services sleep after 15 minutes idle and may take around a minute to wake; Neon Free compute scales to zero after five minutes. These free tiers provide a near-zero idle-cost path, subject to their usage limits. Monitor Render's usage and Neon storage/compute; heavy public traffic can exhaust the free allowances. The deployed demo uses fictional data only.

## Checks

With Node.js 24+ and Python 3.13+, run `npm ci`, `npx playwright install chromium`, `npm run typecheck`, `npm test`, and `npm run build --workspace web`. The browser test starts Next.js and an in-memory API on ports 3100 and 3101; it needs neither Docker nor paid credentials. The API and Python tests use fake provider responses.
