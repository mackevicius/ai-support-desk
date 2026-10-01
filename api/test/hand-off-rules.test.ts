import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide } from '../src/answer-drafting.js';

const helpArticle = {
  id: 5,
  title: 'Offline downloads',
  body: 'Open a playlist and tap Download.',
  kind: 'help_article',
};
const internalNote = {
  id: 900,
  title: 'Staff playback incident',
  body: 'Clear the entitlement cache.',
  kind: 'internal_note',
};

function drafted(overrides: object = {}) {
  return {
    draft: {
      reply: 'Open a playlist and tap Download.',
      topic: 'Offline downloads',
      suggested_priority: 'normal',
      source_ids: [5],
      clearly_covered: true,
      requires_team: false,
      sources: [helpArticle],
      internal_copies: [],
      ...overrides,
    },
  };
}

test('a clearly covered, safe question gets an automatic reply', () => {
  assert.deepEqual(decide('How do I download music?', drafted()), {
    kind: 'automatic_reply',
    rule: 'Clearly covered by public help articles',
    reason:
      'A help article clearly covers your question, and it does not need a team member to check it.',
    topic: 'Offline downloads',
    suggested_priority: 'normal',
    documents: [{ id: 5, title: 'Offline downloads', kind: 'help_article' }],
    sources: [helpArticle],
    paused: false,
  });
});

test('money and account security questions always hand off', () => {
  for (const question of [
    'I need a refund',
    'I was charged twice',
    'Why did my subscription price increase?',
    'My account was hacked',
    'I cannot log in',
    'My verification code never arrives',
  ]) {
    const decision = decide(question, drafted());
    assert.equal(decision.kind, 'hand_off', question);
    assert.equal(decision.rule, 'Money or account security', question);
  }
});

test('an answer relying on an internal note hands off and hides the note from customer sources', () => {
  const decision = decide(
    'Why does playback stop?',
    drafted({ sources: [helpArticle, internalNote], source_ids: [5, 900] }),
  );
  assert.equal(decision.kind, 'hand_off');
  assert.equal(decision.rule, 'Staff-only information');
  assert.deepEqual(decision.sources, [helpArticle]);
  assert.deepEqual(decision.documents, [
    { id: 5, title: 'Offline downloads', kind: 'help_article' },
    { id: 900, title: 'Staff playback incident', kind: 'internal_note' },
  ]);
});

test('a reply that copies internal note text hands off', () => {
  const decision = decide(
    'Why does playback stop?',
    drafted({
      internal_copies: [
        { start: 0, end: 28, text: 'Clear the entitlement cache.' },
      ],
    }),
  );
  assert.equal(decision.kind, 'hand_off');
  assert.equal(decision.rule, 'Staff-only information');
});

test('weak coverage hands off', () => {
  for (const generated of [
    drafted({ clearly_covered: false }),
    drafted({ clearly_covered: undefined }),
    drafted({ sources: [], source_ids: [] }),
    { error: 'unavailable' as const },
  ]) {
    const decision = decide('How do I download music?', generated);
    assert.equal(decision.kind, 'hand_off');
    assert.equal(decision.rule, 'Weak help article coverage');
  }
});

test('the provider can ask for team review, and must say when it does not', () => {
  for (const requires_team of [true, undefined]) {
    const decision = decide(
      'How do I download music?',
      drafted({ requires_team }),
    );
    assert.equal(decision.kind, 'hand_off');
    assert.equal(decision.rule, 'Provider requested team review');
  }
});

test('an agent-requested redraft always needs approval', () => {
  const decision = decide('How do I download music?', drafted(), true);
  assert.equal(decision.kind, 'hand_off');
  assert.equal(decision.rule, 'Agent review required');
});

test('an exhausted live allowance hands off with an unclassified topic', () => {
  assert.deepEqual(
    decide('How do I download music?', { error: 'paused' as const }),
    {
      kind: 'hand_off',
      rule: 'Live allowance exhausted',
      reason: 'Live AI is paused for today',
      topic: 'Unclassified',
      suggested_priority: 'normal',
      documents: [],
      sources: [],
      paused: true,
    },
  );
});
