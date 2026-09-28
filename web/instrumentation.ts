export function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Render's free plan sleeps idle services; wake the API and AI alongside the web app instead of one after another.
  for (const url of [process.env.API_URL, process.env.AI_URL]) {
    if (url) fetch(`${url}/health`, { cache: 'no-store' }).catch(() => {});
  }
}
