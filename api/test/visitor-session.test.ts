import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { prepareDatabase } from '../src/schema.js';
import { startInbox, withProvider } from './helpers.js';
import { close, listening, readJson, sendJson } from './helpers.js';

const { pool, baseUrl } = await startInbox();

test(
  'private article embedding usage survives rollback and logging failures do not disrupt saves',
  { skip: !process.env.TEST_DATABASE_URL },
  async (context) => {
    const database = `support_usage_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    await admin.query(`CREATE DATABASE ${database}`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = `/${database}`;
    const isolated = new pg.Pool({ connectionString: url.toString(), max: 1 });
    let server: Server | undefined;
    try {
      await prepareDatabase(isolated);
      await isolated.query(
        "CREATE FUNCTION fail_article_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected article write failure'; END $$",
      );
      await isolated.query(
        'CREATE TRIGGER failed_save BEFORE INSERT ON visitor_help_articles FOR EACH ROW EXECUTE FUNCTION fail_article_save()',
      );
      server = createApp(isolated).listen(0);
      const url = await listening(server);
      const response = await fetch(`${url}/visitor/help-articles`, {
        method: 'POST',
        headers: {
          cookie: 'demo_seat=agent',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Playlist transfer help',
          body: 'Use Settings > Music > Import to transfer song collections.',
        }),
      });
      assert.equal(response.status, 500);
      const usage = await isolated.query(
        "SELECT succeeded FROM embedding_usage WHERE operation = 'document' AND session_id IS NOT NULL",
      );
      assert.deepEqual(usage.rows, [{ succeeded: true }]);
      assert.equal(
        (await isolated.query('SELECT id FROM visitor_help_articles')).rows
          .length,
        0,
      );
      await isolated.query('DROP TRIGGER failed_save ON visitor_help_articles');
      await isolated.query(
        'CREATE TRIGGER failed_usage BEFORE INSERT ON embedding_usage FOR EACH ROW EXECUTE FUNCTION fail_article_save()',
      );
      const errors: string[] = [];
      context.mock.method(console, 'error', (...messages: unknown[]) =>
        errors.push(messages.join(' ')),
      );
      const saved = await fetch(`${url}/visitor/help-articles`, {
        method: 'POST',
        headers: {
          cookie: 'demo_seat=agent',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Playlist transfer help',
          body: 'Use Settings > Music > Import to transfer song collections.',
        }),
      });
      assert.equal(saved.status, 201);
      await saved.json();
      assert.equal(
        (await isolated.query('SELECT id FROM visitor_help_articles')).rows
          .length,
        1,
      );
      assert.ok(
        errors.some(
          (entry) => JSON.parse(entry).event === 'embedding_usage_write_failed',
        ),
      );
      assert.ok(
        errors.every((entry) => JSON.parse(entry).event !== 'api_error'),
      );
      assert.ok(!errors.join(' ').includes('Playlist transfer help'));
    } finally {
      if (server) await close(server);
      await isolated.end();
      await admin.query(`DROP DATABASE ${database}`);
      await admin.end();
    }
  },
);

test('private article embeddings and question embeddings reach drafting only in their own session', async () => {
  const cookie = (await fetch(`${baseUrl}/tickets`)).headers
    .get('set-cookie')!
    .split(';')[0];
  const created = await fetch(`${baseUrl}/visitor/help-articles`, {
    method: 'POST',
    headers: {
      cookie: `${cookie}; demo_seat=agent`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title: 'External music collections',
      body: 'Transfer your song lists through Settings > Music > Import.',
    }),
  });
  assert.equal(created.status, 201);
  const saved = await created.json();
  const inputs: {
    articles: { id: number; embedding: number[] }[];
    question_embedding: number[];
  }[] = [];
  await withProvider(
    async (request, response) => {
      inputs.push(await readJson(request));
      sendJson(response, {
        reply: 'Could you clarify your request?',
        source_ids: [],
        suggested_priority: 'normal',
      });
    },
    async () => {
      const submit = (session?: string) =>
        fetch(`${baseUrl}/tickets`, {
          method: 'POST',
          headers: {
            ...(session ? { cookie: session } : {}),
            'content-type': 'application/json',
          },
          body: JSON.stringify({ question: 'Move Spotify playlists' }),
        });
      assert.equal((await submit(cookie)).status, 201);
      assert.equal((await submit()).status, 201);
    },
  );
  assert.equal(inputs[0].question_embedding.length, 384);
  const own = inputs[0].articles.find((article) => article.id === saved.id)!;
  assert.equal(own.embedding.length, 384);
  assert.ok(own.embedding.every(Number.isFinite));
  assert.ok(!inputs[1].articles.some((article) => article.id === saved.id));
});

test('only the Agent seat can add help articles to its own private copy', async () => {
  const cookie = (await fetch(`${baseUrl}/tickets`)).headers
    .get('set-cookie')!
    .split(';')[0];
  const article = {
    title: 'Sharing playlists',
    body: 'Open the playlist and choose Share.',
  };
  const write = (seat: string, content = article) =>
    fetch(`${baseUrl}/visitor/help-articles`, {
      method: 'POST',
      headers: {
        cookie: `${cookie}; demo_seat=${seat}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(content),
    });
  assert.equal((await write('customer')).status, 403);
  const created = await write('agent');
  assert.equal(created.status, 201);
  const saved = await created.json();
  assert.equal(saved.kind, 'help_article');
  const own = await fetch(`${baseUrl}/visitor/help-articles`, {
    headers: { cookie: `${cookie}; demo_seat=agent` },
  });
  assert.deepEqual(await own.json(), [saved]);
  const other = await fetch(`${baseUrl}/visitor/help-articles`, {
    headers: { cookie: 'demo_seat=agent' },
  });
  assert.deepEqual(await other.json(), []);
  assert.equal(
    (
      await write('agent', {
        ...article,
        kind: 'internal_note',
      } as typeof article)
    ).status,
    400,
  );
});

test('private help articles have size and count limits and reset removes only their own copy', async () => {
  const session = async () =>
    (await fetch(`${baseUrl}/tickets`)).headers
      .get('set-cookie')!
      .split(';')[0];
  const first = await session();
  const second = await session();
  const write = (
    cookie: string,
    title = 'Playlist sharing',
    body = 'Choose Share.',
  ) =>
    fetch(`${baseUrl}/visitor/help-articles`, {
      method: 'POST',
      headers: {
        cookie: `${cookie}; demo_seat=agent`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title, body }),
    });
  assert.equal((await write(first, 'x'.repeat(201))).status, 400);
  assert.equal((await write(first, 'Title', 'x'.repeat(5001))).status, 400);
  assert.equal((await write(first, ' ', 'Body')).status, 400);
  const writes = await Promise.all(
    Array.from({ length: 6 }, () => write(first)),
  );
  assert.equal(writes.filter((response) => response.status === 201).length, 5);
  assert.equal(writes.filter((response) => response.status === 429).length, 1);
  assert.equal((await write(second)).status, 201);
  await fetch(`${baseUrl}/reset`, {
    method: 'POST',
    headers: { cookie: first },
  });
  const list = async (cookie: string) =>
    (
      await fetch(`${baseUrl}/visitor/help-articles`, {
        headers: { cookie: `${cookie}; demo_seat=agent` },
      })
    ).json();
  assert.deepEqual(await list(first), []);
  assert.equal((await list(second)).length, 1);
  assert.equal((await write(first)).status, 429);
});

test('a new visitor sees five saved Tunely outcomes without an AI call', async () => {
  let calls = 0;
  await withProvider(
    (_request, response) => {
      calls++;
      response.writeHead(500).end();
    },
    async () => {
      const inbox = await fetch(`${baseUrl}/tickets`);
      const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
      const tickets = await inbox.json();
      assert.equal(tickets.length, 5);
      const details = await Promise.all(
        tickets.map(async (ticket: { id: number }) =>
          (
            await fetch(`${baseUrl}/tickets/${ticket.id}`, {
              headers: { cookie },
            })
          ).json(),
        ),
      );
      assert.deepEqual(
        details
          .sort((first, second) => first.id - second.id)
          .map((ticket) => ticket.decision?.reason_code),
        [
          'uncertain',
          'internal_note',
          'risky',
          'knowledge_gap',
          'well_supported',
        ],
      );
      assert.ok(details.every((ticket) => ticket.draft?.reply));
      const automatic = details.find((ticket) => ticket.id === 5);
      assert.equal(automatic.status, 'resolved');
      assert.equal(automatic.approved_reply, automatic.draft.reply);
      assert.equal(details[1].draft.sources[0].kind, 'internal_note');
      assert.equal(details[3].draft.sources.length, 0);
      assert.equal(calls, 0);
    },
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
