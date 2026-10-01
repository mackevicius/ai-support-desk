import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { newDb } from 'pg-mem';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { prepareDatabase } from '../src/schema.js';

const database = newDb();
database.public.none(
  readFileSync(new URL('../seed.sql', import.meta.url), 'utf8'),
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
    await new Promise<void>((resolve) =>
      failingServer.once('listening', resolve),
    );
    const address = failingServer.address();
    if (!address || typeof address === 'string')
      throw new Error('No server address');
    const unavailable = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(unavailable.status, 503);
    assert.ok(!(await unavailable.text()).includes('private database detail'));
  } finally {
    await new Promise<void>((resolve, reject) =>
      failingServer.close((error) => (error ? reject(error) : resolve())),
    );
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

test('a covered visitor question receives an automatic reply and a recorded explanation', async () => {
  const previousUrl = process.env.PYTHON_URL;
  const previousSecret = process.env.AI_SERVICE_SECRET;
  let checkedOut = false;
  const boundedServer = createApp({
    query: pool.query.bind(pool),
    connect: async () => {
      assert.equal(
        checkedOut,
        false,
        'Submission must release its connection before generation',
      );
      checkedOut = true;
      const client = await pool.connect();
      return {
        query: client.query.bind(client),
        release: () => {
          checkedOut = false;
          client.release();
        },
      };
    },
  } as Parameters<typeof createApp>[0]).listen(0);
  await once(boundedServer, 'listening');
  const boundedAddress = boundedServer.address();
  if (!boundedAddress || typeof boundedAddress === 'string')
    throw new Error('No bounded server address');
  const boundedUrl = `http://127.0.0.1:${boundedAddress.port}`;
  const generator = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const article = input.articles.find(
      (item: { title: string }) => item.title === 'Offline downloads',
    );
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        reply: 'Open a playlist and tap Download. Downloads need a paid plan.',
        suggested_priority: 'normal',
        source_ids: [article.id],
        clearly_covered: true,
        requires_team: false,
      }),
    );
  });
  generator.listen(0);
  await once(generator, 'listening');
  const address = generator.address();
  if (!address || typeof address === 'string')
    throw new Error('No generator address');
  process.env.PYTHON_URL = `http://127.0.0.1:${address.port}`;
  process.env.AI_SERVICE_SECRET = 'test-service-secret';
  try {
    const response = await fetch(`${boundedUrl}/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'How do I download music for offline listening?',
      }),
    });
    assert.equal(response.status, 201);
    const ticket = await response.json();
    assert.equal(ticket.status, 'resolved');
    assert.equal(ticket.decision.kind, 'automatic_reply');
    assert.equal(ticket.decision.sources[0].title, 'Offline downloads');
    assert.equal(
      ticket.approved_reply,
      'Open a playlist and tap Download. Downloads need a paid plan.',
    );
    assert.equal(ticket.live_ai.remaining, 4);
    assert.ok(
      ticket.history.some((event: { description: string }) =>
        event.description.includes(ticket.decision.reason),
      ),
    );
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const saved = await (
      await fetch(`${boundedUrl}/tickets/${ticket.id}`, { headers: { cookie } })
    ).json();
    assert.deepEqual(saved.decision, ticket.decision);
    assert.equal(saved.approved_reply, ticket.approved_reply);
  } finally {
    if (previousUrl === undefined) delete process.env.PYTHON_URL;
    else process.env.PYTHON_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.AI_SERVICE_SECRET;
    else process.env.AI_SERVICE_SECRET = previousSecret;
    await new Promise<void>((resolve) => generator.close(() => resolve()));
    await new Promise<void>((resolve) => boundedServer.close(() => resolve()));
  }
});

test('an uncited internal phrase prevents automatic delivery and warns the agent', async () => {
  const phrase =
    'The confidential playback workaround requires clearing the device entitlement cache';
  await pool.query(
    "INSERT INTO help_articles (id, title, body, kind) VALUES (900, 'Private playback incident', $1, 'internal_note')",
    [phrase],
  );
  const previous = {
    url: process.env.PYTHON_URL,
    secret: process.env.AI_SERVICE_SECRET,
  };
  let calls = 0;
  let sourceIds = [1];
  let editDuringGeneration = false;
  const generator = createServer(async (_request, response) => {
    calls++;
    if (editDuringGeneration)
      await pool.query(
        "UPDATE help_articles SET body = 'The workaround has changed.' WHERE id = 900",
      );
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        reply: phrase,
        topic: 'Private playback incident',
        suggested_priority: 'normal',
        source_ids: sourceIds,
        clearly_covered: true,
        requires_team: false,
      }),
    );
  }).listen(0);
  await once(generator, 'listening');
  const address = generator.address();
  if (!address || typeof address === 'string')
    throw new Error('No generator address');
  process.env.PYTHON_URL = `http://127.0.0.1:${address.port}`;
  process.env.AI_SERVICE_SECRET = 'test-service-secret';
  try {
    const response = await fetch(`${baseUrl}/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Why does playback stop?' }),
    });
    const ticket = await response.json();
    assert.equal(ticket.decision.kind, 'hand_off');
    assert.equal(ticket.approved_reply, null);
    assert.deepEqual(ticket.draft.internal_copies, [
      { start: 0, end: phrase.length, text: phrase },
    ]);
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const customer = await (
      await fetch(`${baseUrl}/tickets/${ticket.id}?view=customer`, {
        headers: { cookie },
      })
    ).json();
    assert.equal(customer.draft, null);
    assert.ok(!JSON.stringify(customer).includes(phrase));
    assert.ok(!JSON.stringify(customer).includes('Private playback incident'));
    const check = await fetch(`${baseUrl}/tickets/${ticket.id}/check`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        reply: `Please try this: ${phrase.toUpperCase()}.`,
      }),
    });
    assert.equal(check.status, 200);
    assert.deepEqual(await check.json(), [
      { start: 17, end: 17 + phrase.length, text: phrase.toUpperCase() },
    ]);
    const short = await fetch(`${baseUrl}/tickets/${ticket.id}/check`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        reply: 'Please restart Tunely and try playback again.',
      }),
    });
    assert.deepEqual(await short.json(), []);
    const blocked = await fetch(`${baseUrl}/tickets/${ticket.id}/review`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        reply: phrase,
        priority: 'normal',
      }),
    });
    assert.equal(blocked.status, 409);
    assert.deepEqual((await blocked.json()).internal_copies, [
      { start: 0, end: phrase.length, text: phrase },
    ]);
    const accepted = await fetch(`${baseUrl}/tickets/${ticket.id}/review`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        reply: phrase,
        priority: 'normal',
        internal_confirmed: phrase,
      }),
    });
    assert.equal(accepted.status, 200);
    assert.equal(calls, 1, 'Copy checks must not make an AI call');
    sourceIds = [900];
    const cited = await fetch(`${baseUrl}/tickets`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Please investigate playback.' }),
    });
    const citedTicket = await cited.json();
    await pool.query('UPDATE help_articles SET retired = true WHERE id = 900');
    sourceIds = [1];
    const retired = await (
      await fetch(`${baseUrl}/tickets`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'Why does playback still stop?' }),
      })
    ).json();
    assert.equal(retired.decision.kind, 'hand_off');
    assert.equal(retired.approved_reply, null);
    await pool.query(
      "UPDATE help_articles SET body = 'The workaround has changed.' WHERE id = 900",
    );
    const snapshotted = await (
      await fetch(`${baseUrl}/tickets/${citedTicket.id}/check`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ reply: phrase }),
      })
    ).json();
    assert.deepEqual(snapshotted, [
      { start: 0, end: phrase.length, text: phrase },
    ]);
    await pool.query(
      'UPDATE help_articles SET body = $1, retired = false WHERE id = 900',
      [phrase],
    );
    editDuringGeneration = true;
    const editedDuring = await (
      await fetch(`${baseUrl}/tickets`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          question: 'Playback still needs investigation.',
        }),
      })
    ).json();
    assert.equal(editedDuring.decision.kind, 'hand_off');
    assert.equal(editedDuring.approved_reply, null);
    assert.deepEqual(editedDuring.draft.internal_copies, [
      { start: 0, end: phrase.length, text: phrase },
    ]);
  } finally {
    if (previous.url === undefined) delete process.env.PYTHON_URL;
    else process.env.PYTHON_URL = previous.url;
    if (previous.secret === undefined) delete process.env.AI_SERVICE_SECRET;
    else process.env.AI_SERVICE_SECRET = previous.secret;
    await new Promise<void>((resolve) => generator.close(() => resolve()));
    await pool.query('DELETE FROM help_articles WHERE id = 900');
  }
});

test('copy checks preserve original offsets for canonically equivalent Unicode words', async () => {
  const phrase =
    'The caf\u00e9 playback workaround requires clearing the device entitlement cache';
  await pool.query(
    "INSERT INTO help_articles (id, title, body, kind) VALUES (901, 'Staff Unicode workaround', $1, 'internal_note')",
    [phrase],
  );
  try {
    const response = await fetch(`${baseUrl}/tickets/1/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reply: phrase.normalize('NFD') }),
    });
    const decomposed = phrase.normalize('NFD');
    assert.deepEqual(await response.json(), [
      { start: 0, end: decomposed.length, text: decomposed },
    ]);
  } finally {
    await pool.query('DELETE FROM help_articles WHERE id = 901');
  }
});

test('document reclassification redacts customer sources and prevents an in-flight automatic reply', async () => {
  const phrase =
    'Playback recovery requires restarting the player and refreshing all downloaded albums';
  await pool.query(
    "INSERT INTO help_articles (id, title, body) VALUES (902, 'Playback recovery', $1)",
    [phrase],
  );
  const previous = {
    url: process.env.PYTHON_URL,
    secret: process.env.AI_SERVICE_SECRET,
  };
  let reclassify = false;
  const generator = createServer(async (_request, response) => {
    if (reclassify)
      await pool.query(
        "UPDATE help_articles SET kind = 'internal_note' WHERE id = 902",
      );
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        reply: phrase,
        source_ids: [902],
        suggested_priority: 'normal',
        clearly_covered: true,
        requires_team: false,
      }),
    );
  }).listen(0);
  await once(generator, 'listening');
  const address = generator.address();
  if (!address || typeof address === 'string')
    throw new Error('No generator address');
  process.env.PYTHON_URL = `http://127.0.0.1:${address.port}`;
  process.env.AI_SERVICE_SECRET = 'test-service-secret';
  try {
    const first = await fetch(`${baseUrl}/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'How does playback recovery work?' }),
    });
    const cookie = first.headers.get('set-cookie')!.split(';')[0];
    const automatic = await first.json();
    assert.equal(automatic.decision.kind, 'automatic_reply');
    await pool.query(
      "UPDATE help_articles SET kind = 'internal_note' WHERE id = 902",
    );
    const customer = await (
      await fetch(`${baseUrl}/tickets/${automatic.id}?view=customer`, {
        headers: { cookie },
      })
    ).json();
    assert.equal(customer.decision.internal_count, 1);
    assert.deepEqual(customer.decision.sources, []);
    assert.ok(!JSON.stringify(customer).includes(phrase));
    assert.ok(!JSON.stringify(customer).includes('Playback recovery'));
    await pool.query(
      "UPDATE help_articles SET kind = 'help_article' WHERE id = 902",
    );
    reclassify = true;
    const during = await (
      await fetch(`${baseUrl}/tickets`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          question: 'Explain the playback recovery steps.',
        }),
      })
    ).json();
    assert.equal(during.decision.kind, 'hand_off');
    assert.equal(during.approved_reply, null);
    assert.equal(during.draft.sources[0].kind, 'internal_note');
  } finally {
    if (previous.url === undefined) delete process.env.PYTHON_URL;
    else process.env.PYTHON_URL = previous.url;
    if (previous.secret === undefined) delete process.env.AI_SERVICE_SECRET;
    else process.env.AI_SERVICE_SECRET = previous.secret;
    await new Promise<void>((resolve) => generator.close(() => resolve()));
    await pool.query('DELETE FROM help_articles WHERE id = 902');
  }
});

test('legacy internal source snapshots retain copied-text checks after the note changes', async () => {
  const phrase =
    'The private playback workaround requires clearing the original device entitlement cache';
  await pool.query(
    "INSERT INTO help_articles (id, title, body, kind) VALUES (903, 'Updated staff incident', 'A revised workaround.', 'internal_note')",
  );
  const cookie = (await fetch(`${baseUrl}/tickets`)).headers
    .get('set-cookie')!
    .split(';')[0];
  const session = cookie.split('=')[1];
  await pool.query(
    'INSERT INTO session_drafts (session_id, ticket_id, reply, suggested_priority, source_ids, source_articles) VALUES ($1, 1, $2, $3, $4, $5)',
    [
      session,
      phrase,
      'normal',
      '[903]',
      JSON.stringify([
        { id: 903, title: 'Original staff incident', body: phrase },
      ]),
    ],
  );
  try {
    await prepareDatabase(pool);
    const response = await fetch(`${baseUrl}/tickets/1/check`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ reply: phrase }),
    });
    assert.deepEqual(await response.json(), [
      { start: 0, end: phrase.length, text: phrase },
    ]);
  } finally {
    await pool.query('DELETE FROM session_drafts WHERE session_id = $1', [
      session,
    ]);
    await pool.query('DELETE FROM help_articles WHERE id = 903');
  }
});

test('only the signed-in owner can create, edit and retire typed internal notes', async () => {
  const previous = {
    password: process.env.OWNER_PASSWORD,
    secret: process.env.OWNER_SESSION_SECRET,
  };
  process.env.OWNER_PASSWORD = 'test-password';
  process.env.OWNER_SESSION_SECRET = 'test-session-secret';
  let id: number | undefined;
  try {
    const cookie = (await fetch(`${baseUrl}/tickets`)).headers
      .get('set-cookie')!
      .split(';')[0];
    const document = {
      title: 'Staff playback incident',
      body: 'A staff-only workaround.',
      kind: 'internal_note',
    };
    const visitorHeaders = { cookie, 'content-type': 'application/json' };
    assert.equal(
      (
        await fetch(`${baseUrl}/help-articles`, {
          method: 'POST',
          headers: visitorHeaders,
          body: JSON.stringify(document),
        })
      ).status,
      403,
    );
    const login = await fetch(`${baseUrl}/owner/login`, {
      method: 'POST',
      headers: visitorHeaders,
      body: JSON.stringify({ password: 'test-password' }),
    });
    const headers = {
      ...visitorHeaders,
      cookie: `${cookie}; ${login.headers.get('set-cookie')!.split(';')[0]}`,
    };
    const created = await fetch(`${baseUrl}/help-articles`, {
      method: 'POST',
      headers,
      body: JSON.stringify(document),
    });
    assert.equal(created.status, 201);
    const note = await created.json();
    id = note.id;
    assert.equal(note.kind, 'internal_note');
    assert.equal(
      (
        await fetch(`${baseUrl}/help-articles/${id}`, {
          method: 'PATCH',
          headers: visitorHeaders,
          body: JSON.stringify({ ...document, retired: true }),
        })
      ).status,
      403,
    );
    for (const retired of [false, true]) {
      const updated = await fetch(`${baseUrl}/help-articles/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          ...document,
          body: 'Updated staff workaround.',
          retired,
        }),
      });
      assert.deepEqual(await updated.json(), {
        id,
        ...document,
        body: 'Updated staff workaround.',
        retired,
      });
    }
    assert.equal(
      (
        await fetch(`${baseUrl}/help-articles`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...document, kind: 'unknown' }),
        })
      ).status,
      400,
    );
  } finally {
    if (id !== undefined)
      await pool.query('DELETE FROM help_articles WHERE id = $1', [id]);
    if (previous.password === undefined) delete process.env.OWNER_PASSWORD;
    else process.env.OWNER_PASSWORD = previous.password;
    if (previous.secret === undefined) delete process.env.OWNER_SESSION_SECRET;
    else process.env.OWNER_SESSION_SECRET = previous.secret;
  }
});

test('a risky live draft can be reviewed by the visitor acting as a support agent', async () => {
  const previous = {
    url: process.env.PYTHON_URL,
    secret: process.env.AI_SERVICE_SECRET,
  };
  const generator = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const article = input.articles.find(
      (item: { title: string }) => item.title === 'Offline downloads',
    );
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        reply: 'Your refund is approved.',
        suggested_priority: 'high',
        topic: 'refund',
        source_ids: [article.id],
        clearly_covered: true,
        requires_team: false,
      }),
    );
  });
  generator.listen(0);
  await once(generator, 'listening');
  const address = generator.address();
  if (!address || typeof address === 'string')
    throw new Error('No generator address');
  process.env.PYTHON_URL = `http://127.0.0.1:${address.port}`;
  process.env.AI_SERVICE_SECRET = 'test-service-secret';
  try {
    const response = await fetch(`${baseUrl}/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Please refund my double charge.' }),
    });
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const ticket = await response.json();
    assert.equal(ticket.status, 'open');
    assert.equal(ticket.decision.kind, 'hand_off');
    assert.ok(
      ticket.history.some(
        (event: { description: string }) =>
          event.description === `Hand-off: ${ticket.decision.reason}`,
      ),
    );
    assert.equal(ticket.draft.reply, 'Your refund is approved.');
    const asked = await fetch(`${baseUrl}/tickets/${ticket.id}/review`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'ask',
        reply: 'Which dates were the two charges taken?',
      }),
    });
    assert.equal(asked.status, 200);
    const waiting = await asked.json();
    assert.equal(waiting.status, 'open');
    assert.ok(
      waiting.history.some(
        (event: { description: string }) =>
          event.description ===
          'Team asked for details: Which dates were the two charges taken?',
      ),
    );
    for (let remaining = 3; remaining >= 0; remaining--) {
      const redraft = await fetch(`${baseUrl}/tickets/${ticket.id}/generate`, {
        method: 'POST',
        headers: { cookie },
      });
      assert.equal(redraft.status, 200);
      assert.equal((await redraft.json()).live_ai.remaining, remaining);
    }
    assert.equal(
      (
        await fetch(`${baseUrl}/tickets/${ticket.id}/generate`, {
          method: 'POST',
          headers: { cookie },
        })
      ).status,
      429,
    );
    const approved = await fetch(`${baseUrl}/tickets/${ticket.id}/review`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        reply: 'Our team will check the two charges.',
        priority: 'high',
      }),
    });
    assert.equal(approved.status, 200);
    const delivered = await approved.json();
    assert.equal(delivered.status, 'resolved');
    assert.equal(
      delivered.approved_reply,
      'Our team will check the two charges.',
    );
  } finally {
    if (previous.url === undefined) delete process.env.PYTHON_URL;
    else process.env.PYTHON_URL = previous.url;
    if (previous.secret === undefined) delete process.env.AI_SERVICE_SECRET;
    else process.env.AI_SERVICE_SECRET = previous.secret;
    await new Promise<void>((resolve) => generator.close(() => resolve()));
  }
});

test('redrafting a reopened automatic reply stays open and cannot overwrite approval', async () => {
  const previous = {
    url: process.env.PYTHON_URL,
    secret: process.env.AI_SERVICE_SECRET,
  };
  let calls = 0;
  let holdRequests = false;
  let announceGeneration: () => void = () => {};
  let releaseGeneration: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    announceGeneration = resolve;
  });
  const held = new Promise<void>((resolve) => {
    releaseGeneration = resolve;
  });
  const generator = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const initial = calls++ === 0;
    if (holdRequests) {
      announceGeneration();
      await held;
    }
    const article = input.articles.find(
      (item: { title: string }) =>
        item.title ===
        (initial ? 'Offline downloads' : 'Changing audio quality'),
    );
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        reply: initial
          ? 'Open a playlist and tap Download.'
          : 'A replacement draft requiring review.',
        topic: initial ? 'Offline downloads' : 'Audio quality',
        suggested_priority: initial ? 'normal' : 'high',
        source_ids: [article.id],
        clearly_covered: initial,
        requires_team: false,
      }),
    );
  });
  generator.listen(0);
  await once(generator, 'listening');
  const address = generator.address();
  if (!address || typeof address === 'string')
    throw new Error('No generator address');
  process.env.PYTHON_URL = `http://127.0.0.1:${address.port}`;
  process.env.AI_SERVICE_SECRET = 'test-service-secret';
  try {
    const submitted = await fetch(`${baseUrl}/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'How do I download music?' }),
    });
    const cookie = submitted.headers.get('set-cookie')!.split(';')[0];
    const ticket = await submitted.json();
    assert.equal(ticket.status, 'resolved');
    const headers = { cookie, 'content-type': 'application/json' };
    assert.equal(
      (
        await fetch(`${baseUrl}/tickets/${ticket.id}/review`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'reopen' }),
        })
      ).status,
      200,
    );
    const redraft = await fetch(`${baseUrl}/tickets/${ticket.id}/generate`, {
      method: 'POST',
      headers,
    });
    assert.equal(redraft.status, 200);
    const updated = await redraft.json();
    assert.equal(updated.status, 'open');
    assert.equal(updated.approved_reply, ticket.approved_reply);
    assert.equal(updated.decision.kind, 'hand_off');
    assert.equal(updated.decision.topic, 'Audio quality');
    assert.equal(updated.decision.suggested_priority, 'high');
    assert.equal(updated.decision.documents[0].title, 'Changing audio quality');
    assert.ok(
      updated.history.some(
        (event: { description: string }) =>
          event.description === `Hand-off: ${updated.decision.reason}`,
      ),
    );
    holdRequests = true;
    const pending = fetch(`${baseUrl}/tickets/${ticket.id}/generate`, {
      method: 'POST',
      headers,
    });
    await started;
    const approved = await fetch(`${baseUrl}/tickets/${ticket.id}/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'approve',
        reply: 'An agent checked this reply.',
        priority: 'normal',
      }),
    });
    assert.equal(approved.status, 200);
    releaseGeneration();
    assert.equal((await pending).status, 409);
    const saved = await (
      await fetch(`${baseUrl}/tickets/${ticket.id}`, { headers })
    ).json();
    assert.equal(saved.status, 'resolved');
    assert.equal(saved.approved_reply, 'An agent checked this reply.');
    assert.equal(saved.draft.reply, updated.draft.reply);
  } finally {
    releaseGeneration();
    if (previous.url === undefined) delete process.env.PYTHON_URL;
    else process.env.PYTHON_URL = previous.url;
    if (previous.secret === undefined) delete process.env.AI_SERVICE_SECRET;
    else process.env.AI_SERVICE_SECRET = previous.secret;
    await new Promise<void>((resolve) => generator.close(() => resolve()));
  }
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

test('fixed hand-off rules override confident provider output and weak coverage', async () => {
  const previous = {
    url: process.env.PYTHON_URL,
    secret: process.env.AI_SERVICE_SECRET,
  };
  let covered = true;
  let sources = true;
  const generator = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        reply: 'A confident but unsafe reply.',
        topic: 'audio quality',
        suggested_priority: 'low',
        source_ids: sources ? [input.articles[0].id] : [],
        clearly_covered: covered,
        requires_team: false,
      }),
    );
  });
  generator.listen(0);
  await once(generator, 'listening');
  const address = generator.address();
  if (!address || typeof address === 'string')
    throw new Error('No generator address');
  process.env.PYTHON_URL = `http://127.0.0.1:${address.port}`;
  process.env.AI_SERVICE_SECRET = 'test-service-secret';
  try {
    for (const question of [
      'I need a refund',
      'Are refunds available?',
      'I was charged twice',
      'My account was hacked',
      'My account has been compromised',
      'Someone took over my account',
      'Unknown music issue',
      'An unsupported draft',
    ]) {
      if (question === 'Unknown music issue') covered = false;
      if (question === 'An unsupported draft') {
        covered = true;
        sources = false;
      }
      const response = await fetch(`${baseUrl}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const ticket = await response.json();
      assert.equal(ticket.decision.kind, 'hand_off', question);
      assert.equal(ticket.approved_reply, null);
      assert.equal(ticket.decision.topic, 'audio quality');
      assert.equal(ticket.decision.suggested_priority, 'low');
      assert.equal(
        ticket.decision.rule,
        /refund|charged|hacked|compromised|account/.test(question)
          ? 'Money or account security'
          : 'Weak help article coverage',
      );
      assert.ok(
        ticket.history.some(
          (event: { description: string }) =>
            event.description === `Hand-off: ${ticket.decision.reason}`,
        ),
      );
    }
  } finally {
    if (previous.url === undefined) delete process.env.PYTHON_URL;
    else process.env.PYTHON_URL = previous.url;
    if (previous.secret === undefined) delete process.env.AI_SERVICE_SECRET;
    else process.env.AI_SERVICE_SECRET = previous.secret;
    await new Promise<void>((resolve) => generator.close(() => resolve()));
  }
});

test('visitor and owner generation share daily limits and provider credit pauses', async () => {
  const previous = {
    url: process.env.PYTHON_URL,
    secret: process.env.AI_SERVICE_SECRET,
    password: process.env.OWNER_PASSWORD,
    session: process.env.OWNER_SESSION_SECRET,
  };
  let calls = 0;
  let providerStatus = 200;
  const generator = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    calls++;
    response.writeHead(providerStatus, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        reply: 'Please share more details.',
        suggested_priority: 'normal',
        source_ids: [],
        clearly_covered: false,
      }),
    );
  });
  generator.listen(0);
  await once(generator, 'listening');
  const address = generator.address();
  if (!address || typeof address === 'string')
    throw new Error('No generator address');
  process.env.PYTHON_URL = `http://127.0.0.1:${address.port}`;
  process.env.AI_SERVICE_SECRET = 'test-service-secret';
  process.env.OWNER_PASSWORD = 'test-password';
  process.env.OWNER_SESSION_SECRET = 'test-session-secret';
  const day = new Date().toISOString().slice(0, 10);
  const submit = async (cookie: string) => {
    const response = await fetch(`${baseUrl}/tickets`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'A question without clear coverage' }),
    });
    assert.equal(response.status, 201);
    return response.json();
  };
  try {
    await pool.query('DELETE FROM generation_usage WHERE day = $1', [day]);
    const cookie = (await fetch(`${baseUrl}/tickets`)).headers
      .get('set-cookie')!
      .split(';')[0];
    for (let draft = 1; draft <= 5; draft++) {
      const ticket = await submit(cookie);
      assert.equal(ticket.live_ai.remaining, 5 - draft);
      assert.equal(ticket.decision.kind, 'hand_off');
    }
    const paused = await submit(cookie);
    assert.equal(paused.decision.reason, 'Live AI is paused for today');
    assert.equal(calls, 5);
    await fetch(`${baseUrl}/reset`, { method: 'POST', headers: { cookie } });
    assert.equal((await submit(cookie)).live_ai.remaining, 0);
    assert.equal(calls, 5);
    const login = await fetch(`${baseUrl}/owner/login`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' }),
    });
    const ownerCookie = `${cookie}; ${login.headers.get('set-cookie')!.split(';')[0]}`;
    await pool.query(
      'UPDATE generation_usage SET requests = 199 WHERE day = $1',
      [day],
    );
    const owner = await fetch(`${baseUrl}/tickets/1/generate`, {
      method: 'POST',
      headers: { cookie: ownerCookie },
    });
    assert.equal(owner.status, 200);
    assert.equal(calls, 6);
    assert.equal(
      (
        await fetch(`${baseUrl}/tickets/2/generate`, {
          method: 'POST',
          headers: { cookie: ownerCookie },
        })
      ).status,
      429,
    );
    const other = (await fetch(`${baseUrl}/tickets`)).headers
      .get('set-cookie')!
      .split(';')[0];
    assert.equal(
      (await submit(other)).decision.reason,
      'Live AI is paused for today',
    );
    assert.equal(calls, 6);
    await pool.query(
      'UPDATE generation_usage SET requests = 0, paused = false WHERE day = $1',
      [day],
    );
    providerStatus = 402;
    const noCredit = await submit(other);
    assert.equal(noCredit.decision.reason, 'Live AI is paused for today');
    assert.equal(noCredit.live_ai.paused, true);
    providerStatus = 200;
    const third = (await fetch(`${baseUrl}/tickets`)).headers
      .get('set-cookie')!
      .split(';')[0];
    assert.equal(
      (await submit(third)).decision.reason,
      'Live AI is paused for today',
    );
    assert.equal(calls, 7);
  } finally {
    await pool.query('DELETE FROM generation_usage WHERE day = $1', [day]);
    if (previous.url === undefined) delete process.env.PYTHON_URL;
    else process.env.PYTHON_URL = previous.url;
    if (previous.secret === undefined) delete process.env.AI_SERVICE_SECRET;
    else process.env.AI_SERVICE_SECRET = previous.secret;
    if (previous.password === undefined) delete process.env.OWNER_PASSWORD;
    else process.env.OWNER_PASSWORD = previous.password;
    if (previous.session === undefined) delete process.env.OWNER_SESSION_SECRET;
    else process.env.OWNER_SESSION_SECRET = previous.session;
    await new Promise<void>((resolve) => generator.close(() => resolve()));
  }
});

test('uncertain, risky, internal-note and invalid answers hand off without delivering drafts', async () => {
  const previousUrl = process.env.PYTHON_URL;
  const previousSecret = process.env.AI_SERVICE_SECRET;
  await pool.query(
    "INSERT INTO help_articles (id, title, body, kind) VALUES (9000, 'Staff investigation', 'Private investigation details', 'internal_note')",
  );
  const generator = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const internal = input.question.includes('internal');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        reply: internal
          ? 'Private investigation details'
          : 'A suggested answer',
        suggested_priority: 'normal',
        source_ids: input.question.includes('no sources')
          ? []
          : [internal ? 9000 : 5],
        clearly_covered: input.question.includes('uncertain')
          ? false
          : input.question.includes('invalid')
            ? 'yes'
            : true,
        requires_team: input.question.includes('human check')
          ? true
          : input.question.includes('missing risk')
            ? undefined
            : false,
      }),
    );
  });
  generator.listen(0);
  await once(generator, 'listening');
  const address = generator.address();
  if (!address || typeof address === 'string')
    throw new Error('No generator address');
  process.env.PYTHON_URL = `http://127.0.0.1:${address.port}`;
  process.env.AI_SERVICE_SECRET = 'test-service-secret';
  try {
    for (const question of [
      'Please refund my offline plan',
      'I was billed twice',
      'Why did my subscription price increase?',
      'My account was hacked',
      'An uncertain answer',
      'An internal answer',
      'An invalid answer',
      'An answer with no sources',
      'A human check is needed',
      'A missing risk assessment',
    ]) {
      const response = await fetch(`${baseUrl}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      assert.equal(response.status, 201);
      const ticket = await response.json();
      assert.equal(ticket.status, 'open');
      assert.equal(ticket.decision.kind, 'hand_off');
      assert.equal(ticket.approved_reply, null);
      assert.equal(ticket.draft?.live ?? false, !question.includes('invalid'));
      assert.ok(
        ticket.history.some(
          (event: { description: string }) =>
            event.description === `Hand-off: ${ticket.decision.reason}`,
        ),
      );
      assert.ok(
        !JSON.stringify({
          decision: ticket.decision,
          reply: ticket.approved_reply,
        }).includes('Private investigation details'),
      );
      if (question === 'An internal answer') {
        const cookie = response.headers.get('set-cookie')!.split(';')[0];
        const customer = await (
          await fetch(`${baseUrl}/tickets/${ticket.id}?view=customer`, {
            headers: { cookie },
          })
        ).json();
        assert.equal(customer.decision.internal_count, 1);
        assert.ok(!JSON.stringify(customer).includes('Staff investigation'));
        assert.ok(
          !JSON.stringify(customer).includes('Private investigation details'),
        );
        assert.equal(ticket.draft.sources[0].kind, 'internal_note');
      }
    }
  } finally {
    await pool.query('DELETE FROM help_articles WHERE id = 9000');
    if (previousUrl === undefined) delete process.env.PYTHON_URL;
    else process.env.PYTHON_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.AI_SERVICE_SECRET;
    else process.env.AI_SERVICE_SECRET = previousSecret;
    await new Promise<void>((resolve) => generator.close(() => resolve()));
  }
});

test('a visitor cannot request live generation', async () => {
  const inbox = await fetch(`${baseUrl}/tickets`);
  const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
  const response = await fetch(`${baseUrl}/tickets/1/generate`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(response.status, 403);
  const ticket = await (
    await fetch(`${baseUrl}/tickets/1`, { headers: { cookie } })
  ).json();
  assert.equal(ticket.draft.state, 'saved');
});

test('owner edits and retires help articles without changing the guest demo', async () => {
  const previous = {
    password: process.env.OWNER_PASSWORD,
    secret: process.env.OWNER_SESSION_SECRET,
    python: process.env.PYTHON_URL,
    serviceSecret: process.env.AI_SERVICE_SECRET,
  };
  const calls: {
    question: string;
    articles: { id: number; title: string; body: string }[];
  }[] = [];
  const generator = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer test-service-secret');
    let body = '';
    for await (const chunk of request) body += chunk;
    if (Buffer.byteLength(body) > 3200000) {
      response.writeHead(413).end();
      return;
    }
    const input = JSON.parse(body);
    calls.push(input);
    const article = input.articles.find(
      (item: { title: string }) => item.title === 'Orbit access',
    );
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify(
        article
          ? {
              reply: article.body,
              suggested_priority: 'normal',
              source_ids: [article.id],
            }
          : {
              reply: 'Could you clarify your request?',
              suggested_priority: 'normal',
              source_ids: [],
            },
      ),
    );
  });
  generator.listen(0);
  await once(generator, 'listening');
  const address = generator.address();
  if (!address || typeof address === 'string')
    throw new Error('No generator address');
  process.env.OWNER_PASSWORD = 'test-password';
  process.env.OWNER_SESSION_SECRET = 'test-session-secret';
  process.env.PYTHON_URL = `http://127.0.0.1:${address.port}`;
  process.env.AI_SERVICE_SECRET = 'test-service-secret';
  try {
    const guestCookie = (await fetch(`${baseUrl}/tickets`)).headers
      .get('set-cookie')!
      .split(';')[0];
    const before = await (
      await fetch(`${baseUrl}/tickets/1`, { headers: { cookie: guestCookie } })
    ).json();
    assert.equal(
      (
        await fetch(`${baseUrl}/help-articles`, {
          headers: { cookie: guestCookie },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/help-articles`, {
          method: 'POST',
          headers: { cookie: guestCookie, 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Denied', body: 'No access' }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/help-articles/1`, {
          method: 'PATCH',
          headers: { cookie: guestCookie, 'content-type': 'application/json' },
          body: JSON.stringify({
            title: 'Denied',
            body: 'No access',
            retired: true,
          }),
        })
      ).status,
      403,
    );
    const login = await fetch(`${baseUrl}/owner/login`, {
      method: 'POST',
      headers: { cookie: guestCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' }),
    });
    const ownerCookie = login.headers.get('set-cookie')!.split(';')[0];
    const headers = {
      cookie: `${guestCookie}; ${ownerCookie}`,
      'content-type': 'application/json',
    };
    const otherCookie = (await fetch(`${baseUrl}/tickets`)).headers
      .get('set-cookie')!
      .split(';')[0];
    assert.equal(
      (
        await fetch(`${baseUrl}/help-articles`, {
          headers: { cookie: `${otherCookie}; ${ownerCookie}` },
        })
      ).status,
      403,
    );
    const listed = await fetch(`${baseUrl}/help-articles`, { headers });
    assert.equal(listed.status, 200);
    const originalArticle = (await listed.json()).find(
      (item: { id: number }) => item.id === 1,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/help-articles`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ title: '', body: 'Missing title' }),
        })
      ).status,
      400,
    );
    const created = await fetch(`${baseUrl}/help-articles`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Orbit access',
        body: 'Orbit access is enabled in Settings.',
      }),
    });
    assert.equal(created.status, 201);
    const article = await created.json();
    assert.equal(article.retired, false);
    for (let index = 0; index < 7; index++) {
      const unrelated = await fetch(`${baseUrl}/help-articles`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: `Unrelated topic ${index}`,
          body: 'z'.repeat(5000),
        }),
      });
      assert.equal(unrelated.status, 201);
    }
    const longArticleIds: number[] = [];
    for (let index = 0; index < 2; index++) {
      const longArticle = await fetch(`${baseUrl}/help-articles`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: `Orbit access extra ${index}`,
          body: '\u0001'.repeat(5000),
        }),
      });
      assert.equal(longArticle.status, 201);
      longArticleIds.push((await longArticle.json()).id);
    }
    const submission = await fetch(`${baseUrl}/tickets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ question: 'How do I use Orbit access?' }),
    });
    const { id } = await submission.json();
    const generate = () =>
      fetch(`${baseUrl}/tickets/${id}/generate`, { method: 'POST', headers });
    let draft = await generate();
    assert.equal(draft.status, 200);
    assert.deepEqual(
      (await draft.json()).draft.sources.map(
        (source: { id: number }) => source.id,
      ),
      [article.id],
    );
    await pool.query(
      'UPDATE session_drafts SET source_articles = NULL WHERE ticket_id = $1',
      [id],
    );
    await prepareDatabase(pool);
    for (const longId of longArticleIds) {
      const retiredLong = await fetch(`${baseUrl}/help-articles/${longId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          title: 'Orbit access extra',
          body: '\u0001'.repeat(5000),
          retired: true,
        }),
      });
      assert.equal(retiredLong.status, 200);
    }
    const edited = await fetch(`${baseUrl}/help-articles/${article.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        title: 'Orbit access',
        body: 'Orbit access now requires owner approval.',
        retired: false,
      }),
    });
    assert.equal(edited.status, 200);
    const originalDraft = await (
      await fetch(`${baseUrl}/tickets/${id}`, { headers })
    ).json();
    assert.equal(
      originalDraft.draft.sources[0].body,
      'Orbit access is enabled in Settings.',
    );
    draft = await generate();
    assert.equal(draft.status, 200);
    let ticket = await draft.json();
    assert.equal(
      ticket.draft.reply,
      'Orbit access now requires owner approval.',
    );
    assert.equal(
      ticket.draft.sources[0].body,
      'Orbit access now requires owner approval.',
    );
    const retired = await fetch(`${baseUrl}/help-articles/${article.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        title: 'Orbit access',
        body: 'Orbit access now requires owner approval.',
        retired: true,
      }),
    });
    assert.equal(retired.status, 200);
    draft = await generate();
    assert.equal(draft.status, 200);
    ticket = await draft.json();
    assert.deepEqual(ticket.draft.sources, []);
    assert.match(ticket.draft.reply, /clarify/i);
    assert.equal(calls.length, 4);
    assert.ok(calls[0].articles.some((item) => item.id === article.id));
    assert.ok(calls[0].articles.length > 3);
    assert.ok(Buffer.byteLength(JSON.stringify(calls[0])) > 32768);
    assert.ok(
      calls[2].articles.some((item) => item.body.includes('owner approval')),
    );
    assert.ok(calls[3].articles.every((item) => item.id !== article.id));
    const updatedSeed = await fetch(`${baseUrl}/help-articles/1`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        title: 'New invitations',
        body: 'New invitation text.',
        retired: true,
      }),
    });
    assert.equal(updatedSeed.status, 200);
    const guest = await (
      await fetch(`${baseUrl}/tickets/1`, { headers: { cookie: guestCookie } })
    ).json();
    assert.deepEqual(guest.draft, before.draft);
    await fetch(`${baseUrl}/help-articles/1`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        title: originalArticle.title,
        body: originalArticle.body,
        retired: false,
      }),
    });
  } finally {
    if (previous.password === undefined) delete process.env.OWNER_PASSWORD;
    else process.env.OWNER_PASSWORD = previous.password;
    if (previous.secret === undefined) delete process.env.OWNER_SESSION_SECRET;
    else process.env.OWNER_SESSION_SECRET = previous.secret;
    if (previous.python === undefined) delete process.env.PYTHON_URL;
    else process.env.PYTHON_URL = previous.python;
    if (previous.serviceSecret === undefined)
      delete process.env.AI_SERVICE_SECRET;
    else process.env.AI_SERVICE_SECRET = previous.serviceSecret;
    await new Promise<void>((resolve) => generator.close(() => resolve()));
  }
});

test('an owner generates a cited draft through Python without approving it', async () => {
  const previous = {
    password: process.env.OWNER_PASSWORD,
    secret: process.env.OWNER_SESSION_SECRET,
    python: process.env.PYTHON_URL,
    serviceSecret: process.env.AI_SERVICE_SECRET,
  };
  const calls: unknown[] = [];
  let providerStatus = 200;
  const provider = createServer(async (request, response) => {
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.authorization, 'Bearer fake-provider-key');
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    calls.push(payload);
    if (providerStatus !== 200) {
      response.writeHead(providerStatus, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify({ error: { code: 'insufficient_quota' } }));
      return;
    }
    const input = JSON.parse(payload.messages[1].content);
    const offline = input.question.includes('offline');
    const article = input.articles.find(
      (item: { id: number }) => item.id === (offline ? 5 : 1),
    );
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: offline
                  ? 'You can save songs for offline play.'
                  : 'Workspace admins can resend invitations from Settings > Team.',
                suggested_priority: 'high',
                source_ids: [article.id],
                clearly_covered: offline,
                requires_team: false,
              }),
            },
          },
        ],
      }),
    );
  });
  provider.listen(0);
  await once(provider, 'listening');
  const providerAddress = provider.address();
  if (!providerAddress || typeof providerAddress === 'string')
    throw new Error('No provider address');
  const reservation = createServer();
  reservation.listen(0);
  await once(reservation, 'listening');
  const pythonAddress = reservation.address();
  if (!pythonAddress || typeof pythonAddress === 'string')
    throw new Error('No Python address');
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const pythonUrl = `http://127.0.0.1:${pythonAddress.port}`;
  const python = spawn(
    'python3',
    ['-u', fileURLToPath(new URL('../../ai/server.py', import.meta.url))],
    {
      env: {
        ...process.env,
        PORT: String(pythonAddress.port),
        AI_SERVICE_SECRET: 'test-service-secret',
        OPENAI_API_KEY: 'fake-provider-key',
        OPENAI_BASE_URL: `http://127.0.0.1:${providerAddress.port}`,
      },
    },
  );
  process.env.OWNER_PASSWORD = 'test-password';
  process.env.OWNER_SESSION_SECRET = 'test-session-secret';
  process.env.PYTHON_URL = pythonUrl;
  process.env.AI_SERVICE_SECRET = 'test-service-secret';
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        ready = (await fetch(`${pythonUrl}/health`)).ok;
        if (ready) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, 'Python service did not start');
    assert.equal(
      (await fetch(`${pythonUrl}/generate`, { method: 'POST' })).status,
      403,
    );
    const cookie = (await fetch(`${baseUrl}/tickets`)).headers
      .get('set-cookie')!
      .split(';')[0];
    const login = await fetch(`${baseUrl}/owner/login`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' }),
    });
    assert.equal(login.status, 204);
    const ownerCookie = login.headers.get('set-cookie')!.split(';')[0];
    const headers = {
      cookie: `${cookie}; ${ownerCookie}`,
      'content-type': 'application/json',
    };
    const otherCookie = (await fetch(`${baseUrl}/tickets`)).headers
      .get('set-cookie')!
      .split(';')[0];
    assert.equal(
      (
        await fetch(`${baseUrl}/tickets/1/generate`, {
          method: 'POST',
          headers: { cookie: `${otherCookie}; ${ownerCookie}` },
        })
      ).status,
      403,
    );
    const submission = await fetch(`${baseUrl}/tickets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ question: 'How do I resend an invitation?' }),
    });
    const { id } = await submission.json();
    const generated = await fetch(`${baseUrl}/tickets/${id}/generate`, {
      method: 'POST',
      headers,
    });
    assert.equal(generated.status, 200);
    const ticket = await generated.json();
    assert.equal(ticket.status, 'open');
    assert.equal(ticket.priority, 'normal');
    assert.equal(ticket.approved_reply, null);
    assert.equal(
      ticket.draft.reply,
      'Workspace admins can resend invitations from Settings > Team.',
    );
    assert.equal(ticket.draft.suggested_priority, 'high');
    assert.equal(ticket.draft.sources[0].title, 'Inviting teammates');
    assert.equal(calls.length, 2);
    const providerCall = calls[0] as {
      max_tokens: number;
      messages: { content: string }[];
    };
    assert.equal(providerCall.max_tokens, 300);
    assert.match(providerCall.messages[0].content, /clearly_covered/);
    assert.match(providerCall.messages[0].content, /topic/);
    const promptData = JSON.parse(providerCall.messages[1].content);
    assert.equal(promptData.question, 'How do I resend an invitation?');
    assert.equal(promptData.articles[0].id, 1);
    const signedOut = await (
      await fetch(`${baseUrl}/tickets/${id}`, {
        headers: { cookie },
      })
    ).json();
    assert.equal(signedOut.draft.reply, ticket.draft.reply);
    assert.equal(
      (
        await fetch(`${baseUrl}/tickets/${id}/review`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'approve',
            reply: ticket.draft.reply,
            priority: 'invalid',
          }),
        })
      ).status,
      400,
    );
    const prioritized = await fetch(`${baseUrl}/tickets/${id}/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'priority', priority: 'high' }),
    });
    assert.equal(prioritized.status, 200);
    const priorityOnly = await prioritized.json();
    assert.equal(priorityOnly.status, 'open');
    assert.equal(priorityOnly.priority, 'high');
    assert.equal(priorityOnly.approved_reply, null);
    assert.equal(priorityOnly.draft.state, 'saved');
    const approved = await fetch(`${baseUrl}/tickets/${id}/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'approve',
        reply: ticket.draft.reply,
        priority: 'high',
      }),
    });
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).status, 'resolved');
    assert.equal(
      (
        await fetch(`${baseUrl}/tickets/${id}/generate`, {
          method: 'POST',
          headers,
        })
      ).status,
      409,
    );
    assert.equal(calls.length, 2);
    await pool.query(
      'UPDATE generation_usage SET requests = 200 WHERE day = $1',
      [new Date().toISOString().slice(0, 10)],
    );
    const another = await fetch(`${baseUrl}/tickets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ question: 'How do I invite a teammate?' }),
    });
    const nextTicket = await another.json();
    assert.equal(
      (
        await fetch(`${baseUrl}/tickets/${nextTicket.id}/generate`, {
          method: 'POST',
          headers,
        })
      ).status,
      429,
    );
    assert.equal(calls.length, 2);
    await pool.query(
      'UPDATE generation_usage SET requests = 0 WHERE day = $1',
      [new Date().toISOString().slice(0, 10)],
    );
    const covered = await fetch(`${baseUrl}/tickets`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'How do I listen offline?' }),
    });
    assert.equal((await covered.json()).decision.kind, 'automatic_reply');
    providerStatus = 429;
    const paused = await fetch(`${baseUrl}/tickets`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'How do I listen offline?' }),
    });
    assert.equal(
      (await paused.json()).decision.reason,
      'Live AI is paused for today',
    );
  } finally {
    if (previous.password === undefined) delete process.env.OWNER_PASSWORD;
    else process.env.OWNER_PASSWORD = previous.password;
    if (previous.secret === undefined) delete process.env.OWNER_SESSION_SECRET;
    else process.env.OWNER_SESSION_SECRET = previous.secret;
    if (previous.python === undefined) delete process.env.PYTHON_URL;
    else process.env.PYTHON_URL = previous.python;
    if (previous.serviceSecret === undefined)
      delete process.env.AI_SERVICE_SECRET;
    else process.env.AI_SERVICE_SECRET = previous.serviceSecret;
    python.kill();
    await once(python, 'exit');
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await pool.query('DELETE FROM generation_usage WHERE day = $1', [
      new Date().toISOString().slice(0, 10),
    ]);
  }
});

test('a saved draft requires approval and review stays in the visitor session', async () => {
  const first = await fetch(`${baseUrl}/tickets`);
  const firstCookie = first.headers.get('set-cookie')!.split(';')[0];
  const second = await fetch(`${baseUrl}/tickets`);
  const secondCookie = second.headers.get('set-cookie')!.split(';')[0];
  const initial = await (
    await fetch(`${baseUrl}/tickets/1`, {
      headers: { cookie: firstCookie },
    })
  ).json();
  assert.equal(initial.status, 'open');
  assert.equal(initial.priority, 'high');
  assert.equal(initial.draft.state, 'saved');
  assert.ok(initial.draft.reply.includes('invitation'));
  assert.ok(initial.draft.sources[0].body.includes('invitation'));

  const approved = await fetch(`${baseUrl}/tickets/1/review`, {
    method: 'POST',
    headers: { cookie: firstCookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      reply: 'Please resend the invitations.',
      priority: 'normal',
    }),
  });
  assert.equal(approved.status, 200);
  const reviewed = await approved.json();
  assert.equal(reviewed.status, 'resolved');
  assert.equal(reviewed.priority, 'normal');
  assert.equal(reviewed.approved_reply, 'Please resend the invitations.');
  assert.ok(
    reviewed.history.some((event: { description: string }) =>
      event.description.includes('approved'),
    ),
  );

  const other = await (
    await fetch(`${baseUrl}/tickets/1`, {
      headers: { cookie: secondCookie },
    })
  ).json();
  assert.equal(other.status, 'open');
  assert.equal(other.priority, 'high');
  assert.equal(other.approved_reply, null);
  assert.ok(
    !other.history.some((event: { description: string }) =>
      event.description.includes('approved'),
    ),
  );
});

test('rejection and reopening require explicit human actions', async () => {
  const inbox = await fetch(`${baseUrl}/tickets`);
  const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
  const review = (id: number, body: object) =>
    fetch(`${baseUrl}/tickets/${id}/review`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await review(2, { action: 'approve', reply: '', priority: 'high' }))
      .status,
    400,
  );
  assert.equal(
    (await review(2, { action: 'approve', reply: 'Unapproved' })).status,
    400,
  );
  assert.equal((await review(2, { action: 'reopen' })).status, 409);
  assert.equal(
    (
      await review(4, {
        action: 'approve',
        reply: 'No draft',
        priority: 'high',
      })
    ).status,
    409,
  );
  const unchanged = await (
    await fetch(`${baseUrl}/tickets/2`, { headers: { cookie } })
  ).json();
  assert.equal(unchanged.status, 'open');
  assert.equal(unchanged.priority, 'normal');
  assert.equal(unchanged.history.length, 1);

  const rejected = await (await review(2, { action: 'reject' })).json();
  assert.equal(rejected.draft.state, 'rejected');
  assert.equal(rejected.status, 'open');
  assert.equal(rejected.approved_reply, null);
  assert.ok(rejected.history.at(-1).description.includes('rejected'));
  const replaced = await (
    await review(2, {
      action: 'approve',
      reply: 'I checked the invoice myself.',
      priority: 'high',
    })
  ).json();
  assert.equal(replaced.status, 'resolved');
  assert.equal(replaced.approved_reply, 'I checked the invoice myself.');

  const approved = await (
    await review(3, {
      action: 'approve',
      reply: 'Please share the reporting period.',
      priority: 'normal',
    })
  ).json();
  assert.equal(approved.status, 'resolved');
  const reopened = await (await review(3, { action: 'reopen' })).json();
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.priority, 'normal');
  assert.equal(reopened.approved_reply, 'Please share the reporting period.');
  assert.ok(reopened.history.at(-1).description.includes('reopened'));
  assert.equal((await review(3, { action: 'reopen' })).status, 409);
  const corrected = await (
    await review(3, {
      action: 'approve',
      reply: 'Please share the dates and timezone.',
      priority: 'high',
    })
  ).json();
  assert.equal(corrected.status, 'resolved');
  assert.equal(
    corrected.approved_reply,
    'Please share the dates and timezone.',
  );
  assert.equal(
    corrected.history.filter((event: { description: string }) =>
      event.description.includes('approved'),
    ).length,
    2,
  );

  const oldResolved = await (await review(4, { action: 'reopen' })).json();
  assert.equal(oldResolved.status, 'open');
  assert.equal(oldResolved.draft, null);
  assert.ok(oldResolved.history.at(-1).description.includes('reopened'));
  const manual = await (
    await review(4, {
      action: 'approve',
      reply: 'The workspace links still work after the rename.',
      priority: 'low',
    })
  ).json();
  assert.equal(manual.status, 'resolved');
  assert.equal(
    manual.approved_reply,
    'The workspace links still work after the rename.',
  );
});

test('only one simultaneous review action changes a request', async () => {
  const inbox = await fetch(`${baseUrl}/tickets`);
  const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
  const submit = () =>
    fetch(`${baseUrl}/tickets/2/review`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        reply: 'Download the invoice from Billing.',
        priority: 'normal',
      }),
    });
  const responses = await Promise.all([submit(), submit()]);
  const ticket = await (
    await fetch(`${baseUrl}/tickets/2`, { headers: { cookie } })
  ).json();
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 409],
  );
  assert.equal(
    ticket.history.filter((event: { description: string }) =>
      event.description.includes('approved'),
    ).length,
    1,
  );
});

test('expired visitor reviews and their events are removed from the demo inbox', async () => {
  const inbox = await fetch(`${baseUrl}/tickets`);
  const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
  const sessionId = cookie.split('=')[1];
  const approval = await fetch(`${baseUrl}/tickets/1/review`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      reply: 'Please resend the invitations.',
      priority: 'normal',
    }),
  });
  assert.equal(approval.status, 200);
  await pool.query(
    "UPDATE ticket_reviews SET created_at = '2020-01-01T00:00:00Z' WHERE session_id = $1",
    [sessionId],
  );
  await pool.query(
    "UPDATE ticket_events SET created_at = '2020-01-01T00:00:00Z' WHERE session_id = $1",
    [sessionId],
  );
  const refreshed = await fetch(`${baseUrl}/tickets`, { headers: { cookie } });
  assert.equal(
    (await refreshed.json()).find((ticket: { id: number }) => ticket.id === 1)
      .status,
    'open',
  );
  const ticket = await (
    await fetch(`${baseUrl}/tickets/1`, { headers: { cookie } })
  ).json();
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
    [
      'Request received',
      'Hand-off: There is not enough clear help article coverage to answer automatically.',
    ],
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

test('reset restores fictional tickets without changing another visitor session', async () => {
  const firstCookie = (await fetch(`${baseUrl}/tickets`)).headers
    .get('set-cookie')!
    .split(';')[0];
  const secondCookie = (await fetch(`${baseUrl}/tickets`)).headers
    .get('set-cookie')!
    .split(';')[0];
  const review = (cookie: string) =>
    fetch(`${baseUrl}/tickets/1/review`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        reply: 'Please resend the invitations.',
        priority: 'normal',
      }),
    });
  assert.equal((await review(firstCookie)).status, 200);
  assert.equal((await review(secondCookie)).status, 200);
  const submitted = await fetch(`${baseUrl}/tickets`, {
    method: 'POST',
    headers: { cookie: firstCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'Reset this question' }),
  });
  const { id } = await submitted.json();

  const reset = await fetch(`${baseUrl}/reset`, {
    method: 'POST',
    headers: { cookie: firstCookie },
  });
  assert.equal(reset.status, 204);
  const restored = await (
    await fetch(`${baseUrl}/tickets/1`, { headers: { cookie: firstCookie } })
  ).json();
  assert.equal(restored.status, 'open');
  assert.equal(restored.review_state, null);
  assert.equal(restored.history.length, 2);
  assert.equal(
    (
      await fetch(`${baseUrl}/tickets/${id}`, {
        headers: { cookie: firstCookie },
      })
    ).status,
    404,
  );
  const other = await (
    await fetch(`${baseUrl}/tickets/1`, { headers: { cookie: secondCookie } })
  ).json();
  assert.equal(other.status, 'resolved');
  assert.equal(other.history.length, 3);
  assert.equal(
    (
      await fetch(`${baseUrl}/reset`, {
        method: 'POST',
        headers: { cookie: firstCookie },
      })
    ).status,
    204,
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
    CREATE TABLE help_articles (id integer PRIMARY KEY, title text NOT NULL, body text NOT NULL);
    INSERT INTO help_articles VALUES
      (5, 'Owner article five', 'Keep five'), (6, 'Owner article six', 'Keep six'), (7, 'Owner article seven', 'Keep seven');
  `);
  const { Pool: OldPool } = oldDatabase.adapters.createPg();
  const oldPool = new OldPool();
  await prepareDatabase(oldPool);
  await prepareDatabase(oldPool);
  await oldPool.query('DROP SEQUENCE ticket_event_ids');
  await prepareDatabase(oldPool);
  const oldServer = createApp(oldPool).listen(0);
  const previousPassword = process.env.OWNER_PASSWORD;
  const previousSecret = process.env.OWNER_SESSION_SECRET;
  process.env.OWNER_PASSWORD = 'test-password';
  process.env.OWNER_SESSION_SECRET = 'test-session-secret';
  try {
    await new Promise<void>((resolve) => oldServer.once('listening', resolve));
    const address = oldServer.address();
    if (!address || typeof address === 'string')
      throw new Error('No server address');
    const url = `http://127.0.0.1:${address.port}`;
    const inbox = await fetch(`${url}/tickets`);
    assert.equal((await inbox.json())[0].subject, 'Existing request');
    const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
    const login = await fetch(`${url}/owner/login`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' }),
    });
    const articles = await (
      await fetch(`${url}/help-articles`, {
        headers: {
          cookie: `${cookie}; ${login.headers.get('set-cookie')!.split(';')[0]}`,
        },
      })
    ).json();
    for (const title of [
      'Offline downloads',
      'Family plan invitations',
      'Changing audio quality',
    ]) {
      assert.equal(
        articles.filter((article: { title: string }) => article.title === title)
          .length,
        1,
      );
    }
    assert.equal(
      articles.find((article: { id: number }) => article.id === 5).body,
      'Keep five',
    );
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
    if (previousPassword === undefined) delete process.env.OWNER_PASSWORD;
    else process.env.OWNER_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.OWNER_SESSION_SECRET;
    else process.env.OWNER_SESSION_SECRET = previousSecret;
  }
});

test('an empty database starts with the fictional inbox and keeps visitor changes on restart', async () => {
  const freshDatabase = newDb();
  const { Pool: FreshPool } = freshDatabase.adapters.createPg();
  const freshPool = new FreshPool();
  try {
    await prepareDatabase(freshPool);
    const freshServer = createApp(freshPool).listen(0);
    try {
      await new Promise<void>((resolve) =>
        freshServer.once('listening', resolve),
      );
      const address = freshServer.address();
      if (!address || typeof address === 'string')
        throw new Error('No server address');
      const url = `http://127.0.0.1:${address.port}`;
      const inbox = await fetch(`${url}/tickets`);
      assert.deepEqual(
        (await inbox.json()).map((ticket: { id: number }) => ticket.id),
        [1, 2, 3, 4],
      );
      const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
      const submitted = await fetch(`${url}/tickets`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'Keep this after restart' }),
      });
      assert.equal(submitted.status, 201);
      const { id } = await submitted.json();
      await prepareDatabase(freshPool);
      const kept = await fetch(`${url}/tickets/${id}`, { headers: { cookie } });
      assert.equal(kept.status, 200);
    } finally {
      await new Promise<void>((resolve, reject) =>
        freshServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    await freshPool.end();
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
