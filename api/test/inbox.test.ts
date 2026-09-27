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
  await prepareDatabase(pool);
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
    approved_reply: null,
    review_state: null,
    draft: {
      state: 'saved',
      reply: 'Please check the email addresses and spam folders, then resend the invitations from Settings > Team. Invitations expire after seven days.',
      suggested_priority: 'high',
      sources: [{ id: 1, title: 'Inviting teammates', body: 'Workspace admins can resend invitations from Settings > Team. Check the invitation email address and ask teammates to check spam. Invitations expire after seven days.' }],
    },
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

test('a saved draft requires approval and review stays in the visitor session', async () => {
  const first = await fetch(`${baseUrl}/tickets`);
  const firstCookie = first.headers.get('set-cookie')!.split(';')[0];
  const second = await fetch(`${baseUrl}/tickets`);
  const secondCookie = second.headers.get('set-cookie')!.split(';')[0];
  const initial = await (await fetch(`${baseUrl}/tickets/1`, {
    headers: { cookie: firstCookie },
  })).json();
  assert.equal(initial.status, 'open');
  assert.equal(initial.priority, 'high');
  assert.equal(initial.draft.state, 'saved');
  assert.ok(initial.draft.reply.includes('invitation'));
  assert.ok(initial.draft.sources[0].body.includes('invitation'));

  const approved = await fetch(`${baseUrl}/tickets/1/review`, {
    method: 'POST',
    headers: { cookie: firstCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve', reply: 'Please resend the invitations.', priority: 'normal' }),
  });
  assert.equal(approved.status, 200);
  const reviewed = await approved.json();
  assert.equal(reviewed.status, 'resolved');
  assert.equal(reviewed.priority, 'normal');
  assert.equal(reviewed.approved_reply, 'Please resend the invitations.');
  assert.ok(reviewed.history.some((event: { description: string }) => event.description.includes('approved')));

  const other = await (await fetch(`${baseUrl}/tickets/1`, {
    headers: { cookie: secondCookie },
  })).json();
  assert.equal(other.status, 'open');
  assert.equal(other.priority, 'high');
  assert.equal(other.approved_reply, null);
  assert.ok(!other.history.some((event: { description: string }) => event.description.includes('approved')));
});

test('rejection and reopening require explicit human actions', async () => {
  const inbox = await fetch(`${baseUrl}/tickets`);
  const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
  const review = (id: number, body: object) => fetch(`${baseUrl}/tickets/${id}/review`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await review(2, { action: 'approve', reply: '', priority: 'high' })).status, 400);
  assert.equal((await review(2, { action: 'approve', reply: 'Unapproved' })).status, 400);
  assert.equal((await review(2, { action: 'reopen' })).status, 409);
  assert.equal((await review(4, { action: 'approve', reply: 'No draft', priority: 'high' })).status, 409);
  const unchanged = await (await fetch(`${baseUrl}/tickets/2`, { headers: { cookie } })).json();
  assert.equal(unchanged.status, 'open');
  assert.equal(unchanged.priority, 'normal');
  assert.equal(unchanged.history.length, 1);

  const rejected = await (await review(2, { action: 'reject' })).json();
  assert.equal(rejected.draft.state, 'rejected');
  assert.equal(rejected.status, 'open');
  assert.equal(rejected.approved_reply, null);
  assert.ok(rejected.history.at(-1).description.includes('rejected'));
  const replaced = await (await review(2, { action: 'approve', reply: 'I checked the invoice myself.', priority: 'high' })).json();
  assert.equal(replaced.status, 'resolved');
  assert.equal(replaced.approved_reply, 'I checked the invoice myself.');

  const approved = await (await review(3, { action: 'approve', reply: 'Please share the reporting period.', priority: 'normal' })).json();
  assert.equal(approved.status, 'resolved');
  const reopened = await (await review(3, { action: 'reopen' })).json();
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.priority, 'normal');
  assert.equal(reopened.approved_reply, 'Please share the reporting period.');
  assert.ok(reopened.history.at(-1).description.includes('reopened'));
  assert.equal((await review(3, { action: 'reopen' })).status, 409);
  const corrected = await (await review(3, { action: 'approve', reply: 'Please share the dates and timezone.', priority: 'high' })).json();
  assert.equal(corrected.status, 'resolved');
  assert.equal(corrected.approved_reply, 'Please share the dates and timezone.');
  assert.equal(corrected.history.filter((event: { description: string }) => event.description.includes('approved')).length, 2);

  const oldResolved = await (await review(4, { action: 'reopen' })).json();
  assert.equal(oldResolved.status, 'open');
  assert.equal(oldResolved.draft, null);
  assert.ok(oldResolved.history.at(-1).description.includes('reopened'));
  const manual = await (await review(4, { action: 'approve', reply: 'The workspace links still work after the rename.', priority: 'low' })).json();
  assert.equal(manual.status, 'resolved');
  assert.equal(manual.approved_reply, 'The workspace links still work after the rename.');
});

test('only one simultaneous review action changes a request', async () => {
  const inbox = await fetch(`${baseUrl}/tickets`);
  const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
  const submit = () => fetch(`${baseUrl}/tickets/2/review`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve', reply: 'Download the invoice from Billing.', priority: 'normal' }),
  });
  const responses = await Promise.all([submit(), submit()]);
  const ticket = await (await fetch(`${baseUrl}/tickets/2`, { headers: { cookie } })).json();
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(ticket.history.filter((event: { description: string }) => event.description.includes('approved')).length, 1);
});

test('expired visitor reviews and their events are removed from the demo inbox', async () => {
  const inbox = await fetch(`${baseUrl}/tickets`);
  const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
  const sessionId = cookie.split('=')[1];
  const approval = await fetch(`${baseUrl}/tickets/1/review`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve', reply: 'Please resend the invitations.', priority: 'normal' }),
  });
  assert.equal(approval.status, 200);
  await pool.query("UPDATE ticket_reviews SET created_at = '2020-01-01T00:00:00Z' WHERE session_id = $1", [sessionId]);
  await pool.query("UPDATE ticket_events SET created_at = '2020-01-01T00:00:00Z' WHERE session_id = $1", [sessionId]);
  const refreshed = await fetch(`${baseUrl}/tickets`, { headers: { cookie } });
  assert.equal((await refreshed.json()).find((ticket: { id: number }) => ticket.id === 1).status, 'open');
  const ticket = await (await fetch(`${baseUrl}/tickets/1`, { headers: { cookie } })).json();
  assert.equal(ticket.review_state, null);
  assert.equal(ticket.history.length, 2);
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
  assert.deepEqual(
    ticket.history.map((event: { description: string }) => event.description),
    ['Request received'],
  );

  const ownInbox = await fetch(`${baseUrl}/tickets`, {
    headers: { cookie: firstCookie },
  });
  assert.ok(
    (await ownInbox.json()).some(
      (item: { id: number }) => item.id === ticket.id,
    ),
  );
  const ownDetail = await fetch(`${baseUrl}/tickets/${ticket.id}`, {
    headers: { cookie: firstCookie },
  });
  assert.equal(ownDetail.status, 200);
  assert.equal((await ownDetail.json()).question, ticket.question);
  const otherInbox = await fetch(`${baseUrl}/tickets`, {
    headers: { cookie: secondCookie },
  });
  assert.ok(
    !(await otherInbox.json()).some(
      (item: { id: number }) => item.id === ticket.id,
    ),
  );
  assert.equal(
    (
      await fetch(`${baseUrl}/tickets/${ticket.id}`, {
        headers: { cookie: secondCookie },
      })
    ).status,
    404,
  );
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
  await oldPool.query('DROP SEQUENCE ticket_event_ids');
  await prepareDatabase(oldPool);
  const oldServer = createApp(oldPool).listen(0);
  try {
    await new Promise<void>((resolve) => oldServer.once('listening', resolve));
    const address = oldServer.address();
    if (!address || typeof address === 'string')
      throw new Error('No server address');
    const url = `http://127.0.0.1:${address.port}`;
    const inbox = await fetch(`${url}/tickets`);
    assert.equal((await inbox.json())[0].subject, 'Existing request');
    const submitted = await fetch(`${url}/tickets`, {
      method: 'POST',
      headers: {
        cookie: inbox.headers.get('set-cookie')!.split(';')[0],
        'content-type': 'application/json',
      },
      body: JSON.stringify({ question: 'A new question' }),
    });
    assert.equal(submitted.status, 201);
    assert.equal(
      (await submitted.json()).history[0].description,
      'Request received',
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      oldServer.close((error) => (error ? reject(error) : resolve())),
    );
    await oldPool.end();
  }
});

test('an expired demo request cannot be retrieved and is removed on the next submission', async () => {
  const inbox = await fetch(`${baseUrl}/tickets`);
  const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
  const first = await fetch(`${baseUrl}/tickets`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'Old question' }),
  });
  const { id } = await first.json();
  await pool.query(
    "UPDATE support_tickets SET created_at = '2020-01-01T00:00:00Z' WHERE id = $1",
    [id],
  );
  assert.equal(
    (await fetch(`${baseUrl}/tickets/${id}`, { headers: { cookie } })).status,
    404,
  );
  const afterExpiry = await fetch(`${baseUrl}/tickets`, {
    headers: { cookie },
  });
  assert.ok(
    !(await afterExpiry.json()).some(
      (ticket: { id: number }) => ticket.id === id,
    ),
  );
  await fetch(`${baseUrl}/tickets`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'New question' }),
  });
  assert.equal(
    (await pool.query('SELECT id FROM support_tickets WHERE id = $1', [id]))
      .rows.length,
    0,
  );
  assert.equal(
    (
      await pool.query('SELECT id FROM ticket_events WHERE ticket_id = $1', [
        id,
      ])
    ).rows.length,
    0,
  );
});
