import type { Pool } from 'pg';

export async function prepareDatabase(pool: Pick<Pool, 'query'>) {
  const existing = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'support_tickets' AND column_name = 'session_id'",
  );
  if (existing.rows.length) return;
  await pool.query('ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS session_id text');
  await pool.query('CREATE SEQUENCE support_ticket_ids');
  await pool.query('CREATE SEQUENCE ticket_event_ids');
  await pool.query("SELECT setval('support_ticket_ids', COALESCE((SELECT MAX(id) FROM support_tickets), 1))");
  await pool.query("SELECT setval('ticket_event_ids', COALESCE((SELECT MAX(id) FROM ticket_events), 1))");
}