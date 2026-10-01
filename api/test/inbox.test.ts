import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { close, listening, startInbox } from './helpers.js';

const { pool, baseUrl } = await startInbox();

test('a visitor can browse tickets through the API', async () => {
  const response = await fetch(`${baseUrl}/tickets`);
  assert.equal(response.status, 200);
  const tickets = await response.json();
  assert.deepEqual(
    tickets.map((ticket: { id: number }) => ticket.id),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(tickets[0], {
    id: 1,
    customer_name: 'Maya Chen',
    subject: 'Family invitation keeps failing',
    status: 'open',
    priority: 'high',
    created_at: '2026-09-20T10:00:00.000Z',
  });
});

test('health reports database availability without exposing private details', async () => {
  const healthy = await fetch(`${baseUrl}/health`);
  assert.equal(healthy.status, 200);
  const failingApp = createApp({
    query: async () => {
      throw new Error('private database detail');
    },
    connect: pool.connect.bind(pool),
  } as Parameters<typeof createApp>[0]);
  const failingServer = failingApp.listen(0);
  try {
    const url = await listening(failingServer);
    const unavailable = await fetch(`${url}/health`);
    assert.equal(unavailable.status, 503);
    assert.ok(!(await unavailable.text()).includes('private database detail'));
  } finally {
    await close(failingServer);
  }
});

test('a visitor can inspect a request and its history', async () => {
  const response = await fetch(`${baseUrl}/tickets/1`);
  assert.equal(response.status, 200);
  const ticket = await response.json();
  assert.equal(ticket.decision.kind, 'hand_off');
  assert.equal(ticket.decision.rule, 'Weak help article coverage');
  assert.deepEqual(ticket.live_ai, { remaining: 5, paused: false });
  const { decision, live_ai, history, ...fields } = ticket;
  assert.deepEqual(fields, {
    id: 1,
    is_sample: true,
    customer_name: 'Maya Chen',
    subject: 'Family invitation keeps failing',
    question:
      'My family invitation opens, but I cannot finish joining. What should I try?',
    status: 'open',
    priority: 'high',
    created_at: '2026-09-20T10:00:00.000Z',
    approved_reply: null,
    review_state: null,
    draft: {
      state: 'saved',
      reply:
        'Please ask the family plan owner to create a new invitation from Settings > Plan > Family. What message appears when you open the new link?',
      suggested_priority: 'high',
      sources: [
        {
          id: 1,
          title: 'Family plan invitations',
          body: 'The Tunely family plan owner can invite members from Settings > Plan > Family. Members must live at the same address. Open the invitation link and sign in to join. Invitations expire after seven days.',
          kind: 'help_article',
        },
      ],
      internal_copies: [],
    },
  });
  assert.deepEqual(
    history.map((event: { description: string }) => event.description),
    [
      'Request received',
      'Hand-off: There is not enough clear help article coverage to answer automatically.',
    ],
  );
  assert.equal((await fetch(`${baseUrl}/tickets/999`)).status, 404);
});

test('the inbox sorts reviewed tickets after open tickets and filters by status', async () => {
  const cookie = (await fetch(`${baseUrl}/tickets`)).headers
    .get('set-cookie')!
    .split(';')[0];
  const approval = await fetch(`${baseUrl}/tickets/1/review`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      reply: 'Please resend the invitation.',
      priority: 'normal',
    }),
  });
  assert.equal(approval.status, 200);
  const tickets = await (
    await fetch(`${baseUrl}/tickets`, { headers: { cookie } })
  ).json();
  assert.deepEqual(
    tickets.map((ticket: { id: number }) => ticket.id),
    [2, 3, 4, 1, 5],
  );
  const open = await (
    await fetch(`${baseUrl}/tickets?status=open`, { headers: { cookie } })
  ).json();
  assert.deepEqual(
    open.map((ticket: { id: number }) => ticket.id),
    [2, 3, 4],
  );
  const resolved = await (
    await fetch(`${baseUrl}/tickets?status=resolved`, { headers: { cookie } })
  ).json();
  assert.deepEqual(
    resolved.map((ticket: { id: number }) => ticket.id),
    [1, 5],
  );
  const reopened = await fetch(`${baseUrl}/tickets/5/review`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'reopen' }),
  });
  assert.equal(reopened.status, 200);
  const reordered = await (
    await fetch(`${baseUrl}/tickets`, { headers: { cookie } })
  ).json();
  assert.deepEqual(
    reordered.map((ticket: { id: number }) => ticket.id),
    [2, 3, 4, 5, 1],
  );
});
