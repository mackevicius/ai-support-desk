import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { prepareDatabase } from '../src/schema.js';
import { startInbox, submitAutomaticConversation, withProvider } from './helpers.js';
import { close, listening, readJson, sendJson } from './helpers.js';

const { pool, baseUrl } = await startInbox();

test('only the customer can solve a waiting conversation and solved conversations are final', async () => {
  const cookie = (await fetch(`${baseUrl}/tickets`)).headers.get('set-cookie')!.split(';')[0];
  const read = async (sessionCookie = cookie) =>
    (await fetch(`${baseUrl}/tickets/1?view=customer`, { headers: { cookie: sessionCookie } })).json();
  const solve = (id: number | string = 1, sessionCookie = cookie) =>
    fetch(`${baseUrl}/tickets/${id}/solve`, {
      method: 'POST',
      headers: { cookie: sessionCookie },
    });
  assert.equal((await solve()).status, 409);
  assert.equal((await solve('invalid')).status, 404);
  assert.equal((await solve(999999)).status, 404);
  const replied = await fetch(`${baseUrl}/tickets/1/review`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'reply', reply: 'Please try a new family invitation.' }),
  });
  assert.equal(replied.status, 200);
  assert.equal((await read()).status, 'waiting_on_customer');
  assert.equal((await solve(1, `${cookie}; demo_seat=agent`)).status, 403);
  const allowance = await (await fetch(`${baseUrl}/live-ai`, { headers: { cookie } })).json();
  assert.equal((await solve()).status, 201);
  const solved = await read();
  assert.equal(solved.status, 'solved');
  assert.equal(solved.can_redraft, false);
  assert.equal(solved.can_request_hand_off, false);
  assert.equal(solved.history.at(-1).description, 'Customer marked conversation solved');
  const tickets = await (await fetch(`${baseUrl}/tickets?status=solved`, { headers: { cookie } })).json();
  assert.ok(tickets.some((ticket: { id: number }) => ticket.id === 1));
  assert.equal((await solve()).status, 409);
  for (const [path, body] of [
    ['messages', { message: 'Another question' }],
    ['hand-off', {}],
    ['generate', {}],
    ['review', { action: 'reply', reply: 'Another answer' }],
    ['review', { action: 'reopen' }],
    ['review', { action: 'priority', priority: 'low' }],
  ] as const) {
    const result = await fetch(`${baseUrl}/tickets/1/${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(result.status, 409, path);
  }
  assert.deepEqual(await read(), solved);
  assert.deepEqual(await (await fetch(`${baseUrl}/live-ai`, { headers: { cookie } })).json(), allowance);
  const otherCookie = (await fetch(`${baseUrl}/tickets`)).headers.get('set-cookie')!.split(';')[0];
  const other = await read(otherCookie);
  assert.equal(other.status, 'open');
  assert.ok(!other.history.some((event: { description: string }) => event.description === 'Customer marked conversation solved'));
});

test('a customer solves an automatic reply once without spending AI allowance', async () => {
  const { cookie, ticket } = await submitAutomaticConversation(baseUrl);
  const allowance = await (await fetch(`${baseUrl}/live-ai`, { headers: { cookie } })).json();
  const solve = () => fetch(`${baseUrl}/tickets/${ticket.id}/solve`, {
    method: 'POST',
    headers: { cookie },
  });
  const responses = await Promise.all([solve(), solve()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const solved = await (await fetch(`${baseUrl}/tickets/${ticket.id}`, { headers: { cookie } })).json();
  assert.equal(solved.status, 'solved');
  assert.equal(solved.approved_reply, ticket.approved_reply);
  assert.deepEqual(solved.decision, ticket.decision);
  assert.equal(solved.history.filter((event: { description: string }) => event.description === 'Customer marked conversation solved').length, 1);
  assert.equal(solved.history.filter((event: { description: string }) => event.description === `Automatic in-app reply: ${ticket.approved_reply}`).length, 1);
  assert.deepEqual(await (await fetch(`${baseUrl}/live-ai`, { headers: { cookie } })).json(), allowance);
  assert.equal((await fetch(`${baseUrl}/tickets/${ticket.id}`)).status, 404);
});

test('customer can ask for a person after an automatic reply without changing the AI decision', async () => {
  const { cookie, ticket: answered } = await submitAutomaticConversation(baseUrl);
  const read = async (sessionCookie?: string) =>
    (await fetch(`${baseUrl}/tickets/${answered.id}`, {
      headers: sessionCookie ? { cookie: sessionCookie } : undefined,
    })).json();
  const original = await read(cookie);
  const allowance = await (await fetch(`${baseUrl}/live-ai`, { headers: { cookie } })).json();

  const result = await fetch(`${baseUrl}/tickets/${answered.id}/hand-off`, {
    method: 'POST',
    headers: { cookie: `${cookie}; demo_seat=customer` },
  });
  assert.equal(result.status, 201);

  const own = await read(cookie);
  assert.equal(own.status, 'open');
  assert.equal(own.review_state, 'reopened');
  assert.equal(own.approved_reply, original.approved_reply);
  assert.deepEqual(own.decision, original.decision);
  assert.ok(own.history.some((event: { description: string }) => event.description === 'Customer asked for a person'));
  assert.ok(own.history.some((event: { description: string }) => event.description === `Automatic in-app reply: ${original.approved_reply}`));
  const ownList = await (await fetch(`${baseUrl}/tickets`, { headers: { cookie } })).json();
  assert.equal(ownList.find((ticket: { id: number }) => ticket.id === answered.id).status, 'open');
  assert.deepEqual(await (await fetch(`${baseUrl}/live-ai`, { headers: { cookie } })).json(), allowance);

  assert.equal((await fetch(`${baseUrl}/tickets/${answered.id}`)).status, 404);
});

test('customer hand-off is only available for an automatic reply before a person replies', async () => {
  const { cookie, ticket: { id } } = await submitAutomaticConversation(baseUrl);
  const read = async (id: number) =>
    (await fetch(`${baseUrl}/tickets/${id}?view=customer`, { headers: { cookie } })).json();
  const handOff = (id: number | string, sessionCookie = cookie) =>
    fetch(`${baseUrl}/tickets/${id}/hand-off`, {
      method: 'POST',
      headers: { cookie: sessionCookie },
    });
  assert.equal((await read(id)).can_request_hand_off, true);
  assert.equal((await read(1)).can_request_hand_off, false);
  assert.equal((await handOff(1)).status, 409);
  assert.equal((await handOff('invalid')).status, 404);
  assert.equal((await handOff(999999)).status, 404);
  assert.equal((await handOff(id, `${cookie}; demo_seat=agent`)).status, 403);

  const review = (action: string, reply?: string) => fetch(`${baseUrl}/tickets/${id}/review`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action, reply, priority: 'normal' }),
  });
  assert.equal((await review('reopen')).status, 409);
  assert.equal((await read(id)).can_request_hand_off, true);
  assert.equal((await review('reply', 'Our team has checked your downloads.')).status, 200);
  const replied = await read(id);
  assert.equal(replied.status, 'waiting_on_customer');
  assert.equal(replied.can_request_hand_off, false);
  assert.equal((await handOff(id)).status, 409);
  assert.ok(!replied.history.some((event: { description: string }) => event.description === 'Customer asked for a person'));
});

test('simultaneous customer hand-offs record one request and an agent reply does not offer another', async () => {
  const { cookie, ticket: { id } } = await submitAutomaticConversation(baseUrl);
  const handOff = () => fetch(`${baseUrl}/tickets/${id}/hand-off`, {
    method: 'POST',
    headers: { cookie },
  });
  const results = await Promise.all([handOff(), handOff()]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const read = async () => (await fetch(`${baseUrl}/tickets/${id}`, { headers: { cookie } })).json();
  const handedOff = await read();
  assert.equal(handedOff.can_request_hand_off, false);
  assert.equal(handedOff.history.filter((event: { description: string }) => event.description === 'Customer asked for a person').length, 1);

  const reply = await fetch(`${baseUrl}/tickets/${id}/review`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'reply', reply: 'Our team has checked the problem.' }),
  });
  assert.equal(reply.status, 200);
  assert.equal((await handOff()).status, 409);
  const replied = await read();
  assert.equal(replied.status, 'waiting_on_customer');
  assert.equal(replied.review_state, 'waiting_on_customer');
  assert.equal(replied.approved_reply, handedOff.approved_reply);
  assert.equal(replied.history.at(-1).description, 'Agent replied: Our team has checked the problem.');
  assert.equal(replied.history.filter((event: { description: string }) => event.description === 'Customer asked for a person').length, 1);
});

test('a customer hands off their newly generated automatic reply without another AI call', async () => {
  await withProvider(
    async (request, response) => {
      const input = await readJson(request);
      const article = input.articles.find((item: { title: string }) => item.title === 'Offline downloads');
      sendJson(response, {
        reply: 'Open a playlist and tap Download. Downloads need a paid plan.',
        suggested_priority: 'normal',
        source_ids: [article.id],
        clearly_covered: true,
        requires_team: false,
      });
    },
    async () => {
      const response = await fetch(`${baseUrl}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'How do I download music for offline listening?' }),
      });
      assert.equal(response.status, 201);
      const cookie = response.headers.get('set-cookie')!.split(';')[0];
      const original = await response.json();
      assert.equal(original.is_sample, false);
      assert.equal(original.status, 'waiting_on_customer');
      assert.equal(original.can_request_hand_off, true);
      assert.equal(original.decision.kind, 'automatic_reply');
      const allowance = await (await fetch(`${baseUrl}/live-ai`, { headers: { cookie } })).json();
      assert.equal(allowance.remaining, 4);
      const handOff = (sessionCookie?: string) => fetch(`${baseUrl}/tickets/${original.id}/hand-off`, {
        method: 'POST',
        headers: sessionCookie ? { cookie: sessionCookie } : undefined,
      });
      assert.equal((await handOff()).status, 404);
      assert.equal((await handOff(cookie)).status, 201);
      const own = await (await fetch(`${baseUrl}/tickets/${original.id}`, { headers: { cookie } })).json();
      assert.equal(own.status, 'open');
      assert.equal(own.can_request_hand_off, false);
      assert.equal(own.approved_reply, original.approved_reply);
      assert.deepEqual(own.decision, original.decision);
      assert.ok(own.history.some((event: { description: string }) => event.description === 'Customer asked for a person'));
      assert.deepEqual(await (await fetch(`${baseUrl}/live-ai`, { headers: { cookie } })).json(), allowance);
    },
  );
});

test('an unsent redraft keeps customer hand-off available after an automatic reply', async () => {
  const { cookie, ticket } = await submitAutomaticConversation(baseUrl);
  await withProvider(
    async (request, response) => {
      const input = await readJson(request);
      const article = input.articles.find((item: { title: string }) => item.title === 'Offline downloads');
      sendJson(response, {
        reply: 'Try downloading a playlist again.',
        suggested_priority: 'normal',
        source_ids: [article.id],
        clearly_covered: true,
        requires_team: false,
      });
    },
    async () => {
      const generated = await fetch(`${baseUrl}/tickets/${ticket.id}/generate`, { method: 'POST', headers: { cookie } });
      assert.equal(generated.status, 200);
      const updated = await generated.json();
      assert.equal(updated.status, 'waiting_on_customer');
      assert.equal(updated.decision.kind, 'hand_off');
      assert.equal(updated.approved_reply, ticket.approved_reply);
      assert.equal(updated.can_request_hand_off, true);
      assert.equal((await fetch(`${baseUrl}/tickets/${ticket.id}/hand-off`, { method: 'POST', headers: { cookie } })).status, 201);
      const handedOff = await (await fetch(`${baseUrl}/tickets/${ticket.id}`, { headers: { cookie } })).json();
      assert.equal(handedOff.status, 'open');
      assert.equal(handedOff.can_request_hand_off, false);
      assert.equal(handedOff.history.at(-1).description, 'Customer asked for a person');
    },
  );
});

test('customer replies stay in their own conversation and return an answered request to the team without AI', async () => {
  const { cookie, ticket: answered } = await submitAutomaticConversation(baseUrl);
  const send = (message: unknown, sessionCookie = cookie, id = answered.id) =>
    fetch(`${baseUrl}/tickets/${id}/messages`, {
      method: 'POST',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  for (const invalid of ['', ' ', 'x'.repeat(5001), 42])
    assert.equal((await send(invalid)).status, 400);
  assert.equal((await send('Message', `${cookie}; demo_seat=agent`)).status, 403);
  assert.equal((await send('Message', cookie, 'invalid')).status, 404);
  const allowance = await (await fetch(`${baseUrl}/live-ai`, { headers: { cookie } })).json();
  const result = await send('  I still need help with my downloads.  ');
  assert.equal(result.status, 201);
  const own = await (await fetch(`${baseUrl}/tickets/${answered.id}?view=customer`, { headers: { cookie } })).json();
  assert.equal(own.status, 'open');
  assert.ok(own.approved_reply);
  assert.ok(own.history.some((event: { description: string }) => event.description === `Automatic in-app reply: ${own.approved_reply}`));
  assert.ok(own.history.some((event: { description: string }) => event.description === 'Customer replied: I still need help with my downloads.'));
  const agent = await (await fetch(`${baseUrl}/tickets/${answered.id}`, { headers: { cookie } })).json();
  assert.equal(agent.draft.state, 'reopened');
  assert.equal((await fetch(`${baseUrl}/tickets/${answered.id}?view=customer`)).status, 404);
  assert.deepEqual(await (await fetch(`${baseUrl}/live-ai`, { headers: { cookie } })).json(), allowance);
  const ownList = await (await fetch(`${baseUrl}/tickets`, { headers: { cookie } })).json();
  assert.equal(ownList.find((ticket: { id: number }) => ticket.id === answered.id).status, 'open');
  const refreshed = await (await fetch(`${baseUrl}/tickets/${answered.id}`, { headers: { cookie } })).json();
  assert.ok(refreshed.history.some((event: { description: string }) => event.description.startsWith('Automatic in-app reply: ')));
});

test('customer follow-ups return a waiting conversation to the team after a priority change', async () => {
  const { cookie, ticket } = await submitAutomaticConversation(baseUrl, 'high');
  const headers = { cookie, 'content-type': 'application/json' };
  const prioritized = await fetch(`${baseUrl}/tickets/${ticket.id}/review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'priority', priority: 'high' }),
  });
  assert.equal(prioritized.status, 200);
  assert.equal((await prioritized.json()).status, 'waiting_on_customer');
  const message = await fetch(`${baseUrl}/tickets/${ticket.id}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: 'Downloads are still not working.' }),
  });
  assert.equal(message.status, 201);
  const updated = await (await fetch(`${baseUrl}/tickets/${ticket.id}`, { headers })).json();
  assert.equal(updated.status, 'open');
  assert.equal(updated.priority, 'high');
  assert.equal(updated.can_request_hand_off, false);
  assert.equal((await fetch(`${baseUrl}/tickets/${ticket.id}/solve`, { method: 'POST', headers })).status, 409);
});

test('the original automatic reply survives customer hand-off and agent replies', async () => {
  const { cookie, ticket: { id } } = await submitAutomaticConversation(baseUrl);
  const read = async () => (await fetch(`${baseUrl}/tickets/${id}`, { headers: { cookie } })).json();
  const original = (await read()).approved_reply;
  const review = (action: string, reply?: string) => fetch(`${baseUrl}/tickets/${id}/review`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action, reply, priority: 'normal' }),
  });
  assert.equal((await fetch(`${baseUrl}/tickets/${id}/hand-off`, { method: 'POST', headers: { cookie } })).status, 201);
  assert.equal((await review('reply', 'Which device are you using?')).status, 200);
  const send = await fetch(`${baseUrl}/tickets/${id}/messages`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'An iPhone.' }),
  });
  assert.equal(send.status, 201);
  const beforeReply = await read();
  const descriptions = beforeReply.history.map((event: { description: string }) => event.description);
  assert.ok(descriptions.indexOf(`Automatic in-app reply: ${original}`) < descriptions.indexOf('Agent replied: Which device are you using?'));
  assert.ok(descriptions.indexOf('Agent replied: Which device are you using?') < descriptions.indexOf('Customer replied: An iPhone.'));
  assert.equal((await review('reply', 'Restart your phone and try the download again.')).status, 200);
  const afterReply = await read();
  assert.equal(afterReply.approved_reply, original);
  assert.equal(afterReply.history.at(-1).description, 'Agent replied: Restart your phone and try the download again.');
  assert.equal(afterReply.history.filter((event: { description: string }) => event.description === `Automatic in-app reply: ${original}`).length, 1);

  const { cookie: otherCookie, ticket: otherTicket } = await submitAutomaticConversation(baseUrl);
  assert.equal((await fetch(`${baseUrl}/tickets/${otherTicket.id}/review`, {
    method: 'POST',
    headers: { cookie: otherCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'reply', reply: 'Try another device.', priority: 'normal' }),
  })).status, 200);
  const replaced = await (await fetch(`${baseUrl}/tickets/${otherTicket.id}`, { headers: { cookie: otherCookie } })).json();
  assert.ok(replaced.history.some((event: { description: string }) => event.description === `Automatic in-app reply: ${original}`));
});

test('simultaneous customer replies preserve one original answer and an agent reply sent meanwhile', async () => {
  const { cookie, ticket: { id } } = await submitAutomaticConversation(baseUrl);
  const send = (id: number, message: string) => fetch(`${baseUrl}/tickets/${id}/messages`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const results = await Promise.all([send(id, 'First follow-up'), send(id, 'Second follow-up')]);
  assert.deepEqual(results.map((result) => result.status), [201, 201]);
  const answered = await (await fetch(`${baseUrl}/tickets/${id}`, { headers: { cookie } })).json();
  assert.equal(answered.history.filter((event: { description: string }) => event.description.startsWith('Automatic in-app reply: ')).length, 1);
  assert.equal(answered.history.filter((event: { description: string }) => event.description.startsWith('Customer replied: ')).length, 2);
  assert.equal((await send(1, 'Initial details')).status, 201);
  const [message, agentReply] = await Promise.all([
    send(1, 'More details for the team'),
    fetch(`${baseUrl}/tickets/1/review`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reply', reply: 'Thanks, checking now.' }),
    }),
  ]);
  assert.equal(message.status, 201);
  assert.equal(agentReply.status, 200);
  const both = await (await fetch(`${baseUrl}/tickets/1`, { headers: { cookie } })).json();
  const descriptions = both.history.map((event: { description: string }) => event.description);
  assert.ok(descriptions.includes('Customer replied: More details for the team'));
  assert.ok(descriptions.includes('Agent replied: Thanks, checking now.'));
});

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
      assert.equal(automatic.status, 'solved');
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
  const sentReply = await fetch(`${baseUrl}/tickets/1/review`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'reply',
      reply: 'Please resend the invitations.',
    }),
  });
  assert.equal(sentReply.status, 200);
  assert.equal((await sentReply.json()).review_state, 'waiting_on_customer');
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
  const reply = (cookie: string) => fetch(`${baseUrl}/tickets/${ticket.id}/messages`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'I have more details.' }),
  });
  assert.equal((await reply(secondCookie)).status, 404);
  assert.equal((await reply(firstCookie)).status, 201);
  const replied = await (await fetch(`${baseUrl}/tickets/${ticket.id}`, { headers: { cookie: firstCookie } })).json();
  assert.ok(replied.history.some((event: { description: string }) => event.description === 'Customer replied: I have more details.'));
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
        action: 'reply',
        reply: 'Please resend the invitations.',
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
  assert.equal(other.status, 'waiting_on_customer');
  assert.equal(other.review_state, 'waiting_on_customer');
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
