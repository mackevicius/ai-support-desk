import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import {
  close,
  listening,
  readJson,
  sendJson,
  startInbox,
  withEnv,
  withProvider,
} from './helpers.js';
import { getConversation } from '../../web/app/data.js';

const { pool, baseUrl } = await startInbox();

test('conversation loading starts ticket, list and allowance HTTP requests before waiting for any response', async () => {
  const pending = new Map<string, import('node:http').ServerResponse>();
  const server = createServer((request, response) => {
    pending.set(request.url!, response);
    if (pending.size === 3) {
      pending.get('/tickets/1')!.end(JSON.stringify({ id: 1 }));
      pending.get('/tickets')!.end(JSON.stringify([{ id: 1 }]));
      pending
        .get('/live-ai')!
        .end(JSON.stringify({ remaining: 4, paused: false }));
    }
  }).listen(0);
  const url = await listening(server);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await withEnv({ API_URL: url }, async () => {
      const loaded = await Promise.race([
        getConversation('1', 'test-session', undefined, 'customer'),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error('Conversation reads waited for an earlier response'),
              ),
            2000,
          );
        }),
      ]);
      assert.equal(loaded.ticket?.id, 1);
      assert.deepEqual(loaded.tickets, [{ id: 1 }]);
      assert.deepEqual(loaded.allowance, { remaining: 4, paused: false });
    });
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await close(server);
  }
});

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

test('closed starter conversations are solved and cannot be reopened', async () => {
  const response = await fetch(`${baseUrl}/tickets/5`);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const ticket = await response.json();
  assert.equal(ticket.status, 'solved');
  assert.equal(ticket.can_redraft, false);
  assert.equal(ticket.can_request_hand_off, false);
  const solved = await (
    await fetch(`${baseUrl}/tickets?status=solved`, { headers: { cookie } })
  ).json();
  assert.deepEqual(
    solved.map((item: { id: number }) => item.id),
    [5],
  );
  for (const [path, body] of [
    ['review', { action: 'reopen' }],
    ['review', { action: 'reply', reply: 'A new answer' }],
    ['messages', { message: 'A new question' }],
  ] as const) {
    assert.equal(
      (
        await fetch(`${baseUrl}/tickets/5/${path}`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status,
      409,
    );
  }
  assert.equal(
    (
      await (
        await fetch(`${baseUrl}/tickets/5`, { headers: { cookie } })
      ).json()
    ).status,
    'solved',
  );
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
  const response = await fetch(`${baseUrl}/tickets/1`, {
    headers: { cookie: 'demo_seat=agent' },
  });
  assert.equal(response.status, 200);
  const ticket = await response.json();
  assert.equal(ticket.decision.kind, 'hand_off');
  assert.equal(ticket.decision.rule, 'Weak help article coverage');
  assert.deepEqual(ticket.live_ai, { remaining: 5, paused: false });
  const { decision, live_ai, history, ...fields } = ticket;
  assert.deepEqual(fields, {
    id: 1,
    is_sample: true,
    can_redraft: false,
    can_request_hand_off: false,
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
  const submitted = await withProvider(
    async (request, response) => {
      const input = await readJson(request);
      const article = input.articles.find(
        (item: { title: string }) => item.title === 'Offline downloads',
      );
      sendJson(response, {
        reply: 'Open a playlist and tap Download.',
        suggested_priority: 'normal',
        source_ids: [article.id],
        clearly_covered: true,
        requires_team: false,
      });
    },
    () =>
      fetch(`${baseUrl}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'How do I download music?' }),
      }),
  );
  const cookie = submitted.headers.get('set-cookie')!.split(';')[0];
  const { id, status } = await submitted.json();
  assert.equal(status, 'waiting_on_customer');
  const tickets = await (
    await fetch(`${baseUrl}/tickets`, { headers: { cookie } })
  ).json();
  assert.deepEqual(
    tickets.map((ticket: { id: number }) => ticket.id),
    [1, 2, 3, 4, id, 5],
  );
  const open = await (
    await fetch(`${baseUrl}/tickets?status=open`, { headers: { cookie } })
  ).json();
  assert.deepEqual(
    open.map((ticket: { id: number }) => ticket.id),
    [1, 2, 3, 4],
  );
  const waiting = await (
    await fetch(`${baseUrl}/tickets?status=waiting_on_customer`, {
      headers: { cookie },
    })
  ).json();
  assert.deepEqual(
    waiting.map((ticket: { id: number }) => ticket.id),
    [id],
  );
  const solved = await (
    await fetch(`${baseUrl}/tickets?status=solved`, { headers: { cookie } })
  ).json();
  assert.deepEqual(
    solved.map((ticket: { id: number }) => ticket.id),
    [5],
  );
  const replied = await fetch(`${baseUrl}/tickets/${id}/messages`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'I still need help with this.' }),
  });
  assert.equal(replied.status, 201);
  const reordered = await (
    await fetch(`${baseUrl}/tickets`, { headers: { cookie } })
  ).json();
  assert.deepEqual(
    reordered.map((ticket: { id: number }) => ticket.id),
    [id, 1, 2, 3, 4, 5],
  );
});
