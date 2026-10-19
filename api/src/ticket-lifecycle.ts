import type { Pool, PoolClient } from 'pg';
import type { InternalCopy } from './internal-copy.js';
import {
  recordHistory,
  type HistoryEntry,
  type HistoryEvent,
} from './ticket-history.js';

type Database = Pick<Pool, 'query'>;
type Event = Pick<HistoryEvent, 'kind' | 'created_at'>;
type Decision =
  | { kind: string; documents?: { kind?: string }[] }
  | null
  | undefined;

export type Visitor = {
  session: string;
  owner: boolean;
  seat: 'customer' | 'agent';
};

export type TicketAction =
  | { type: 'solve' }
  | { type: 'hand_off' }
  | { type: 'message'; text: unknown }
  | { type: 'reply'; text: unknown; internalConfirmed?: unknown }
  | { type: 'priority'; priority: unknown };

export type Outcome =
  | {
      kind:
        | 'ok'
        | 'not_found'
        | 'forbidden'
        | 'invalid'
        | 'unavailable'
        | 'conflict';
    }
  | { kind: 'internal_copies'; copies: InternalCopy[] };

type Ticket = {
  status: string;
  review_state: string | null;
  priority: string;
  approved_reply: string | null;
  created_at: string;
  can_request_hand_off: boolean;
  decision?: Decision;
  history: Event[];
  draft: null | {
    state: string;
    suggested_priority: string;
    sources: { id: number; body: string; title?: string; kind?: string }[];
    internal_copies?: InternalCopy[];
  };
};

type Dependencies = {
  read: (id: string, session: string, owner: boolean) => Promise<Ticket | null>;
  checkCopies: (
    reply: string,
    sources: NonNullable<Ticket['draft']>['sources'],
    database: Database,
    savedCopies: InternalCopy[],
  ) => Promise<InternalCopy[]>;
};

const customerActions = new Set<TicketAction['type']>([
  'solve',
  'hand_off',
  'message',
]);

export function ticketStatus(stored: string, reviewState?: string | null) {
  if (stored === 'solved') return stored;
  if (reviewState === 'reopened') return 'open';
  if (reviewState === 'waiting_on_customer' || reviewState === 'solved')
    return reviewState;
  return stored;
}

function automaticReplyDelivered(decision: Decision, history: Event[]) {
  return (
    history.some(
      (event) =>
        event.kind === 'automatic_reply_decided' ||
        event.kind === 'automatic_reply',
    ) ||
    (decision?.kind === 'automatic_reply' &&
      !decision.documents?.some((source) => source.kind === 'internal_note'))
  );
}

export function canRequestHandOff(
  decision: Decision,
  history: Event[],
  approvedReply: string | null,
  status: string,
) {
  return (
    automaticReplyDelivered(decision, history) &&
    Boolean(approvedReply) &&
    status === 'waiting_on_customer' &&
    !history.some((event) => event.kind === 'agent_reply')
  );
}

function validText(text: unknown): text is string {
  return typeof text === 'string' && !!text.trim() && text.length <= 5000;
}

function available(ticket: Ticket, action: TicketAction) {
  switch (action.type) {
    case 'solve':
      return ticket.status === 'waiting_on_customer';
    case 'hand_off':
      return ticket.can_request_hand_off;
    case 'message':
    case 'reply':
      return ticket.status !== 'solved';
    case 'priority':
      return (
        ticket.status !== 'solved' &&
        (ticket.review_state ?? ticket.draft?.state ?? 'saved') === 'saved' &&
        !!ticket.draft &&
        action.priority === ticket.draft.suggested_priority &&
        action.priority !== ticket.priority
      );
  }
}

export function createTicketLifecycle(
  pool: Pick<Pool, 'connect'>,
  { read, checkCopies }: Dependencies,
) {
  async function archiveAutomaticReply(
    client: PoolClient,
    id: string,
    session: string,
    ticket: Ticket,
  ) {
    if (
      !automaticReplyDelivered(ticket.decision, ticket.history) ||
      !ticket.approved_reply ||
      ticket.history.some((event) => event.kind === 'automatic_reply')
    )
      return;
    const deliveredAt =
      ticket.history.find((event) => event.kind === 'automatic_reply_decided')
        ?.created_at ?? ticket.created_at;
    await recordHistory(
      client,
      id,
      session,
      { kind: 'automatic_reply', text: ticket.approved_reply },
      { occurredAt: deliveredAt },
    );
  }

  // Inserts the visitor's first review row, or moves it only if no one else moved it first.
  async function moveReview(
    client: PoolClient,
    id: string,
    session: string,
    ticket: Ticket,
    state: string,
    agentPriority?: string,
  ) {
    const changed =
      ticket.review_state === null
        ? await client.query(
            `INSERT INTO ticket_reviews (session_id, ticket_id, state, priority, approved_reply)
             VALUES ($1, $2, $3, $4, $5) RETURNING ticket_id`,
            [
              session,
              id,
              state,
              agentPriority ?? ticket.priority,
              ticket.approved_reply,
            ],
          )
        : agentPriority === undefined
          ? await client.query(
              `UPDATE ticket_reviews SET state = $3
               WHERE session_id = $1 AND ticket_id = $2 AND state = $4 RETURNING ticket_id`,
              [session, id, state, ticket.review_state],
            )
          : await client.query(
              `UPDATE ticket_reviews SET state = $3, priority = $4, approved_reply = $5
               WHERE session_id = $1 AND ticket_id = $2 AND state = $6 RETURNING ticket_id`,
              [
                session,
                id,
                state,
                agentPriority,
                ticket.approved_reply,
                ticket.review_state,
              ],
            );
    return changed.rows.length > 0;
  }

  // Customer messages reopen an answered ticket based on the status read under the lock.
  async function reopenForMessage(
    client: PoolClient,
    id: string,
    session: string,
    ticket: Ticket,
    lockedStatus: string,
  ) {
    await client.query(
      `INSERT INTO ticket_reviews (session_id, ticket_id, state, priority, approved_reply)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id, ticket_id) DO NOTHING`,
      [
        session,
        id,
        ticket.status !== 'open'
          ? 'reopened'
          : (ticket.review_state ?? 'saved'),
        ticket.priority,
        ticket.approved_reply,
      ],
    );
    const changed = await client.query(
      `UPDATE ticket_reviews
       SET state = CASE WHEN state = 'waiting_on_customer' OR $3 = 'waiting_on_customer' THEN 'reopened' ELSE state END
       WHERE session_id = $1 AND ticket_id = $2 AND state <> 'solved' RETURNING state`,
      [session, id, lockedStatus],
    );
    return changed.rows.length > 0;
  }

  async function step(
    client: PoolClient,
    id: string,
    session: string,
    ticket: Ticket,
    action: TicketAction,
    lockedStatus: string,
  ): Promise<{ event: HistoryEntry } | Outcome> {
    switch (action.type) {
      case 'solve':
        return (await moveReview(client, id, session, ticket, 'solved'))
          ? { event: { kind: 'solved' } }
          : { kind: 'conflict' };
      case 'hand_off':
        return (await moveReview(client, id, session, ticket, 'reopened'))
          ? { event: { kind: 'customer_hand_off' } }
          : { kind: 'conflict' };
      case 'message':
        return (await reopenForMessage(
          client,
          id,
          session,
          ticket,
          lockedStatus,
        ))
          ? {
              event: {
                kind: 'customer_message',
                text: (action.text as string).trim(),
              },
            }
          : { kind: 'conflict' };
      case 'reply': {
        const reply = (action.text as string).trim();
        const copies = await checkCopies(
          reply,
          ticket.draft?.sources ?? [],
          client,
          ticket.draft?.internal_copies ?? [],
        );
        if (copies.length && action.internalConfirmed !== reply)
          return { kind: 'internal_copies', copies };
        return (await moveReview(
          client,
          id,
          session,
          ticket,
          'waiting_on_customer',
          ticket.priority,
        ))
          ? { event: { kind: 'agent_reply', text: reply } }
          : { kind: 'conflict' };
      }
      case 'priority':
        return (await moveReview(
          client,
          id,
          session,
          ticket,
          'saved',
          action.priority as string,
        ))
          ? {
              event: {
                kind: 'priority_approved',
                text: action.priority as string,
              },
            }
          : { kind: 'conflict' };
    }
  }

  async function apply(
    id: string,
    visitor: Visitor,
    action: TicketAction,
  ): Promise<Outcome> {
    if (customerActions.has(action.type) && visitor.seat === 'agent')
      return { kind: 'forbidden' };
    if (action.type === 'message' && !validText(action.text))
      return { kind: 'invalid' };
    const ticket = /^\d+$/.test(id)
      ? await read(id, visitor.session, visitor.owner)
      : null;
    if (!ticket) return { kind: 'not_found' };
    if (!available(ticket, action)) return { kind: 'unavailable' };
    if (action.type === 'reply' && !validText(action.text))
      return { kind: 'invalid' };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        'SELECT status FROM support_tickets WHERE id = $1 FOR NO KEY UPDATE',
        [id],
      );
      if (!locked.rows.length) {
        await client.query('ROLLBACK');
        return { kind: 'not_found' };
      }
      const result = await step(
        client,
        id,
        visitor.session,
        ticket,
        action,
        locked.rows[0].status,
      );
      if ('kind' in result) {
        await client.query('ROLLBACK');
        return result;
      }
      await archiveAutomaticReply(client, id, visitor.session, ticket);
      await recordHistory(client, id, visitor.session, result.event);
      await client.query('COMMIT');
      return { kind: 'ok' };
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505')
        return { kind: 'conflict' };
      throw error;
    } finally {
      client.release();
    }
  }

  return { apply };
}
