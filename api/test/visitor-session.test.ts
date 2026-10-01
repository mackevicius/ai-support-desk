import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startInbox, withProvider } from './helpers.js';

const { pool, baseUrl } = await startInbox();

test('a new visitor sees five saved Tunely outcomes without an AI call', async () => {
  let calls = 0;
  await withProvider((_request, response) => {
    calls++;
    response.writeHead(500).end();
  }, async () => {
    const inbox = await fetch(`${baseUrl}/tickets`);
    const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
    const tickets = await inbox.json();
    assert.equal(tickets.length, 5);
    const details = await Promise.all(tickets.map(async (ticket: { id: number }) =>
      (await fetch(`${baseUrl}/tickets/${ticket.id}`, { headers: { cookie } })).json(),
    ));
    assert.deepEqual(details.sort((first, second) => first.id - second.id)
      .map((ticket) => ticket.decision?.reason_code),
    ['uncertain', 'internal_note', 'risky', 'knowledge_gap', 'well_supported']);
    assert.ok(details.every((ticket) => ticket.draft?.reply));
    const automatic = details.find((ticket) => ticket.id === 5);
    assert.equal(automatic.status, 'resolved');
    assert.equal(automatic.approved_reply, automatic.draft.reply);
    assert.equal(details[1].draft.sources[0].kind, 'internal_note');
    assert.equal(details[3].draft.sources.length, 0);
    assert.equal(calls, 0);
  });
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
