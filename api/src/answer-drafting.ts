import type { Pool } from 'pg';
import { generateDraft, type Generation } from './generation.js';
import { recordHistory } from './ticket-history.js';

type Generated = Awaited<ReturnType<typeof generateDraft>>;
type Database = Pick<Pool, 'query'>;

export function decide(
  question: string,
  generated: Generated,
  agentReview = false,
) {
  const draft = generated.draft;
  const securityProblems = question.replace(
    /\bhow (?:do|can|should) (?:i|we) (?:protect (?:my|our) accounts? (?:from|against)|prevent (?:my|our) accounts? from being|prevent|avoid) (?:fraud|hacking|hacked|compromised)\b/gi,
    '',
  );
  const risky =
    /\b(refunds?|hack(?:ed|ing)?|compromis(?:e|ed)|breach(?:ed)?|stolen|unauthori[sz]ed|locked|fraud)\b|\b(?:took|taken) over (?:my|our|the) account\b|\baccount (?:was|has been) taken over\b/i.test(
      securityProblems,
    ) ||
    /\b(?:charg(?:e|ed|es|ing)|bill(?:ed|s|ing)?|pay(?:ment|ments|ing)?|paid)\b.*\b(?:twice|two times|double|duplicate|unexpected|incorrect|wrong|extra|unrecogni[sz]ed)\b|\b(?:twice|two times|double|duplicate|unexpected|incorrect|wrong|extra|unrecogni[sz]ed)\b.*\b(?:charg(?:e|ed|es|ing)|bill(?:ed|s|ing)?|pay(?:ment|ments|ing)?|paid)\b/i.test(
      question,
    ) ||
    /\b(?:price|cost)\b.*\bincreas(?:e|ed)\b|\b(?:cannot|can't|unable to)\s+(?:log[ -]?in|sign[ -]?in)\b|\bverification code\b.*\b(?:never|not)\b/i.test(
      question,
    );
  const internal = draft?.sources.some(
    (source) => source.kind !== 'help_article',
  );
  const copied = !!draft?.internal_copies.length;
  const covered = draft?.clearly_covered === true && draft.sources.length > 0;
  const automatic =
    covered &&
    draft?.requires_team === false &&
    !internal &&
    !copied &&
    !risky &&
    !agentReview;
  const outcome =
    generated.error === 'paused'
      ? {
          reason_code: 'paused',
          rule: 'Live allowance exhausted',
          reason: 'Live AI is paused for today',
        }
      : risky
        ? {
            reason_code: 'risky',
            rule: 'Money or account security',
            reason:
              'A team member needs to check something that has gone wrong with your money or account security.',
          }
        : internal || copied
          ? {
              reason_code: 'internal_note',
              rule: 'Staff-only information',
              reason:
                'The answer relies on information meant for Tunely staff.',
            }
          : !covered
            ? {
                reason_code:
                  generated.error ??
                  (!draft?.sources.length ? 'knowledge_gap' : 'uncertain'),
                rule: 'Weak help article coverage',
                reason:
                  'There is not enough clear help article coverage to answer automatically.',
              }
            : draft?.requires_team !== false
              ? {
                  reason_code: 'uncertain',
                  rule: 'Provider requested team review',
                  reason:
                    'A team member needs to check this question before we can answer.',
                }
              : agentReview
                ? {
                    reason_code: 'agent_review',
                    rule: 'Agent review required',
                    reason:
                      'An agent requested a new draft; it needs approval before delivery.',
                  }
                : {
                    reason_code: 'well_supported',
                    rule: 'Clearly covered by public help articles',
                    reason:
                      'A help article clearly covers your question, and it does not need a team member to check it.',
                  };
  return {
    kind: automatic ? 'automatic_reply' : 'hand_off',
    ...outcome,
    topic: draft?.topic ?? 'Unclassified',
    suggested_priority: draft?.suggested_priority ?? 'normal',
    documents:
      draft?.sources.map(({ id, title, kind }) => ({ id, title, kind })) ?? [],
    sources:
      draft?.sources.filter((source) => source.kind === 'help_article') ?? [],
    paused: generated.error === 'paused',
  };
}

async function saveDraft(
  database: Database,
  ticketId: string,
  session: string,
  draft: Generation,
) {
  await database.query(
    `INSERT INTO session_drafts (session_id, ticket_id, reply, suggested_priority, source_ids, source_articles, internal_copies)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (session_id, ticket_id) DO UPDATE SET reply = EXCLUDED.reply,
     suggested_priority = EXCLUDED.suggested_priority, source_ids = EXCLUDED.source_ids,
     source_articles = EXCLUDED.source_articles, internal_copies = EXCLUDED.internal_copies`,
    [
      session,
      ticketId,
      draft.reply,
      draft.suggested_priority,
      JSON.stringify(draft.source_ids),
      JSON.stringify(draft.sources),
      JSON.stringify(draft.internal_copies),
    ],
  );
}

async function recordDecision(
  database: Database,
  ticketId: string,
  session: string,
  decision: ReturnType<typeof decide>,
  sample = false,
) {
  const automatic = decision.kind === 'automatic_reply';
  if (sample)
    await database.query(
      'UPDATE session_drafts SET decision = $1 WHERE ticket_id = $2 AND session_id = $3',
      [JSON.stringify(decision), ticketId, session],
    );
  else
    await database.query(
      'UPDATE support_tickets SET status = $1, decision = $2 WHERE id = $3',
      [
        automatic ? 'waiting_on_customer' : 'open',
        JSON.stringify(decision),
        ticketId,
      ],
    );
  await recordHistory(database, ticketId, session, {
    kind: automatic ? 'automatic_reply_decided' : 'hand_off_decided',
    text: decision.reason,
  });
}

// First answer for a newly submitted support ticket: reply automatically or hand off.
export async function draftAnswer(
  pool: Pick<Pool, 'query' | 'connect'>,
  ticket: { id: string; question: string },
  session: string,
  owner: boolean,
) {
  const generated = await generateDraft(pool, session, ticket.question, owner);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT status FROM support_tickets WHERE id = $1 FOR NO KEY UPDATE',
      [ticket.id],
    );
    const review = await client.query(
      'SELECT state FROM ticket_reviews WHERE ticket_id = $1 AND session_id = $2',
      [ticket.id, session],
    );
    if (
      !locked.rows.length ||
      locked.rows[0].status === 'solved' ||
      review.rows.length
    ) {
      await client.query('ROLLBACK');
      return;
    }
    if (generated.draft)
      await saveDraft(client, ticket.id, session, generated.draft);
    await recordDecision(
      client,
      ticket.id,
      session,
      decide(ticket.question, generated),
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// A support agent's request for a replacement answer draft.
export async function redraftAnswer(
  pool: Pick<Pool, 'query' | 'connect'>,
  ticket: {
    id: string;
    question: string;
    status: string;
    decision: unknown;
    review_state: string | null;
    priority: string;
    approved_reply: string | null;
    is_sample?: boolean;
  },
  session: string,
  owner: boolean,
) {
  const generated = await generateDraft(pool, session, ticket.question, owner);
  if (!generated.draft) return generated.error;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT status FROM support_tickets WHERE id = $1 FOR NO KEY UPDATE',
      [ticket.id],
    );
    if (!locked.rows.length || locked.rows[0].status === 'solved') {
      await client.query('ROLLBACK');
      return 'conflict';
    }
    const state =
      ticket.status === 'waiting_on_customer'
        ? 'waiting_on_customer'
        : !ticket.decision && ticket.review_state === 'reopened'
          ? 'reopened'
          : 'saved';
    // Guards against a review action that landed while the draft was generating.
    const changed =
      ticket.review_state === null
        ? await client.query(
            `INSERT INTO ticket_reviews (session_id, ticket_id, state, priority, approved_reply)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (session_id, ticket_id) DO NOTHING RETURNING state`,
            [session, ticket.id, state, ticket.priority, ticket.approved_reply],
          )
        : await client.query(
            `UPDATE ticket_reviews SET state = $3
             WHERE session_id = $1 AND ticket_id = $2 AND state = $4 RETURNING state`,
            [session, ticket.id, state, ticket.review_state],
          );
    if (!changed.rows.length) {
      await client.query('ROLLBACK');
      return 'conflict';
    }
    await saveDraft(client, ticket.id, session, generated.draft);
    if (ticket.decision)
      await recordDecision(
        client,
        ticket.id,
        session,
        decide(ticket.question, generated, true),
        ticket.is_sample,
      );
    await recordHistory(client, ticket.id, session, {
      kind: 'redraft_requested',
    });
    await client.query('COMMIT');
    return 'drafted';
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') return 'conflict';
    throw error;
  } finally {
    client.release();
  }
}
