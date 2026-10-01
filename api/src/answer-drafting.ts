import type { Pool } from 'pg';
import { generateDraft, type Generation } from './generation.js';

type Generated = Awaited<ReturnType<typeof generateDraft>>;
type Database = Pick<Pool, 'query'>;

export function decide(
  question: string,
  generated: Generated,
  agentReview = false,
) {
  const draft = generated.draft;
  const risky =
    /\b(refunds?|charg(?:e|ed|es|ing)|bill(?:ed|s|ing)?|pay(?:ment|ments|ing)?|paid|price|pricing|cost|card|money|purchase|subscription|cancel|passwords?|credentials?|hack(?:ed|ing)?|compromis(?:e|ed)|breach(?:ed)?|security|stolen|unauthori[sz]ed|accounts?|log(?:ged|ging)?[ -]?in(?:to)?|sign.?in|two.factor|2fa|verification code|locked|identity|fraud)\b/i.test(
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
          rule: 'Live allowance exhausted',
          reason: 'Live AI is paused for today',
        }
      : risky
        ? {
            rule: 'Money or account security',
            reason:
              'A team member needs to check questions about money or account security.',
          }
        : internal || copied
          ? {
              rule: 'Staff-only information',
              reason:
                'The answer relies on information meant for Tunely staff.',
            }
          : !covered
            ? {
                rule: 'Weak help article coverage',
                reason:
                  'There is not enough clear help article coverage to answer automatically.',
              }
            : draft?.requires_team !== false
              ? {
                  rule: 'Provider requested team review',
                  reason:
                    'A team member needs to check this question before we can answer.',
                }
              : agentReview
                ? {
                    rule: 'Agent review required',
                    reason:
                      'An agent requested a new draft; it needs approval before delivery.',
                  }
                : {
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
) {
  const automatic = decision.kind === 'automatic_reply';
  await database.query(
    'UPDATE support_tickets SET status = $1, decision = $2 WHERE id = $3',
    [automatic ? 'resolved' : 'open', JSON.stringify(decision), ticketId],
  );
  await database.query(
    `INSERT INTO ticket_events (id, ticket_id, session_id, description, created_at)
     VALUES (nextval('ticket_event_ids'), $1, $2, $3, $4)`,
    [
      ticketId,
      session,
      `${automatic ? 'Automatic reply' : 'Hand-off'}: ${decision.reason}`,
      new Date().toISOString(),
    ],
  );
}

// First answer for a newly submitted support ticket: reply automatically or hand off.
export async function draftAnswer(
  pool: Pick<Pool, 'query' | 'connect'>,
  ticket: { id: string; question: string },
  session: string,
  owner: boolean,
) {
  const generated = await generateDraft(pool, session, ticket.question, owner);
  if (generated.draft)
    await saveDraft(pool, ticket.id, session, generated.draft);
  await recordDecision(
    pool,
    ticket.id,
    session,
    decide(ticket.question, generated),
  );
}

// A support agent's request for a replacement answer draft.
export async function redraftAnswer(
  pool: Pick<Pool, 'query' | 'connect'>,
  ticket: {
    id: string;
    question: string;
    decision: unknown;
    review_state: string | null;
    priority: string;
    approved_reply: string | null;
  },
  session: string,
  owner: boolean,
) {
  const generated = await generateDraft(pool, session, ticket.question, owner);
  if (!generated.draft) return generated.error;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state =
      !ticket.decision && ticket.review_state === 'reopened'
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
      );
    await client.query(
      `INSERT INTO ticket_events (id, ticket_id, session_id, description, created_at)
       VALUES (nextval('ticket_event_ids'), $1, $2, 'Agent requested a new answer draft', $3)`,
      [ticket.id, session, new Date().toISOString()],
    );
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
