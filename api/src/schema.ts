import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { sourceKind } from './internal-copy.js';

export async function prepareDatabase(pool: Pick<Pool, 'query'>) {
  const existing = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_name = 'support_tickets'",
  );
  if (!existing.rows.length) {
    await pool.query(
      readFileSync(new URL('../seed.sql', import.meta.url), 'utf8'),
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
    [
      'session_drafts',
      'session_id text NOT NULL, ticket_id integer NOT NULL REFERENCES support_tickets(id), reply text NOT NULL, suggested_priority text NOT NULL, source_ids text NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW(), PRIMARY KEY (session_id, ticket_id)',
    ],
    [
      'generation_usage',
      'day text PRIMARY KEY, requests integer NOT NULL, reserved_tokens integer NOT NULL DEFAULT 0',
    ],
    [
      'visitor_generation_usage',
      'session_id text PRIMARY KEY, requests integer NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW()',
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
  await pool.query(
    'ALTER TABLE generation_usage ADD COLUMN IF NOT EXISTS reserved_tokens integer NOT NULL DEFAULT 0',
  );
  await pool.query(
    'ALTER TABLE help_articles ADD COLUMN IF NOT EXISTS retired boolean NOT NULL DEFAULT false',
  );
  await pool.query(
    'ALTER TABLE saved_drafts ADD COLUMN IF NOT EXISTS article_title text',
  );
  await pool.query(
    'ALTER TABLE saved_drafts ADD COLUMN IF NOT EXISTS article_body text',
  );
  await pool.query(
    'ALTER TABLE session_drafts ADD COLUMN IF NOT EXISTS source_articles text',
  );
  await pool.query(
    'ALTER TABLE session_drafts ADD COLUMN IF NOT EXISTS internal_copies text',
  );
  await pool.query(
    "ALTER TABLE help_articles ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'help_article'",
  );
  await pool.query(
    'ALTER TABLE help_articles ADD COLUMN IF NOT EXISTS starter_key text UNIQUE',
  );
  await pool.query(
    'ALTER TABLE generation_usage ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false',
  );
  await pool.query(
    'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS decision text',
  );
  const unsnapshotted = await pool.query(
    `SELECT d.ticket_id, a.title, a.body FROM saved_drafts d
     JOIN help_articles a ON a.id = d.article_id WHERE d.article_title IS NULL`,
  );
  for (const draft of unsnapshotted.rows) {
    await pool.query(
      'UPDATE saved_drafts SET article_title = $1, article_body = $2 WHERE ticket_id = $3',
      [draft.title, draft.body, draft.ticket_id],
    );
  }
  const unsnapshottedLive = await pool.query(
    'SELECT session_id, ticket_id, source_ids, source_articles FROM session_drafts',
  );
  if (unsnapshottedLive.rows.length) {
    const articles = (
      await pool.query('SELECT id, title, body, kind FROM help_articles')
    ).rows;
    for (const draft of unsnapshottedLive.rows) {
      const existingSources = draft.source_articles
        ? JSON.parse(draft.source_articles)
        : (JSON.parse(draft.source_ids) as number[])
            .map((id) => articles.find((article) => article.id === id))
            .filter(Boolean);
      const sources = existingSources.map(
        (source: { id: number; kind?: string }) => ({
          ...source,
          kind: sourceKind(source, articles),
        }),
      );
      if (JSON.stringify(sources) === draft.source_articles) continue;
      await pool.query(
        'UPDATE session_drafts SET source_articles = $1 WHERE session_id = $2 AND ticket_id = $3',
        [JSON.stringify(sources), draft.session_id, draft.ticket_id],
      );
    }
  }
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
      const article = await pool.query(
        'SELECT title, body FROM help_articles WHERE id = $1',
        [articleId],
      );
      await pool.query(
        `INSERT INTO saved_drafts (ticket_id, reply, suggested_priority, article_id, article_title, article_body)
        VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (ticket_id) DO NOTHING`,
        [
          ticketId,
          reply,
          priority,
          articleId,
          article.rows[0].title,
          article.rows[0].body,
        ],
      );
    }
  }
  for (const [sequence, table] of [
    ['support_ticket_ids', 'support_tickets'],
    ['ticket_event_ids', 'ticket_events'],
    ['help_article_ids', 'help_articles'],
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
  for (const [key, title, body] of [
    [
      'offline-downloads',
      'Offline downloads',
      'Tunely paid plans include offline listening. Open a playlist or album and tap Download. Keep Tunely online at least once every 30 days to keep downloads available.',
    ],
    [
      'family-invitations',
      'Family plan invitations',
      'The family plan owner can invite members from Settings > Plan > Family. Members must live at the same address. Open the invitation link and sign in to join.',
    ],
    [
      'audio-quality',
      'Changing audio quality',
      'Open Settings > Audio quality in Tunely and choose the streaming or download quality. Higher quality uses more data and storage.',
    ],
  ] as const) {
    await pool.query(
      "INSERT INTO help_articles (id, starter_key, title, body) VALUES (nextval('help_article_ids'), $1, $2, $3) ON CONFLICT (starter_key) DO NOTHING",
      [key, title, body],
    );
  }
}
