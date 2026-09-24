import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { newDb } from 'pg-mem';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';

const database = newDb();
database.public.none(
  readFileSync(new URL('../../db/seed.sql', import.meta.url), 'utf8'),
);
const { Pool } = database.adapters.createPg();
const pool = new Pool();
let server: Server;
let baseUrl: string;

before(async () => {
  server = createApp(pool).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.end();
});

test('a visitor can browse tickets through the API', async () => {
  const response = await fetch(`${baseUrl}/tickets`);
  assert.equal(response.status, 200);
  const tickets = await response.json();
  assert.deepEqual(
    tickets.map((ticket: { id: number }) => ticket.id),
    [1, 2, 3, 4],
  );
  assert.deepEqual(tickets[0], {
    id: 1,
    customer_name: 'Maya Chen',
    subject: 'Team invitations are not arriving',
    status: 'open',
    priority: 'high',
    created_at: '2026-09-20T10:00:00.000Z',
  });
});

test('a visitor can inspect a request and its history', async () => {
  const response = await fetch(`${baseUrl}/tickets/1`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: 1,
    customer_name: 'Maya Chen',
    subject: 'Team invitations are not arriving',
    question:
      'I invited three teammates this morning, but none of them received an email. Can you help us get access before our onboarding call?',
    status: 'open',
    priority: 'high',
    created_at: '2026-09-20T10:00:00.000Z',
    history: [
      {
        id: 1,
        description: 'Request received',
        created_at: '2026-09-20T10:00:00.000Z',
      },
      {
        id: 2,
        description: 'Assigned to the support inbox',
        created_at: '2026-09-20T10:05:00.000Z',
      },
    ],
  });
  assert.equal((await fetch(`${baseUrl}/tickets/999`)).status, 404);
});
