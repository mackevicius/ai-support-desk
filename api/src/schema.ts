import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { sourceKind } from './internal-copy.js';

const starter = JSON.parse(
  readFileSync(new URL('../starter-data.json', import.meta.url), 'utf8'),
) as {
  articles: { id: number; key: string; title: string; body: string; kind: string }[];
  tickets: { id: number; customer: string; subject: string; question: string;
    priority: string; reason_code: string; source_key: string | null;
    reply: string; rule: string; reason: string }[];
};

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
      'ticket_id integer PRIMARY KEY REFERENCES support_tickets(id), reply text NOT NULL, suggested_priority text NOT NULL, article_id integer REFERENCES help_articles(id)',
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
  await pool.query('ALTER TABLE saved_drafts ALTER COLUMN article_id DROP NOT NULL');
  await pool.query('ALTER TABLE saved_drafts ADD COLUMN IF NOT EXISTS source_articles text');
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
  for (const [id, title] of [[1, 'Inviting teammates'], [2, 'Downloading invoices'],
    [3, 'Usage reporting delays'], [4, 'Renaming a workspace']] as const) {
    const legacy = await pool.query('SELECT id FROM help_articles WHERE id = $1 AND title = $2 AND starter_key IS NULL', [id, title]);
    if (!legacy.rows.length) continue;
    const drafts = await pool.query(
      'SELECT ticket_id, article_title, article_body, source_articles FROM saved_drafts WHERE article_id = $1',
      [id],
    );
    for (const draft of drafts.rows) {
      const sources = draft.source_articles ?? JSON.stringify([
        { id, title: draft.article_title, body: draft.article_body, kind: 'help_article' },
      ]);
      await pool.query(
        'UPDATE saved_drafts SET article_id = NULL, source_articles = $1 WHERE ticket_id = $2',
        [sources, draft.ticket_id],
      );
    }
    await pool.query('DELETE FROM help_articles WHERE id = $1 AND title = $2 AND starter_key IS NULL', [id, title]);
  }
  for (const article of starter.articles) {
    const occupied = await pool.query('SELECT id FROM help_articles WHERE id = $1', [article.id]);
    const id = occupied.rows.length
      ? (await pool.query("SELECT nextval('help_article_ids') AS id")).rows[0].id
      : article.id;
    await pool.query(
      'INSERT INTO help_articles (id, starter_key, title, body, kind) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (starter_key) DO NOTHING',
      [id, article.key, article.title, article.body, article.kind],
    );
    await pool.query("SELECT setval('help_article_ids', $1)", [(await pool.query('SELECT MAX(id) AS id FROM help_articles')).rows[0].id]);
  }
  const documents = (await pool.query('SELECT id, starter_key, title, body, kind FROM help_articles')).rows;
  for (const ticket of starter.tickets) {
    const existing = (await pool.query('SELECT session_id, decision, subject FROM support_tickets WHERE id = $1', [ticket.id])).rows[0];
    if (existing?.session_id || existing?.decision) continue;
    if (existing && !['Team invitations are not arriving', 'Where can I download invoices?',
      'Dashboard numbers look out of date', 'Change workspace name'].includes(existing.subject)) continue;
    const source = documents.find((article) => article.starter_key === ticket.source_key);
    const sources = source ? [{ id: source.id, title: source.title, body: source.body, kind: source.kind }] : [];
    const automatic = ticket.reason_code === 'well_supported';
    const decision = { kind: automatic ? 'automatic_reply' : 'hand_off',
      reason_code: ticket.reason_code, rule: ticket.rule, reason: ticket.reason,
      topic: ticket.subject, suggested_priority: ticket.priority,
      documents: sources.map(({ id, title, kind }) => ({ id, title, kind })),
      sources: sources.filter((article) => article.kind === 'help_article'), paused: false };
    const created = `2026-09-${21 - ticket.id}T10:00:00Z`;
    await pool.query(`INSERT INTO support_tickets (id, customer_name, subject, question, status, priority, created_at, decision)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO UPDATE SET
      customer_name = EXCLUDED.customer_name, subject = EXCLUDED.subject, question = EXCLUDED.question,
      status = EXCLUDED.status, priority = EXCLUDED.priority, created_at = EXCLUDED.created_at, decision = EXCLUDED.decision`,
    [ticket.id, ticket.customer, ticket.subject, ticket.question, automatic ? 'resolved' : 'open', ticket.priority, created, JSON.stringify(decision)]);
    await pool.query(`INSERT INTO saved_drafts (ticket_id, reply, suggested_priority, article_id, article_title, article_body, source_articles)
      VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (ticket_id) DO UPDATE SET
      reply = EXCLUDED.reply, suggested_priority = EXCLUDED.suggested_priority, article_id = EXCLUDED.article_id,
      article_title = EXCLUDED.article_title, article_body = EXCLUDED.article_body, source_articles = EXCLUDED.source_articles`,
    [ticket.id, ticket.reply, ticket.priority, source?.id ?? null, source?.title ?? null, source?.body ?? null, JSON.stringify(sources)]);
    await pool.query('DELETE FROM ticket_events WHERE ticket_id = $1 AND session_id IS NULL', [ticket.id]);
    for (const description of ['Request received', `${automatic ? 'Automatic reply' : 'Hand-off'}: ${ticket.reason}`]) {
      await pool.query(`INSERT INTO ticket_events (id, ticket_id, description, created_at)
        VALUES (nextval('ticket_event_ids'), $1, $2, $3)`, [ticket.id, description, created]);
    }
  }
  const maximum = (await pool.query('SELECT MAX(id) AS id FROM support_tickets')).rows[0].id;
  await pool.query("SELECT setval('support_ticket_ids', $1)", [maximum]);
}
