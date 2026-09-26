import type { Pool } from 'pg';

export async function prepareDatabase(pool: Pick<Pool, 'query'>) {
  await pool.query(
    'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS session_id text',
  );
  for (const [sequence, table] of [
    ['support_ticket_ids', 'support_tickets'],
    ['ticket_event_ids', 'ticket_events'],
  ]) {
    try {
      await pool.query(`CREATE SEQUENCE ${sequence}`);
    } catch (error) {
      if (
        (error as { code?: string }).code !== '42P07' &&
        !(
          error instanceof Error &&
          error.message.includes(`relation "${sequence}" already exists`)
        )
      ) {
        throw error;
      }
    }
    const next = await pool.query(`SELECT nextval('${sequence}') AS id`);
    const maximum = await pool.query(`SELECT MAX(id) AS id FROM ${table}`);
    if (Number(next.rows[0].id) <= Number(maximum.rows[0].id)) {
      await pool.query(`SELECT setval('${sequence}', $1)`, [
        maximum.rows[0].id,
      ]);
    }
  }
}
