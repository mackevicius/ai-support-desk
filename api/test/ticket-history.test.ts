import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  readHistory,
  recordHistory,
  type HistoryEntry,
} from '../src/ticket-history.js';
import { startInbox } from './helpers.js';

const { pool } = await startInbox();
const shared = (await readHistory(pool, '1', randomUUID())).length;

const visitorEvents = async (session: string) =>
  (await readHistory(pool, '1', session)).slice(shared);

const entries = async (session: string) =>
  (await visitorEvents(session)).map((event) =>
    'text' in event
      ? { kind: event.kind, text: event.text }
      : { kind: event.kind },
  );

test('every recorded entry reads back with its kind and text', async () => {
  const session = randomUUID();
  const recorded: HistoryEntry[] = [
    { kind: 'automatic_reply_decided', text: 'A help article covers it.' },
    { kind: 'automatic_reply', text: 'Open a playlist and tap Download.' },
    { kind: 'customer_message', text: 'Still broken' },
    { kind: 'customer_hand_off' },
    { kind: 'redraft_requested' },
    { kind: 'priority_approved', text: 'high' },
    { kind: 'agent_reply', text: 'Agent replied: quoting is fine' },
    { kind: 'solved' },
  ];
  for (const entry of recorded) await recordHistory(pool, 1, session, entry);
  assert.deepEqual(await entries(session), recorded);
});

test('history keeps the stored wording, so saved descriptions stay readable', async () => {
  const session = randomUUID();
  await recordHistory(pool, 1, session, { kind: 'agent_reply', text: 'Done.' });
  await recordHistory(pool, 1, session, {
    kind: 'priority_approved',
    text: 'low',
  });
  assert.deepEqual(
    (await visitorEvents(session)).map((event) => event.description),
    ['Agent replied: Done.', 'Human approved low priority suggestion'],
  );
});

test('only one automatic reply is shown per visitor copy', async () => {
  const session = randomUUID();
  const shown = { kind: 'automatic_reply', text: 'Tap Download.' } as const;
  await recordHistory(pool, 1, session, shown);
  await recordHistory(pool, 1, session, shown);
  assert.equal(
    (await visitorEvents(session)).filter(
      (event) => event.kind === 'automatic_reply',
    ).length,
    1,
  );
});

test('unknown wording reads back as other with the full text', async () => {
  const session = randomUUID();
  await pool.query(
    `INSERT INTO ticket_events (id, ticket_id, session_id, description, created_at)
     VALUES (nextval('ticket_event_ids'), 1, $1, 'Legacy note', $2)`,
    [session, new Date().toISOString()],
  );
  assert.deepEqual(await entries(session), [
    { kind: 'other', text: 'Legacy note' },
  ]);
});
