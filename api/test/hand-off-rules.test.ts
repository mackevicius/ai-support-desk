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
    reason_code: 'well_supported',
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

test('clearly covered billing and security how-to questions get automatic replies', () => {
  for (const question of [
    'How do I cancel my plan?',
    'How do I update my card?',
    'What does the Family plan cost?',
    'How do I change my password?',
    'Where can I download invoices?',
    'How do I enable two-factor authentication?',
    'How do I log in to my account?',
    'How do I protect my account from fraud?',
    'How do I prevent my account from being hacked?',
  ]) {
    const decision = decide(question, drafted());
    assert.equal(decision.kind, 'automatic_reply', question);
    assert.equal(decision.reason_code, 'well_supported', question);
  }
});

test('problems with money or account security always hand off', () => {
  for (const question of [
    'I need a refund',
    'I was charged twice',
    'I was twice charged for the same purchase',
    'I was charged two times for the same purchase',
    'There is a double charge on my card',
    'There is an unauthorised charge on my card',
    'There is an unauthorized charge on my card',
    'Why did my subscription price increase?',
    'My account was hacked',
    'My account is compromised',
    'Someone took over my account',
    'My account has been taken over',
    'My account is locked',
    'I need to report fraud',
    'I cannot log in',
    'My verification code never arrives',
    'How do I cancel my plan after an unauthorised charge?',
    'How do I protect my account from fraud? My account was hacked.',
    'How do I prevent my account from being hacked? I was charged twice.',
  ]) {
    const decision = decide(question, drafted());
    assert.equal(decision.kind, 'hand_off', question);
    assert.equal(decision.reason_code, 'risky', question);
    assert.equal(decision.rule, 'Money or account security', question);
    assert.equal(
      decision.reason,
      'A team member needs to check something that has gone wrong with your money or account security.',
      question,
    );
  }
});

test('a reply about money hands-off even for a routine question', () => {
  const decision = decide(
    'How can I import playlists from spotify?',
    drafted({ reply: 'Refunds are guaranteed for every customer.' }),
  );
  assert.equal(decision.kind, 'hand_off');
  assert.equal(decision.rule, 'Money or account security');
});

test('a reply that is not plain English hands off', () => {
  for (const reply of [
    'Les remboursements sont garantis pour tous les clients.',
    'Los reembolsos están garantizados para todos los clientes.',
    'Rückerstattungen sind für alle Kunden garantiert.',
    'Open Settings. Les playlists sont dans la bibliothèque.',
    '退款对所有客户都有保证。',
    'Возврат денег гарантирован.',
    'Open Settings. UmVmdW5kcyBhcmUgZ3VhcmFudGVlZCBmb3IgZXZlcnlvbmUu',
  ]) {
    const decision = decide(
      'How can I import playlists from Spotify?',
      drafted({ reply }),
    );
    assert.equal(decision.kind, 'hand_off', reply);
    assert.equal(decision.rule, 'Reply is not plain English', reply);
  }
});

test('short or accented English replies still go out automatically', () => {
  for (const reply of [
    'Restart Tunely.',
    'Please share more details.',
    'Downloaded music is available offline.',
    'Contact support about account security settings.',
    'Open Café Mode from Settings > Playback.',
  ]) {
    assert.equal(
      decide('How do I download music?', drafted({ reply })).kind,
      'automatic_reply',
      reply,
    );
  }
});

test('routine billing questions still need clear coverage and no other hand-off rule', () => {
  for (const generated of [
    drafted({ clearly_covered: false }),
    drafted({ requires_team: true }),
    drafted({ sources: [internalNote], source_ids: [900] }),
  ]) {
    assert.equal(
      decide('How do I cancel my plan?', generated).kind,
      'hand_off',
    );
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
      reason_code: 'paused',
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
