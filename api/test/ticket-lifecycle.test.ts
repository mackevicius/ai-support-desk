import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  createTicketLifecycle,
  type TicketAction,
  type Visitor,
} from '../src/ticket-lifecycle.js';
import { startInbox } from './helpers.js';

const { pool } = await startInbox();

type Ticket = NonNullable<
  Awaited<ReturnType<Parameters<typeof createTicketLifecycle>[1]['read']>>
>;

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    status: 'open',
    review_state: null,
    priority: 'normal',
    approved_reply: null,
    created_at: '2026-09-20T10:00:00.000Z',
    can_request_hand_off: false,
    decision: null,
    history: [],
    draft: null,
    ...overrides,
  };
}

function lifecycleFor(current: Ticket) {
  let reads = 0;
  const lifecycle = createTicketLifecycle(pool, {
    read: async () => {
      reads++;
      return current;
    },
    checkCopies: async () => [],
  });
  return { apply: lifecycle.apply, reads: () => reads };
}

const customer = (): Visitor => ({
  session: randomUUID(),
  owner: false,
  seat: 'customer',
});
const agent = (): Visitor => ({
  session: randomUUID(),
  owner: false,
  seat: 'agent',
});

async function eventsFor(session: string) {
  return (
    await pool.query(
      'SELECT description FROM ticket_events WHERE session_id = $1 ORDER BY id',
      [session],
    )
  ).rows.map((row: { description: string }) => row.description);
}

test('the agent seat cannot take customer actions, and nothing is read', async () => {
  const { apply, reads } = lifecycleFor(
    ticket({ status: 'waiting_on_customer', can_request_hand_off: true }),
  );
  for (const action of [
    { type: 'solve' },
    { type: 'hand_off' },
    { type: 'message', text: 'Still broken' },
  ] satisfies TicketAction[])
    assert.equal(
      (await apply('1', agent(), action)).kind,
      'forbidden',
      action.type,
    );
  assert.equal(reads(), 0);
});

test('each action is only available from the right ticket state', async () => {
  const cases: [Partial<Ticket>, TicketAction, string][] = [
    [{ status: 'open' }, { type: 'solve' }, 'unavailable'],
    [{ status: 'solved' }, { type: 'solve' }, 'unavailable'],
    [{ status: 'waiting_on_customer' }, { type: 'hand_off' }, 'unavailable'],
    [{ status: 'solved' }, { type: 'message', text: 'Hello' }, 'unavailable'],
    [{ status: 'solved' }, { type: 'reply', text: 'Hello' }, 'unavailable'],
    [{ status: 'open' }, { type: 'priority', priority: 'high' }, 'unavailable'],
    [
      { draft: { state: 'saved', suggested_priority: 'high', sources: [] } },
      { type: 'priority', priority: 'low' },
      'unavailable',
    ],
    [{ status: 'open' }, { type: 'reply', text: '   ' }, 'invalid'],
  ];
  for (const [state, action, expected] of cases) {
    const { apply } = lifecycleFor(ticket(state));
    const visitor =
      action.type === 'reply' || action.type === 'priority'
        ? agent()
        : customer();
    assert.equal(
      (await apply('1', visitor, action)).kind,
      expected,
      `${action.type} from ${JSON.stringify(state)}`,
    );
  }
});

test('an empty customer message is rejected before the ticket is read', async () => {
  const { apply, reads } = lifecycleFor(ticket());
  assert.equal(
    (await apply('1', customer(), { type: 'message', text: ' ' })).kind,
    'invalid',
  );
  assert.equal(
    (await apply('1', customer(), { type: 'message', text: 'x'.repeat(5001) }))
      .kind,
    'invalid',
  );
  assert.equal(reads(), 0);
});

test('unknown tickets are not found', async () => {
  const { apply } = lifecycleFor(ticket());
  assert.equal(
    (await apply('abc', customer(), { type: 'solve' })).kind,
    'not_found',
  );
  const missing = createTicketLifecycle(pool, {
    read: async () => null,
    checkCopies: async () => [],
  });
  assert.equal(
    (await missing.apply('999', customer(), { type: 'solve' })).kind,
    'not_found',
  );
});

test('solving records the review and event once; a second solve from the same read conflicts', async () => {
  const visitor = customer();
  const { apply } = lifecycleFor(ticket({ status: 'waiting_on_customer' }));
  assert.equal((await apply('1', visitor, { type: 'solve' })).kind, 'ok');
  assert.equal((await apply('1', visitor, { type: 'solve' })).kind, 'conflict');
  const review = await pool.query(
    'SELECT state FROM ticket_reviews WHERE session_id = $1 AND ticket_id = 1',
    [visitor.session],
  );
  assert.deepEqual(review.rows, [{ state: 'solved' }]);
  assert.deepEqual(await eventsFor(visitor.session), [
    'Customer marked conversation solved',
  ]);
});

test('a customer action archives a delivered automatic reply before its own event', async () => {
  const visitor = customer();
  const { apply } = lifecycleFor(
    ticket({
      status: 'waiting_on_customer',
      approved_reply: 'Open a playlist and tap Download.',
      can_request_hand_off: true,
      decision: {
        kind: 'automatic_reply',
        documents: [{ kind: 'help_article' }],
      },
    }),
  );
  assert.equal((await apply('2', visitor, { type: 'hand_off' })).kind, 'ok');
  assert.deepEqual(await eventsFor(visitor.session), [
    'Automatic in-app reply: Open a playlist and tap Download.',
    'Customer asked for a person',
  ]);
});

test('an agent reply that copies internal text is held until confirmed', async () => {
  const visitor = agent();
  const copies = [{ start: 0, end: 5, text: 'Clear' }];
  const lifecycle = createTicketLifecycle(pool, {
    read: async () => ticket(),
    checkCopies: async () => copies,
  });
  const reply = { type: 'reply', text: 'Clear the cache.' } as const;
  assert.deepEqual(await lifecycle.apply('3', visitor, reply), {
    kind: 'internal_copies',
    copies,
  });
  assert.deepEqual(await eventsFor(visitor.session), []);
  assert.equal(
    (
      await lifecycle.apply('3', visitor, {
        ...reply,
        internalConfirmed: 'Clear the cache.',
      })
    ).kind,
    'ok',
  );
  assert.deepEqual(await eventsFor(visitor.session), [
    'Agent replied: Clear the cache.',
  ]);
});
