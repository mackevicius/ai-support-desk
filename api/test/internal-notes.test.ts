import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareDatabase } from '../src/schema.js';
import { sendJson, startInbox, withProvider } from './helpers.js';

const { pool, baseUrl } = await startInbox();

test('an uncited internal phrase prevents automatic delivery and warns the agent', async () => {
  const phrase =
    'The confidential playback workaround requires clearing the device entitlement cache';
  await pool.query(
    "INSERT INTO help_articles (id, title, body, kind) VALUES (900, 'Private playback incident', $1, 'internal_note')",
    [phrase],
  );
  let calls = 0;
  let sourceIds = [1];
  let editDuringGeneration = false;
  try {
    await withProvider(
      async (_request, response) => {
        calls++;
        if (editDuringGeneration)
          await pool.query(
            "UPDATE help_articles SET body = 'The workaround has changed.' WHERE id = 900",
          );
        sendJson(response, {
          reply: phrase,
          topic: 'Private playback incident',
          suggested_priority: 'normal',
          source_ids: sourceIds,
          clearly_covered: true,
          requires_team: false,
        });
      },
      async () => {
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
        assert.ok(
          !JSON.stringify(customer).includes('Private playback incident'),
        );
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
        await pool.query(
          'UPDATE help_articles SET retired = true WHERE id = 900',
        );
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
      },
    );
  } finally {
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
  let reclassify = false;
  try {
    await withProvider(
      async (_request, response) => {
        if (reclassify)
          await pool.query(
            "UPDATE help_articles SET kind = 'internal_note' WHERE id = 902",
          );
        sendJson(response, {
          reply: phrase,
          source_ids: [902],
          suggested_priority: 'normal',
          clearly_covered: true,
          requires_team: false,
        });
      },
      async () => {
        const first = await fetch(`${baseUrl}/tickets`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            question: 'How does playback recovery work?',
          }),
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
      },
    );
  } finally {
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
