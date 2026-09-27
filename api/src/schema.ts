import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';

export async function prepareDatabase(pool: Pick<Pool, 'query'>) {
  const existing = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_name = 'support_tickets'",
  );
  if (!existing.rows.length) {
    await pool.query(
      readFileSync(new URL('../../db/seed.sql', import.meta.url), 'utf8'),
    );
  }
  await pool.query(
    'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS session_id text',
  );
  for (const [table, columns] of [
    [
      'help_articles',
      'id integer PRIMARY KEY, title text NOT NULL, body text NOT NULL',
    ],
    [
      'saved_drafts',
      'ticket_id integer PRIMARY KEY REFERENCES support_tickets(id), reply text NOT NULL, suggested_priority text NOT NULL, article_id integer NOT NULL REFERENCES help_articles(id)',
    ],
    [
      'ticket_reviews',
      'session_id text NOT NULL, ticket_id integer NOT NULL REFERENCES support_tickets(id), state text NOT NULL, priority text NOT NULL, approved_reply text, created_at timestamptz NOT NULL DEFAULT NOW(), PRIMARY KEY (session_id, ticket_id)',
    ],
  ]) {
    try {
      await pool.query(`CREATE TABLE ${table} (${columns})`);
    } catch (error) {
      if (
        (error as { code?: string }).code !== '42P07' &&
        !(
          error instanceof Error &&
          error.message.includes(`relation "${table}" already exists`)
        )
      )
        throw error;
    }
  }
  await pool.query(
    'ALTER TABLE ticket_events ADD COLUMN IF NOT EXISTS session_id text',
  );
  await pool.query(
    'ALTER TABLE ticket_reviews ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW()',
  );
  for (const [id, title, body] of [
    [
      1,
      'Inviting teammates',
      'Workspace admins can resend invitations from Settings > Team. Check the invitation email address and ask teammates to check spam. Invitations expire after seven days.',
    ],
    [
      2,
      'Downloading invoices',
      'Workspace owners can download PDF invoices from Settings > Billing > Invoices. August invoices appear after the billing period closes.',
    ],
    [
      3,
      'Usage reporting delays',
      'Usage dashboard updates can take up to 24 hours. If figures remain unchanged after 24 hours, contact support with the reporting period.',
    ],
    [
      4,
      'Renaming a workspace',
      'Workspace owners can rename a workspace in Settings > General. Existing workspace links continue working after a rename.',
    ],
  ] as const) {
    await pool.query(
      'INSERT INTO help_articles (id, title, body) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [id, title, body],
    );
  }
  for (const [ticketId, reply, priority, articleId] of [
    [
      1,
      'Please check the email addresses and spam folders, then resend the invitations from Settings > Team. Invitations expire after seven days.',
      'high',
      1,
    ],
    [
      2,
      'You can download your August PDF invoice from Settings > Billing > Invoices after the billing period closes.',
      'normal',
      2,
    ],
    [
      3,
      'Usage reporting can take up to 24 hours. If the dashboard is still unchanged after that, please share the reporting period so we can investigate.',
      'high',
      3,
    ],
  ] as const) {
    const seeded = await pool.query(
      'SELECT id FROM support_tickets WHERE id = $1 AND session_id IS NULL',
      [ticketId],
    );
    if (seeded.rows.length) {
      await pool.query(
        `INSERT INTO saved_drafts (ticket_id, reply, suggested_priority, article_id)
        VALUES ($1, $2, $3, $4) ON CONFLICT (ticket_id) DO NOTHING`,
        [ticketId, reply, priority, articleId],
      );
    }
  }
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
