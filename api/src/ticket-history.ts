import type { Pool } from 'pg';

type Database = Pick<Pool, 'query'>;

const prefixed = {
  automatic_reply_decided: 'Automatic reply: ',
  hand_off_decided: 'Hand-off: ',
  automatic_reply: 'Automatic in-app reply: ',
  customer_message: 'Customer replied: ',
  agent_reply: 'Agent replied: ',
} as const;

const fixed = {
  request_received: 'Request received',
  customer_hand_off: 'Customer asked for a person',
  solved: 'Customer marked conversation solved',
  redraft_requested: 'Agent requested a new answer draft',
} as const;

export type HistoryEntry =
  | { kind: keyof typeof prefixed; text: string }
  | { kind: keyof typeof fixed }
  | { kind: 'priority_approved'; text: string };

export type HistoryEvent = {
  id: number;
  description: string;
  created_at: string;
} & (HistoryEntry | { kind: 'other'; text: string });

export const automaticReplyPattern = `${prefixed.automatic_reply}%`;

function describe(entry: HistoryEntry) {
  if (entry.kind === 'priority_approved')
    return `Human approved ${entry.text} priority suggestion`;
  if ('text' in entry) return prefixed[entry.kind] + entry.text;
  return fixed[entry.kind];
}

function parse(
  description: string,
): HistoryEntry | { kind: 'other'; text: string } {
  for (const [kind, prefix] of Object.entries(prefixed))
    if (description.startsWith(prefix))
      return {
        kind: kind as keyof typeof prefixed,
        text: description.slice(prefix.length),
      };
  for (const [kind, text] of Object.entries(fixed))
    if (description === text) return { kind: kind as keyof typeof fixed };
  const priority = /^Human approved (.+) priority suggestion$/.exec(
    description,
  );
  if (priority) return { kind: 'priority_approved', text: priority[1] };
  return { kind: 'other', text: description };
}

export async function recordHistory(
  database: Database,
  ticketId: string | number,
  session: string | null,
  entry: HistoryEntry,
  at: { createdAt?: string; occurredAt?: string } = {},
) {
  await database.query(
    `INSERT INTO ticket_events (id, ticket_id, session_id, description, created_at, occurred_at)
     VALUES (nextval('ticket_event_ids'), $1, $2, $3, $4, $5)${
       // A unique index keeps one shown automatic reply per visitor copy.
       entry.kind === 'automatic_reply' ? ' ON CONFLICT DO NOTHING' : ''
     }`,
    [
      ticketId,
      session,
      describe(entry),
      at.createdAt ?? new Date().toISOString(),
      at.occurredAt ?? null,
    ],
  );
}

export async function readHistory(
  database: Database,
  ticketId: string,
  session: string,
): Promise<HistoryEvent[]> {
  const events = await database.query(
    `SELECT id, description, COALESCE(occurred_at, created_at) AS created_at FROM ticket_events
     WHERE ticket_id = $1 AND (session_id IS NULL OR session_id = $2)
     ORDER BY COALESCE(occurred_at, created_at), id`,
    [ticketId, session],
  );
  return events.rows.map(
    (row: { id: number; description: string; created_at: string }) => ({
      ...row,
      ...parse(row.description),
    }),
  );
}
