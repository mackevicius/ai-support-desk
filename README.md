# AI Support Desk

Ask Tunely a question in the customer chat or choose an example problem. A clearly covered, non-risky question receives an automatic reply using public help articles. Everything else shows "A Tunely team member will reply soon" and "With our team", with a suggestion to switch to the Agent seat. "How was this answered?" shows the reason and public articles used; the decision is also saved in ticket history. The customer panel lists each visitor's conversations separately. New requests and reviews belong to a temporary visitor session; reset does not change another visitor's data or replenish live-AI allowance.

The Agent seat handles sample requests and new handed-off conversations in three columns: an open-first inbox with a status filter, the customer thread and editable answer draft, and a numbered "How the AI decided" trail. Fixed code rules hand off refunds, double charges, account security and weakly supported answers even when the provider suggests replying. Agents can ask for details without closing the request, redraft, reject, approve a priority or reply, and reopen. Approval delivers the edited reply as "Replied by our team" and opens the next unresolved request. Redrafts count toward the visitor's live-draft allowance. The decision trail uses the saved decision and reason recorded in history. A signed-in owner can manage help articles and generate live drafts for sample requests. Retired articles are excluded from new drafts; saved drafts keep their original citations. No email is sent.

Agent home opens the first open request in that workspace, or the first remaining request when none are open. Switching seats on a submitted conversation keeps that conversation selected. Reset remains available in the inbox column.

## Run locally

With Docker Compose installed, run from the repository root:

```sh
docker compose up --build
```

Open http://localhost:3000 to browse or submit requests. The API is available at http://localhost:3001/tickets. The browser gets a 24-hour demo session cookie; submitted requests stop appearing after 24 hours and expired rows are cleaned up on later submissions. On first start, Postgres loads fictional requests from `api/seed.sql`. The API also applies the additive session schema on first request, so existing Docker volumes keep their data.

### Test the Kubernetes deployment locally

With Docker, [kind](https://kind.sigs.k8s.io/), kubectl, Node.js 24+, and Playwright's Chromium installed, run from the repository root:

```sh
kind create cluster --name support-ci
for service in web api ai; do
	docker build -f "$service/Dockerfile" -t "support-${service}:ci" .
	kind load docker-image "support-${service}:ci" --name support-ci
done
postgres_password="$(openssl rand -hex 24)"
kubectl create secret generic support-secrets \
	--from-literal=postgres-password="$postgres_password" \
	--from-literal=database-url="postgres://support:$postgres_password@db:5432/support_desk" \
	--from-literal=owner-password=test-password \
	--from-literal=owner-session-secret="$(openssl rand -hex 32)" \
	--from-literal=ai-service-secret="$(openssl rand -hex 32)"
kubectl create configmap support-seed --from-file=seed.sql=api/seed.sql
kubectl apply -f k8s/
kubectl run fake-provider --image=support-api:ci --image-pull-policy=Never --port=8001 --env=PORT=8001 --command -- node --import tsx api/test/fake-provider.ts
kubectl expose pod fake-provider --port=8001
kubectl set env deployment/ai OPENAI_BASE_URL=http://fake-provider:8001 OPENAI_API_KEY=fake-key
kubectl wait --for=condition=Ready pod/fake-provider --timeout=180s
for service in db ai api web; do kubectl rollout status "deployment/$service" --timeout=180s; done
kubectl port-forward service/web 3100:3000
```

Leave the port-forward running. In another terminal, run `npm ci`, `npx playwright install chromium`, and `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npm test --workspace web`. The Postgres container loads the seed on its first start. The owner password is a test fixture; the other secrets are generated locally. No AI-provider key is needed. When finished, run `kind delete cluster --name support-ci`. This ephemeral deployment is for testing, not a replacement for the Vercel demo.

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

The root `.env` is ignored by Git. Owner login lasts eight hours in the current demo session. The Node API holds database-backed limits of **5 drafts per visitor session** and **200 drafts per UTC day** across visitors and owners. Failed provider attempts count. Owner generation is exempt from the visitor cap, not the daily cap. Visitors see their remaining allowance. Reset does not replenish it. A reached cap or provider credit refusal shows "Live AI is paused for today"; a question still creates a conversation and hands off. Provider credit refusal pauses all live generation for that UTC day.

Python retrieves up to three relevant current articles and asks for clarification when none match. It uses `gpt-4o-mini` with a 300-token output cap, a 3.2 MB internal input limit, and an eight-second provider timeout. Automatic replies require explicit clear coverage, a separate non-risky decision, and public help articles. Money, account security, uncertainty, and internal notes hand off. Account-related questions are conservatively handed off regardless of the provider's topic label. If a draft introduces words or numbers absent from its sources, a clearly covered, non-risky answer can quote the complete cited public article text when it fits the reply limit and contains no embedded instructions. Otherwise Python substitutes a matching sentence or asks for clarification; neither is eligible for automatic delivery. These checks cannot prove every supported-sounding claim is true. The Python service requires `AI_SERVICE_SECRET`; provider credentials never reach the browser.

## Public demo

One [Vercel Services](https://vercel.com/docs/services) project runs Next.js, the Node API, and the Python service as on-demand functions; a [Neon Free](https://neon.com/pricing) Postgres database holds visitor data. Only the web service receives public traffic. Private bindings supply `API_URL` to the web service and `PYTHON_URL` to the API automatically. To publish it:

1. Create a Neon Free project near the Vercel function region (the default is Washington, DC). Copy the pooled Postgres connection string with SSL enabled; do not commit it. Use the pooled URL to avoid exhausting Neon connections when functions scale out.
2. After the GitHub Actions check passes, import the repository root (not `web/`) as **one** Vercel project on the Hobby plan. Select **Services** as the framework in Build and Deployment settings; `vercel.json` defines the three service roots. No payment card is needed for the Vercel Hobby plan. Keep the production deployment private until you have verified it.
3. In the Vercel project's Environment Variables settings, set `DATABASE_URL` to the Neon URL, `OWNER_PASSWORD` to a strong password, `OWNER_SESSION_SECRET` and `AI_SERVICE_SECRET` to two distinct outputs of `openssl rand -hex 32`, and `OPENAI_API_KEY` to a provider key. Apply these to Production (and Preview if previews need live data), then deploy. Do not set `API_URL` or `PYTHON_URL` yourself, put secrets under `NEXT_PUBLIC_`, commit `.env`, or paste secrets into the browser. The API initializes an empty database on first invocation; later invocations preserve data.
4. Open the Vercel deployment URL. Submit a request, approve a saved reply, reset the demo, and verify the seeded inbox returns. In a private browser session, verify visitor isolation. Sign in as owner, generate a live draft, and open Answer quality. After an idle day, verify the first page and API-backed action respond promptly before retiring the Render services.

GitHub Actions runs typechecking, API, Python, and browser tests, and a production build without paid AI credentials. Browser tests exercise the real Python service against a fake provider, including in Kubernetes. Public visitors can initiate bounded live drafts on submission and redraft their own open hand-offs; the API reserves allowance before contacting Python. Live generation for sample requests and knowledge-base editing still require owner authorization. Vercel and Neon Free are subject to usage limits; monitor both dashboards.

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

The API's `/health` checks database availability. Vercel function logs show failed API routes; error logs contain the HTTP method, route pattern, and status, not ticket text, cookies, or connection strings. Neon Free compute scales to zero after inactivity, so the first database query may be slower than a warm request. Monitor Vercel usage and Neon storage/compute; heavy public traffic can exhaust the free allowances. The deployed demo uses fictional data only.

## Checks

With Node.js 24+ and Python 3.13+, run `npm ci`, `npx playwright install chromium`, `npm run typecheck`, `npm test`, and `npm run build --workspace web`. Browser tests start Next.js, an in-memory API, a fake provider, and Python on ports 3100 through 3103; they need neither Docker nor paid credentials. Test runs build into `web/.next-test`, separate from the dev server's `web/.next`. If those ports are in use, for example by a running dev server, run `PLAYWRIGHT_PORT=3200 npm test` to use ports 3200 through 3203. API and Python tests also use fake provider responses.
