import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { after } from 'node:test';
import { newDb } from 'pg-mem';
import { createApp } from '../src/app.js';
import { prepareDatabase } from '../src/schema.js';

export async function startInbox() {
  const database = newDb();
  database.public.none(
    readFileSync(new URL('../seed.sql', import.meta.url), 'utf8'),
  );
  const { Pool } = database.adapters.createPg();
  const pool = new Pool();
  await prepareDatabase(pool);
  const server = createApp(pool).listen(0);
  const baseUrl = await listening(server);
  after(async () => {
    await close(server);
    await pool.end();
  });
  return { pool, baseUrl };
}

export async function listening(server: Server) {
  if (!server.listening) await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export function close(server: Server) {
  return new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

export async function withEnv<T>(
  values: Record<string, string>,
  run: () => Promise<T>,
) {
  const previous = Object.entries(values).map(
    ([key]) => [key, process.env[key]] as const,
  );
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export const ownerEnv = {
  OWNER_PASSWORD: 'test-password',
  OWNER_SESSION_SECRET: 'test-session-secret',
};

// Stands in for the Python AI service at PYTHON_URL while `run` executes.
export async function withProvider<T>(
  handler: RequestListener,
  run: () => Promise<T>,
) {
  const provider = createServer(handler);
  provider.listen(0);
  const url = await listening(provider);
  try {
    return await withEnv(
      { PYTHON_URL: url, AI_SERVICE_SECRET: 'test-service-secret' },
      run,
    );
  } finally {
    await close(provider);
  }
}

export async function readJson(request: IncomingMessage) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}

export function sendJson(
  response: ServerResponse,
  value: unknown,
  status = 200,
) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

export async function submitAutomaticConversation(baseUrl: string, suggestedPriority = 'normal') {
  const response = await withProvider(
    async (request, response) => {
      const input = await readJson(request);
      const article = input.articles.find((item: { title: string }) => item.title === 'Offline downloads');
      sendJson(response, {
        reply: 'Open a playlist and tap Download. Downloads need a paid plan.',
        suggested_priority: suggestedPriority,
        source_ids: [article.id],
        clearly_covered: true,
        requires_team: false,
      });
    },
    () => fetch(`${baseUrl}/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'How do I download music for offline listening?' }),
    }),
  );
  if (response.status !== 201) throw new Error('Could not submit an automatic-reply conversation');
  return {
    cookie: response.headers.get('set-cookie')!.split(';')[0],
    ticket: await response.json(),
  };
}
