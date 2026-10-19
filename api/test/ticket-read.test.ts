import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startInbox } from './helpers.js';

const { baseUrl } = await startInbox();

const customerDecision = [
  'internal_count',
  'kind',
  'paused',
  'reason',
  'sources',
];

test('a ticket read without a seat is the customer view', async () => {
  const ticket = await (await fetch(`${baseUrl}/tickets/1`)).json();
  assert.equal(ticket.draft, null);
  assert.deepEqual(Object.keys(ticket.decision).sort(), customerDecision);
});

test('the agent seat reads the draft and the documents behind the decision', async () => {
  const ticket = await (
    await fetch(`${baseUrl}/tickets/1`, {
      headers: { cookie: 'demo_seat=agent' },
    })
  ).json();
  assert.ok(ticket.draft.reply);
  assert.ok(Array.isArray(ticket.decision.documents));
  assert.ok(ticket.decision.reason_code);
});

test('a submitted question answers the customer with the customer view', async () => {
  const response = await fetch(`${baseUrl}/tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'How do I download music?' }),
  });
  assert.equal(response.status, 201);
  const ticket = await response.json();
  assert.equal(ticket.draft, null);
  assert.deepEqual(Object.keys(ticket.decision).sort(), customerDecision);
});
