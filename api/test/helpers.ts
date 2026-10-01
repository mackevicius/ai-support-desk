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
