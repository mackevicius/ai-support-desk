import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJson, sendJson, startInbox, withProvider } from './helpers.js';

const { baseUrl } = await startInbox();

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
        const redraft = await fetch(
          `${baseUrl}/tickets/${ticket.id}/generate`,
          {
            method: 'POST',
            headers: { cookie },
          },
        );
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
    },
  );
});

test('redrafting a reopened automatic reply stays open and cannot overwrite approval', async () => {
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
        const redraft = await fetch(
          `${baseUrl}/tickets/${ticket.id}/generate`,
          {
            method: 'POST',
            headers,
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
      }
    },
  );
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
