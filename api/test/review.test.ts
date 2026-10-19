import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJson, sendJson, startInbox, withProvider } from './helpers.js';

const { pool, baseUrl } = await startInbox();

test('an agent reply is sent and leaves the ticket waiting on the customer', async () => {
  const cookie = (await fetch(`${baseUrl}/tickets`)).headers
    .get('set-cookie')!
    .split(';')[0];
  const review = (body: object) =>
    fetch(`${baseUrl}/tickets/1/review`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  for (const action of ['approve', 'ask', 'reject'])
    assert.equal(
      (await review({ action, reply: 'Old action', priority: 'low' })).status,
      409,
    );
  for (const reply of [undefined, '', '   ', 'x'.repeat(5001)])
    assert.equal((await review({ action: 'reply', reply })).status, 400);

  const sent = await review({
    action: 'reply',
    reply: '  Please create a new invitation.  ',
    priority: 'low',
  });
  assert.equal(sent.status, 200);
  const ticket = await sent.json();
  assert.equal(ticket.status, 'waiting_on_customer');
  assert.equal(ticket.priority, 'high');
  assert.equal(ticket.approved_reply, null);
  assert.equal(
    ticket.history.at(-1).description,
    'Agent replied: Please create a new invitation.',
  );
  const again = await (
    await review({ action: 'reply', reply: 'Did the new link work?' })
  ).json();
  assert.equal(again.status, 'waiting_on_customer');
  assert.deepEqual(
    again.history
      .map((event: { description: string }) => event.description)
      .filter((description: string) =>
        description.startsWith('Agent replied: '),
      ),
    [
      'Agent replied: Please create a new invitation.',
      'Agent replied: Did the new link work?',
    ],
  );
});

test('a risky live draft can be reviewed by the visitor acting as a support agent', async () => {
  await withProvider(
    async (request, response) => {
      const input = await readJson(request);
      const article = input.articles.find(
        (item: { title: string }) => item.title === 'Offline downloads',
      );
      sendJson(response, {
        reply: 'Your refund is approved.',
        suggested_priority: 'high',
        topic: 'refund',
        source_ids: [article.id],
        clearly_covered: true,
        requires_team: false,
      });
    },
    async () => {
      const response = await fetch(`${baseUrl}/tickets`, {
        method: 'POST',
        headers: {
          cookie: 'demo_seat=agent',
          'content-type': 'application/json',
        },
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
          action: 'reply',
          reply: 'Which dates were the two charges taken?',
        }),
      });
      assert.equal(asked.status, 200);
      const waiting = await asked.json();
      assert.equal(waiting.status, 'waiting_on_customer');
      assert.ok(
        waiting.history.some(
          (event: { description: string }) =>
            event.description ===
            'Agent replied: Which dates were the two charges taken?',
        ),
      );
      for (let remaining = 3; remaining >= 0; remaining--) {
        const redraft = await fetch(
          `${baseUrl}/tickets/${ticket.id}/generate`,
          {
            method: 'POST',
            headers: { cookie },
          },
        );
        assert.equal(redraft.status, 200);
        const redrafted = await redraft.json();
        assert.equal(redrafted.status, 'waiting_on_customer');
        assert.equal(redrafted.live_ai.remaining, remaining);
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
      const replied = await fetch(`${baseUrl}/tickets/${ticket.id}/review`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'reply',
          reply: 'Our team will check the two charges.',
        }),
      });
      assert.equal(replied.status, 200);
      const delivered = await replied.json();
      assert.equal(delivered.status, 'waiting_on_customer');
      assert.equal(
        delivered.history.at(-1).description,
        'Agent replied: Our team will check the two charges.',
      );
    },
  );
});

test('redrafting a handed-off automatic reply keeps an agent reply sent meanwhile', async () => {
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
  await withProvider(
    async (request, response) => {
      const input = await readJson(request);
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
      sendJson(response, {
        reply: initial
          ? 'Open a playlist and tap Download.'
          : 'A replacement draft requiring review.',
        topic: initial ? 'Offline downloads' : 'Audio quality',
        suggested_priority: initial ? 'normal' : 'high',
        source_ids: [article.id],
        clearly_covered: initial,
        requires_team: false,
      });
    },
    async () => {
      try {
        const submitted = await fetch(`${baseUrl}/tickets`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: 'How do I download music?' }),
        });
        const cookie = submitted.headers.get('set-cookie')!.split(';')[0];
        const ticket = await submitted.json();
        assert.equal(ticket.status, 'waiting_on_customer');
        const headers = { cookie, 'content-type': 'application/json' };
        assert.equal(
          (
            await fetch(`${baseUrl}/tickets/${ticket.id}/hand-off`, {
              method: 'POST',
              headers,
            })
          ).status,
          201,
        );
        const redraft = await fetch(
          `${baseUrl}/tickets/${ticket.id}/generate`,
          {
            method: 'POST',
            headers: { cookie: `${cookie}; demo_seat=agent` },
          },
        );
        assert.equal(redraft.status, 200);
        const updated = await redraft.json();
        assert.equal(updated.status, 'open');
        assert.equal(updated.approved_reply, ticket.approved_reply);
        assert.equal(updated.decision.kind, 'hand_off');
        assert.equal(updated.decision.topic, 'Audio quality');
        assert.equal(updated.decision.suggested_priority, 'high');
        assert.equal(
          updated.decision.documents[0].title,
          'Changing audio quality',
        );
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
        const replied = await fetch(`${baseUrl}/tickets/${ticket.id}/review`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            action: 'reply',
            reply: 'An agent checked this reply.',
          }),
        });
        assert.equal(replied.status, 200);
        releaseGeneration();
        assert.equal((await pending).status, 409);
        const saved = await (
          await fetch(`${baseUrl}/tickets/${ticket.id}`, { headers })
        ).json();
        assert.equal(saved.status, 'waiting_on_customer');
        assert.equal(saved.approved_reply, ticket.approved_reply);
        assert.ok(
          saved.history.some(
            (event: { description: string }) =>
              event.description ===
              'Agent replied: An agent checked this reply.',
          ),
        );
      } finally {
        releaseGeneration();
      }
    },
  );
});

test('an agent reply stays in the visitor session', async () => {
  const first = await fetch(`${baseUrl}/tickets`);
  const firstCookie = first.headers.get('set-cookie')!.split(';')[0];
  const second = await fetch(`${baseUrl}/tickets`);
  const secondCookie = second.headers.get('set-cookie')!.split(';')[0];
  const initial = await (
    await fetch(`${baseUrl}/tickets/1`, {
      headers: { cookie: `${firstCookie}; demo_seat=agent` },
    })
  ).json();
  assert.equal(initial.status, 'open');
  assert.equal(initial.priority, 'high');
  assert.equal(initial.draft.state, 'saved');
  assert.ok(initial.draft.reply.includes('invitation'));
  assert.ok(initial.draft.sources[0].body.includes('invitation'));

  const replied = await fetch(`${baseUrl}/tickets/1/review`, {
    method: 'POST',
    headers: { cookie: firstCookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'reply',
      reply: 'Please resend the invitations.',
    }),
  });
  assert.equal(replied.status, 200);
  const reviewed = await replied.json();
  assert.equal(
    reviewed.history.at(-1).description,
    'Agent replied: Please resend the invitations.',
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
      event.description.startsWith('Agent replied: '),
    ),
  );
});

test('the agent reopen action is unavailable and a reply needs no draft', async () => {
  await pool.query('DELETE FROM saved_drafts WHERE ticket_id = 2');
  const inbox = await fetch(`${baseUrl}/tickets`);
  const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
  const review = (id: number, body: object) =>
    fetch(`${baseUrl}/tickets/${id}/review`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal((await review(2, { action: 'reopen' })).status, 409);
  assert.equal(
    (await review(5, { action: 'reply', reply: 'No draft' })).status,
    409,
  );
  const unchanged = await (
    await fetch(`${baseUrl}/tickets/2`, { headers: { cookie } })
  ).json();
  assert.equal(unchanged.status, 'open');
  assert.equal(unchanged.priority, 'normal');
  assert.equal(unchanged.history.length, 2);

  assert.equal((await review(5, { action: 'reopen' })).status, 409);
  const manual = await (
    await review(2, {
      action: 'reply',
      reply: 'Downloaded music is available offline.',
    })
  ).json();
  assert.equal(manual.status, 'waiting_on_customer');
  assert.equal(manual.draft, null);
  assert.equal(
    manual.history.at(-1).description,
    'Agent replied: Downloaded music is available offline.',
  );
});

test('only one simultaneous agent reply changes an unreviewed request', async () => {
  const inbox = await fetch(`${baseUrl}/tickets`);
  const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
  const submit = () =>
    fetch(`${baseUrl}/tickets/1/review`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'reply',
        reply: 'Our team is checking this.',
      }),
    });
  const responses = await Promise.all([submit(), submit()]);
  const ticket = await (
    await fetch(`${baseUrl}/tickets/1`, { headers: { cookie } })
  ).json();
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 409],
  );
  assert.equal(
    ticket.history.filter(
      (event: { description: string }) =>
        event.description === 'Agent replied: Our team is checking this.',
    ).length,
    1,
  );
});
