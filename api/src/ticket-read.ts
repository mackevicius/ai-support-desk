import type { Pool } from 'pg';
import { liveAllowance } from './generation.js';
import { sourceKind, type InternalCopy } from './internal-copy.js';
import { readHistory } from './ticket-history.js';
import {
  canRequestHandOff,
  ticketStatus,
  type Visitor,
} from './ticket-lifecycle.js';

type CheckCopies = (
  reply: string,
  sources: { id: number; body: string; title?: string; kind?: string }[],
  database?: Pick<Pool, 'query'>,
  savedCopies?: InternalCopy[],
) => Promise<InternalCopy[]>;

export function createTicketReader(
  pool: Pick<Pool, 'query'>,
  checkCopies: CheckCopies,
) {
  // Everything about a support ticket, including internal notes; never send this to a customer.
  async function load(id: string, session: string, owner = false) {
    const ticket = await pool.query(
      `SELECT id, session_id, customer_name, subject, question, status, priority, created_at, decision
       FROM support_tickets WHERE id = $1 AND (session_id IS NULL OR (session_id = $2 AND created_at > NOW() - INTERVAL '1 day'))`,
      [id, session],
    );
    if (!ticket.rows.length) return null;
    const review = await pool.query(
      'SELECT state, priority, approved_reply FROM ticket_reviews WHERE ticket_id = $1 AND session_id = $2',
      [id, session],
    );
    const draft = await pool.query(
      `SELECT d.reply, d.suggested_priority, d.source_articles, a.id, a.kind, d.article_title AS title, d.article_body AS body
       FROM saved_drafts d LEFT JOIN help_articles a ON a.id = d.article_id WHERE d.ticket_id = $1`,
      [id],
    );
    let decision = ticket.rows[0].decision
      ? JSON.parse(ticket.rows[0].decision)
      : null;
    const live =
      owner || decision
        ? await pool.query(
            'SELECT reply, suggested_priority, source_ids, source_articles, internal_copies, decision FROM session_drafts WHERE ticket_id = $1 AND session_id = $2',
            [id, session],
          )
        : { rows: [] };
    const originalDecision = decision;
    if (live.rows[0]?.decision) decision = JSON.parse(live.rows[0].decision);
    const privateArticles = await pool.query(
      `SELECT id FROM visitor_help_articles WHERE session_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
      [session],
    );
    const articles = await pool.query(
      'SELECT id, title, body, kind FROM help_articles',
    );
    const liveSources = live.rows.length
      ? live.rows[0].source_articles
        ? JSON.parse(live.rows[0].source_articles)
        : (JSON.parse(live.rows[0].source_ids) as number[]).map((sourceId) =>
            articles.rows.find((article) => article.id === sourceId),
          )
      : [];
    for (const source of liveSources)
      source.kind = sourceKind(source, articles.rows);
    const savedCopies = live.rows[0]?.internal_copies
      ? JSON.parse(live.rows[0].internal_copies)
      : [];
    const savedSources = draft.rows[0]?.source_articles
      ? JSON.parse(draft.rows[0].source_articles)
      : draft.rows[0]?.id
        ? [
            {
              id: draft.rows[0].id,
              title: draft.rows[0].title,
              body: draft.rows[0].body,
              kind: draft.rows[0].kind,
            },
          ]
        : [];
    if (decision) {
      decision.documents = (decision.documents ?? []).map(
        (source: { id: number; kind?: string }) => ({
          ...source,
          kind: sourceKind(source, articles.rows),
        }),
      );
      decision.sources = (decision.sources ?? []).filter(
        (source: { id: number; kind?: string }) =>
          sourceKind(source, articles.rows) === 'help_article',
      );
    }
    const history = await readHistory(pool, id, session);
    const current = review.rows[0];
    const {
      decision: storedDecision,
      session_id: ticketSession,
      ...ticketFields
    } = ticket.rows[0];
    const approvedReply =
      current?.approved_reply ??
      (decision?.kind === 'automatic_reply'
        ? (live.rows[0]?.reply ?? draft.rows[0]?.reply)
        : null) ??
      null;
    const status = ticketStatus(ticket.rows[0].status, current?.state);
    return {
      ...ticketFields,
      is_sample: ticketSession === null,
      can_redraft:
        status !== 'solved' &&
        (owner ||
          (ticketSession === null
            ? originalDecision?.reason_code === 'knowledge_gap' &&
              privateArticles.rows.length > 0
            : Boolean(decision))),
      can_request_hand_off: canRequestHandOff(
        decision,
        history,
        approvedReply,
        status,
      ),
      ...(decision
        ? { decision, live_ai: await liveAllowance(pool, session) }
        : {}),
      status,
      priority: current?.priority ?? ticket.rows[0].priority,
      approved_reply: approvedReply,
      review_state: current?.state ?? null,
      draft: live.rows.length
        ? {
            live: true,
            state: current?.state ?? 'saved',
            reply: live.rows[0].reply,
            suggested_priority: live.rows[0].suggested_priority,
            sources: liveSources,
            internal_copies: await checkCopies(
              live.rows[0].reply,
              liveSources,
              pool,
              savedCopies,
            ),
          }
        : draft.rows.length
          ? {
              state: current?.state ?? 'saved',
              reply: draft.rows[0].reply,
              suggested_priority: draft.rows[0].suggested_priority,
              sources: savedSources,
              internal_copies: await checkCopies(
                draft.rows[0].reply,
                savedSources,
              ),
            }
          : null,
      history,
    };
  }

  // What a customer sees as their conversation: no draft, and no internal note content.
  function conversation(ticket: NonNullable<Awaited<ReturnType<typeof load>>>) {
    const documents: { kind: string }[] = ticket.decision?.documents ?? [];
    const relied = documents.some((source) => source.kind === 'internal_note');
    return {
      ...ticket,
      draft: null,
      approved_reply:
        ticket.decision?.kind === 'automatic_reply' && relied
          ? null
          : ticket.approved_reply,
      decision: ticket.decision
        ? {
            kind: ticket.decision.kind,
            reason: ticket.decision.reason,
            sources: ticket.decision.sources,
            paused: ticket.decision.paused,
            internal_count: documents.filter(
              (source) => source.kind !== 'help_article',
            ).length,
          }
        : undefined,
    };
  }

  async function read(id: string, visitor: Visitor) {
    const ticket = await load(id, visitor.session, visitor.owner);
    if (!ticket || visitor.seat === 'agent') return ticket;
    return conversation(ticket);
  }

  return { load, read };
}
