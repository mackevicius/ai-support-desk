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
      reply:
        'Please check the email addresses and spam folders, then resend the invitations from Settings > Team. Invitations expire after seven days.',
      suggested_priority: 'high',
      sources: [
        {
          id: 1,
          title: 'Inviting teammates',
          body: 'Workspace admins can resend invitations from Settings > Team. Check the invitation email address and ask teammates to check spam. Invitations expire after seven days.',
          kind: 'help_article',
        },
      ],
      internal_copies: [],
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
    [2, 3, 1, 4],
  );
  const open = await (
    await fetch(`${baseUrl}/tickets?status=open`, { headers: { cookie } })
  ).json();
  assert.deepEqual(
    open.map((ticket: { id: number }) => ticket.id),
    [2],
  );
  const resolved = await (
    await fetch(`${baseUrl}/tickets?status=resolved`, { headers: { cookie } })
  ).json();
  assert.deepEqual(
    resolved.map((ticket: { id: number }) => ticket.id),
    [1, 4],
  );
  const reopened = await fetch(`${baseUrl}/tickets/4/review`, {
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
    [2, 4, 3, 1],
  );
});
