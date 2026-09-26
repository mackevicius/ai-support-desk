import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { newDb } from 'pg-mem';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prepareDatabase } from '../src/schema.js';

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

test('a submitted request belongs only to its visitor session', async () => {
  const firstInbox = await fetch(`${baseUrl}/tickets`);
  const firstCookie = firstInbox.headers.get('set-cookie')?.split(';')[0];
  assert.ok(firstCookie);
  const secondInbox = await fetch(`${baseUrl}/tickets`);
  const secondCookie = secondInbox.headers.get('set-cookie')?.split(';')[0];
  assert.ok(secondCookie);
  assert.notEqual(firstCookie, secondCookie);

  const submitted = await fetch(`${baseUrl}/tickets`, {
    method: 'POST',
    headers: { cookie: firstCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'How do I invite my team?' }),
  });
  assert.equal(submitted.status, 201);
  const ticket = await submitted.json();
  assert.equal(ticket.question, 'How do I invite my team?');
  assert.equal(ticket.status, 'open');
  assert.deepEqual(ticket.history.map((event: { description: string }) => event.description), ['Request received']);

  const ownInbox = await fetch(`${baseUrl}/tickets`, { headers: { cookie: firstCookie } });
  assert.ok((await ownInbox.json()).some((item: { id: number }) => item.id === ticket.id));
  const ownDetail = await fetch(`${baseUrl}/tickets/${ticket.id}`, { headers: { cookie: firstCookie } });
  assert.equal(ownDetail.status, 200);
  assert.equal((await ownDetail.json()).question, ticket.question);
  const otherInbox = await fetch(`${baseUrl}/tickets`, { headers: { cookie: secondCookie } });
  assert.ok(!(await otherInbox.json()).some((item: { id: number }) => item.id === ticket.id));
  assert.equal((await fetch(`${baseUrl}/tickets/${ticket.id}`, { headers: { cookie: secondCookie } })).status, 404);
});

test('an existing inbox keeps its data when the session schema is installed', async () => {
  const oldDatabase = newDb();
  oldDatabase.public.none(`
    CREATE TABLE support_tickets (
      id integer PRIMARY KEY, customer_name text NOT NULL, subject text NOT NULL,
      question text NOT NULL, status text NOT NULL, priority text NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE ticket_events (
      id integer PRIMARY KEY, ticket_id integer NOT NULL REFERENCES support_tickets(id),
      description text NOT NULL, created_at timestamptz NOT NULL
    );
    INSERT INTO support_tickets VALUES
      (1, 'Maya Chen', 'Existing request', 'Can you help?', 'open', 'normal', '2026-09-20T10:00:00Z');
  `);
  const { Pool: OldPool } = oldDatabase.adapters.createPg();
  const oldPool = new OldPool();
  await prepareDatabase(oldPool);
  await prepareDatabase(oldPool);
  const oldServer = createApp(oldPool).listen(0);
  try {
    await new Promise<void>((resolve) => oldServer.once('listening', resolve));
    const address = oldServer.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    const url = `http://127.0.0.1:${address.port}`;
    const inbox = await fetch(`${url}/tickets`);
    assert.equal((await inbox.json())[0].subject, 'Existing request');
    const submitted = await fetch(`${url}/tickets`, {
      method: 'POST',
      headers: { cookie: inbox.headers.get('set-cookie')!.split(';')[0], 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'A new question' }),
    });
    assert.equal(submitted.status, 201);
    assert.equal((await submitted.json()).history[0].description, 'Request received');
  } finally {
    await new Promise<void>((resolve, reject) => oldServer.close((error) => error ? reject(error) : resolve()));
    await oldPool.end();
  }
});

test('an expired demo request cannot be retrieved and is removed on the next submission', async () => {
  const inbox = await fetch(`${baseUrl}/tickets`);
  const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
  const first = await fetch(`${baseUrl}/tickets`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'Old question' }),
  });
  const { id } = await first.json();
  await pool.query("UPDATE support_tickets SET created_at = '2020-01-01T00:00:00Z' WHERE id = $1", [id]);
  assert.equal((await fetch(`${baseUrl}/tickets/${id}`, { headers: { cookie } })).status, 404);
  const afterExpiry = await fetch(`${baseUrl}/tickets`, { headers: { cookie } });
  assert.ok(!(await afterExpiry.json()).some((ticket: { id: number }) => ticket.id === id));
  await fetch(`${baseUrl}/tickets`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'New question' }),
  });
  assert.equal((await pool.query('SELECT id FROM support_tickets WHERE id = $1', [id])).rows.length, 0);
  assert.equal((await pool.query('SELECT id FROM ticket_events WHERE ticket_id = $1', [id])).rows.length, 0);
});
