# Vercel functions for the public demo, Kubernetes only in CI

Render's free plan put each of our three services to sleep separately, and waking them took about a minute each; its 750 free hours per month cannot keep three services awake. We host the public demo on Vercel's free plan instead, running the Node.js API and Python service as on-demand functions from their existing code, because a hirer's first visit must load in seconds and no hosting account may hold a payment card. To still show how the services run as long-lived containers, CI deploys the app to a throwaway Kubernetes cluster on every pull request and runs the end-to-end tests there.

## Considered Options

- **Render, merged into one service kept awake by a pinger:** fits the free hours, but three processes share 0.1 CPU and 512 MB, and wake-ups still hurt if the pinger fails.
- **Google Cloud Run, Oracle Cloud VM, or hosted Kubernetes:** real containers, but each needs a payment card; Oracle may also reclaim an idle VM.
- **Red Hat Developer Sandbox (OpenShift):** free and card-less, but it is a 30-day trial, so a public link would expire.
