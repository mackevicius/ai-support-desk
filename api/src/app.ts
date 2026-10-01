import express from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { draftAnswer, redraftAnswer } from './answer-drafting.js';
import { liveAllowance } from './generation.js';
import {
  internalCopies,
  internalDocuments,
  sourceKind,
  type InternalCopy,
} from './internal-copy.js';

const ownerSessionAge = 8 * 60 * 60 * 1000;
const statusOrder: Record<string, number> = {
  open: 0,
  pending: 1,
  resolved: 2,
};

function validArticle(input: unknown): input is {
  title: string;
  body: string;
  retired?: boolean;
  kind?: 'help_article' | 'internal_note';
} {
  if (!input || typeof input !== 'object') return false;
  const { title, body, kind } = input as {
    title?: unknown;
    body?: unknown;
    kind?: unknown;
  };
  return (
    typeof title === 'string' &&
    !!title.trim() &&
    title.length <= 200 &&
    typeof body === 'string' &&
    !!body.trim() &&
    body.length <= 5000 &&
    (kind === undefined || kind === 'help_article' || kind === 'internal_note')
  );
}

function matchesSecret(provided: string, expected: string) {
  const actual = createHmac('sha256', 'owner-login').update(provided).digest();
  const target = createHmac('sha256', 'owner-login').update(expected).digest();
  return timingSafeEqual(actual, target);
}

function ownerSession(session: string) {
  const secret = process.env.OWNER_SESSION_SECRET;
  if (!secret) return null;
  const expiry = Date.now() + ownerSessionAge;
  const signature = createHmac('sha256', secret)
    .update(`${session}.${expiry}`)
    .digest('hex');
  return `${expiry}.${signature}`;
}

function isOwner(cookie: string | undefined, session: string) {
  const secret = process.env.OWNER_SESSION_SECRET;
  const token = cookie?.match(
    /(?:^|;\s*)owner_session=(\d+\.[a-f0-9]{64})(?:;|$)/,
  )?.[1];
  if (!secret || !token) return false;
  const [expiry, signature] = token.split('.');
  if (Number(expiry) <= Date.now()) return false;
  const expected = createHmac('sha256', secret)
    .update(`${session}.${expiry}`)
    .digest('hex');
  return timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}

export function createApp(pool: Pick<Pool, 'query' | 'connect'>) {
  const app = express();
  app.use(express.json());
  async function checkedCopies(
    reply: string,
    sources: { id: number; body: string; title?: string; kind?: string }[],
    database: Pick<Pool, 'query'> = pool,
    savedCopies: InternalCopy[] = [],
  ) {
    const documents = (
      await database.query('SELECT id, title, body, kind FROM help_articles')
    ).rows;
    return internalCopies(reply, [
      ...internalDocuments(documents, sources),
      ...savedCopies.map((copy) => ({ body: copy.text })),
    ]);
  }
  function reviewedStatus(status: string, state?: string) {
    if (state === 'approved') return 'resolved';
    if (state === 'reopened') return 'open';
    return status;
  }
  async function detail(id: string, session: string, owner = false) {
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
    const events = await pool.query(
      `SELECT id, description, created_at FROM ticket_events
       WHERE ticket_id = $1 AND (session_id IS NULL OR session_id = $2) ORDER BY created_at, id`,
      [id, session],
    );
    const current = review.rows[0];
    const {
      decision: storedDecision,
      session_id: ticketSession,
      ...ticketFields
    } = ticket.rows[0];
    return {
      ...ticketFields,
      is_sample: ticketSession === null,
      can_redraft:
        owner ||
        (ticketSession === null
          ? originalDecision?.reason_code === 'knowledge_gap' &&
            privateArticles.rows.length > 0
          : Boolean(decision)),
      ...(decision
        ? { decision, live_ai: await liveAllowance(pool, session) }
        : {}),
      status: reviewedStatus(ticket.rows[0].status, current?.state),
      priority: current?.priority ?? ticket.rows[0].priority,
      approved_reply:
        current?.approved_reply ??
        (decision?.kind === 'automatic_reply'
          ? (live.rows[0]?.reply ?? draft.rows[0]?.reply)
          : null) ??
        null,
      review_state: current?.state ?? null,
      draft: live.rows.length
        ? {
            live: true,
            state: current?.state ?? 'saved',
            reply: live.rows[0].reply,
            suggested_priority: live.rows[0].suggested_priority,
            sources: liveSources,
            internal_copies: await checkedCopies(
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
              internal_copies: await checkedCopies(
                draft.rows[0].reply,
                savedSources,
              ),
            }
          : null,
      history: events.rows,
    };
  }
  app.use((request, response, next) => {
    const session = request.headers.cookie?.match(
      /(?:^|;\s*)demo_session=([0-9a-f-]{36})(?:;|$)/,
    )?.[1];
    response.locals.session = session ?? randomUUID();
    if (!session) {
      response.cookie('demo_session', response.locals.session, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
      });
    }
    next();
  });

  app.get('/health', async (_request, response, next) => {
    try {
      await pool.query('SELECT 1');
      response.json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/live-ai', async (_request, response, next) => {
    try {
      response.json(await liveAllowance(pool, response.locals.session));
    } catch (error) {
      next(error);
    }
  });

  app.post('/owner/login', (request, response) => {
    const password = process.env.OWNER_PASSWORD;
    const secret = process.env.OWNER_SESSION_SECRET;
    if (!password || !secret) {
      response.status(503).json({ error: 'Owner login is unavailable' });
      return;
    }
    if (
      typeof request.body?.password !== 'string' ||
      !matchesSecret(request.body.password, password)
    ) {
      response.sendStatus(401);
      return;
    }
    response.cookie('owner_session', ownerSession(response.locals.session), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: ownerSessionAge,
    });
    response.sendStatus(204);
  });

  app.get('/help-articles', async (request, response, next) => {
    if (!isOwner(request.headers.cookie, response.locals.session)) {
      response.sendStatus(403);
      return;
    }
    try {
      const articles = await pool.query(
        'SELECT id, title, body, retired, kind FROM help_articles ORDER BY id',
      );
      response.json(articles.rows);
    } catch (error) {
      next(error);
    }
  });

  app.post('/help-articles', async (request, response, next) => {
    if (!isOwner(request.headers.cookie, response.locals.session)) {
      response.sendStatus(403);
      return;
    }
    if (!validArticle(request.body)) {
      response
        .status(400)
        .json({ error: 'Enter a title and body within the allowed lengths.' });
      return;
    }
    const { title, body, kind = 'help_article' } = request.body;
    try {
      const article = await pool.query(
        "INSERT INTO help_articles (id, title, body, kind) VALUES (nextval('help_article_ids'), $1, $2, $3) RETURNING id, title, body, retired, kind",
        [title.trim(), body.trim(), kind],
      );
      response.status(201).json(article.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.get('/visitor/help-articles', async (request, response, next) => {
    if (!/(?:^|;\s*)demo_seat=agent(?:;|$)/.test(request.headers.cookie ?? '')) {
      response.sendStatus(403);
      return;
    }
    try {
      const articles = await pool.query(
        `SELECT id, title, body, 'help_article' AS kind FROM visitor_help_articles
         WHERE session_id = $1 AND created_at > NOW() - INTERVAL '1 day' ORDER BY id`,
        [response.locals.session],
      );
      response.json(articles.rows);
    } catch (error) {
      next(error);
    }
  });

  app.post('/visitor/help-articles', async (request, response, next) => {
    if (!/(?:^|;\s*)demo_seat=agent(?:;|$)/.test(request.headers.cookie ?? '')) {
      response.sendStatus(403);
      return;
    }
    if (
      !validArticle(request.body) ||
      (request.body.kind !== undefined && request.body.kind !== 'help_article')
    ) {
      response.status(400).json({
        error: 'Enter a help article with a title up to 200 characters and content up to 5000 characters.',
      });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO visitor_article_usage (session_id, articles) VALUES ($1, 0) ON CONFLICT (session_id) DO NOTHING',
        [response.locals.session],
      );
      const allowance = await client.query(
        'UPDATE visitor_article_usage SET articles = articles + 1 WHERE session_id = $1 AND articles < 5 RETURNING articles',
        [response.locals.session],
      );
      if (!allowance.rows.length) {
        await client.query('ROLLBACK');
        response.status(429).json({
          error: 'Your private copy has reached its five help article limit.',
        });
        return;
      }
      const article = await client.query(
        `INSERT INTO visitor_help_articles (id, session_id, title, body)
         VALUES (nextval('help_article_ids'), $1, $2, $3) RETURNING id, title, body, 'help_article' AS kind`,
        [
          response.locals.session,
          request.body.title.trim(),
          request.body.body.trim(),
        ],
      );
      await client.query('COMMIT');
      response.status(201).json(article.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  });

  app.patch('/help-articles/:id', async (request, response, next) => {
    if (!isOwner(request.headers.cookie, response.locals.session)) {
      response.sendStatus(403);
      return;
    }
    if (
      !/^\d+$/.test(request.params.id) ||
      !validArticle(request.body) ||
      typeof request.body.retired !== 'boolean'
    ) {
      response
        .status(400)
        .json({ error: 'Enter a valid article, title, body and status.' });
      return;
    }
    const { title, body, retired, kind } = request.body;
    try {
      const article = await pool.query(
        'UPDATE help_articles SET title = $1, body = $2, retired = $3, kind = COALESCE($5, kind) WHERE id = $4 RETURNING id, title, body, retired, kind',
        [title.trim(), body.trim(), retired, request.params.id, kind ?? null],
      );
      if (!article.rows.length) {
        response.sendStatus(404);
        return;
      }
      response.json(article.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.post('/tickets/:id/generate', async (request, response, next) => {
    const owner = isOwner(request.headers.cookie, response.locals.session);
    try {
      if (!/^\d+$/.test(request.params.id)) {
        response.sendStatus(404);
        return;
      }
      const ticket = await detail(
        request.params.id,
        response.locals.session,
        owner,
      );
      if (!ticket) {
        response.sendStatus(404);
        return;
      }
      if (!ticket.can_redraft) {
        response.sendStatus(403);
        return;
      }
      if (ticket.status === 'resolved') {
        response
          .status(409)
          .json({ error: 'Generation is not available for this request' });
        return;
      }
      const outcome = await redraftAnswer(
        pool,
        { ...ticket, id: request.params.id },
        response.locals.session,
        owner,
      );
      if (outcome !== 'drafted') {
        response
          .status(
            outcome === 'paused' ? 429 : outcome === 'conflict' ? 409 : 502,
          )
          .json({
            error:
              outcome === 'paused'
                ? 'Live AI is paused for today'
                : outcome === 'conflict'
                  ? 'Generation is no longer available'
                  : 'Live generation is unavailable',
          });
        return;
      }
      response.json(
        await detail(request.params.id, response.locals.session, true),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get('/tickets', async (request, response, next) => {
    try {
      await pool.query(
        "DELETE FROM visitor_help_articles WHERE created_at <= NOW() - INTERVAL '1 day'",
      );
      await pool.query(
        "DELETE FROM session_drafts WHERE created_at <= NOW() - INTERVAL '1 day'",
      );
      await pool.query(
        "DELETE FROM ticket_events WHERE session_id IS NOT NULL AND created_at <= NOW() - INTERVAL '1 day'",
      );
      await pool.query(
        "DELETE FROM ticket_reviews WHERE created_at <= NOW() - INTERVAL '1 day'",
      );
      const result = await pool.query(
        `
        SELECT id, customer_name, subject, status, priority, created_at
        FROM support_tickets
        WHERE session_id IS NULL OR (session_id = $1 AND created_at > NOW() - INTERVAL '1 day')
        ORDER BY created_at DESC, id DESC
      `,
        [response.locals.session],
      );
      const reviews = await pool.query(
        'SELECT ticket_id, state, priority FROM ticket_reviews WHERE session_id = $1',
        [response.locals.session],
      );
      response.json(
        result.rows
          .map((ticket) => {
            const review = reviews.rows.find(
              (item) => item.ticket_id === ticket.id,
            );
            return review
              ? {
                  ...ticket,
                  status: reviewedStatus(ticket.status, review.state),
                  priority: review.priority,
                  review_state: review.state,
                }
              : ticket;
          })
          .filter(
            (ticket) =>
              !['open', 'pending', 'resolved'].includes(
                String(request.query.status),
              ) || ticket.status === request.query.status,
          )
          .sort(
            (first, second) =>
              (statusOrder[first.status] ?? 1) -
              (statusOrder[second.status] ?? 1),
          ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post('/tickets', async (request, response, next) => {
    const question = request.body?.question;
    if (
      typeof question !== 'string' ||
      !question.trim() ||
      question.length > 5000
    ) {
      response
        .status(400)
        .json({ error: 'Enter a question of up to 5000 characters.' });
      return;
    }
    let ticketId: string;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ticket_events WHERE ticket_id IN (
        SELECT id FROM support_tickets WHERE session_id IS NOT NULL AND created_at <= NOW() - INTERVAL '1 day'
      )`);
      await client.query(`DELETE FROM session_drafts WHERE ticket_id IN (
        SELECT id FROM support_tickets WHERE session_id IS NOT NULL AND created_at <= NOW() - INTERVAL '1 day'
      )`);
      await client.query(
        "DELETE FROM support_tickets WHERE session_id IS NOT NULL AND created_at <= NOW() - INTERVAL '1 day'",
      );
      const createdAt = new Date().toISOString();
      const ticket = await client.query(
        `INSERT INTO support_tickets (id, session_id, customer_name, subject, question, status, priority, created_at)
         VALUES (nextval('support_ticket_ids'), $1, 'Visitor', $2, $3, 'open', 'normal', $4)
         RETURNING id, customer_name, subject, question, status, priority, created_at`,
        [
          response.locals.session,
          question.trim().split('\n')[0].slice(0, 120),
          question.trim(),
          createdAt,
        ],
      );
      await client.query(
        `INSERT INTO ticket_events (id, ticket_id, description, created_at)
         VALUES (nextval('ticket_event_ids'), $1, 'Request received', $2)
         RETURNING id, description, created_at`,
        [ticket.rows[0].id, createdAt],
      );
      await client.query('COMMIT');
      ticketId = String(ticket.rows[0].id);
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
      return;
    } finally {
      client.release();
    }
    try {
      await draftAnswer(
        pool,
        { id: ticketId, question: question.trim() },
        response.locals.session,
        isOwner(request.headers.cookie, response.locals.session),
      );
      response
        .status(201)
        .json(await detail(ticketId, response.locals.session));
    } catch (error) {
      next(error);
    }
  });

  app.post('/reset', async (_request, response, next) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM ticket_events WHERE session_id = $1 OR ticket_id IN (
          SELECT id FROM support_tickets WHERE session_id = $1
        )`,
        [response.locals.session],
      );
      await client.query('DELETE FROM ticket_reviews WHERE session_id = $1', [
        response.locals.session,
      ]);
      await client.query('DELETE FROM session_drafts WHERE session_id = $1', [
        response.locals.session,
      ]);
      await client.query('DELETE FROM support_tickets WHERE session_id = $1', [
        response.locals.session,
      ]);
      await client.query(
        'DELETE FROM visitor_help_articles WHERE session_id = $1',
        [response.locals.session],
      );
      await client.query('COMMIT');
      response.sendStatus(204);
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  });

  app.get('/tickets/:id', async (request, response, next) => {
    try {
      if (!/^\d+$/.test(request.params.id)) {
        response.sendStatus(404);
        return;
      }
      const ticket = await detail(
        request.params.id,
        response.locals.session,
        isOwner(request.headers.cookie, response.locals.session),
      );
      if (!ticket) {
        response.sendStatus(404);
        return;
      }
      if (request.query.view === 'customer') {
        const documents = ticket.decision?.documents ?? [];
        response.json({
          ...ticket,
          draft: null,
          approved_reply:
            ticket.decision?.kind === 'automatic_reply' &&
            documents.some(
              (source: { kind: string }) => source.kind === 'internal_note',
            )
              ? null
              : ticket.approved_reply,
          decision: ticket.decision
            ? {
                kind: ticket.decision.kind,
                reason: ticket.decision.reason,
                sources: ticket.decision.sources,
                paused: ticket.decision.paused,
                internal_count: documents.filter(
                  (source: { kind: string }) => source.kind !== 'help_article',
                ).length,
              }
            : undefined,
        });
        return;
      }
      response.json(ticket);
    } catch (error) {
      next(error);
    }
  });

  app.post('/tickets/:id/check', async (request, response, next) => {
    try {
      const ticket = /^\d+$/.test(request.params.id)
        ? await detail(request.params.id, response.locals.session, true)
        : null;
      if (!ticket) {
        response.sendStatus(404);
        return;
      }
      const reply = request.body?.reply;
      if (typeof reply !== 'string' || reply.length > 5000) {
        response.sendStatus(400);
        return;
      }
      response.json(
        await checkedCopies(
          reply,
          ticket.draft?.sources ?? [],
          pool,
          ticket.draft?.internal_copies ?? [],
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post('/tickets/:id/review', async (request, response, next) => {
    try {
      if (!/^\d+$/.test(request.params.id)) {
        response.sendStatus(404);
        return;
      }
      const owner = isOwner(request.headers.cookie, response.locals.session);
      const ticket = await detail(
        request.params.id,
        response.locals.session,
        owner,
      );
      if (!ticket) {
        response.sendStatus(404);
        return;
      }
      if (
        !ticket.draft &&
        !(
          ['approve', 'ask'].includes(request.body?.action) &&
          ticket.status === 'open'
        ) &&
        !(request.body?.action === 'reopen' && ticket.status === 'resolved') &&
        !(
          request.body?.action === 'approve' &&
          ticket.review_state === 'reopened'
        )
      ) {
        response.status(409).json({ error: 'No saved draft to review' });
        return;
      }
      const { action, reply, priority } = request.body ?? {};
      const state = ticket.review_state ?? ticket.draft?.state ?? 'saved';
      if (
        !(
          (action === 'approve' &&
            ticket.status !== 'resolved' &&
            ['saved', 'rejected', 'reopened'].includes(state ?? '')) ||
          (action === 'reject' && state === 'saved') ||
          (action === 'ask' &&
            ticket.status === 'open' &&
            ['saved', 'rejected', 'reopened'].includes(state)) ||
          (action === 'priority' &&
            state === 'saved' &&
            ticket.draft &&
            priority === ticket.draft.suggested_priority &&
            priority !== ticket.priority) ||
          (action === 'reopen' && ticket.status === 'resolved')
        )
      ) {
        response.status(409).json({ error: 'Review action is not available' });
        return;
      }
      if (
        ['approve', 'ask'].includes(action) &&
        (typeof reply !== 'string' ||
          !reply.trim() ||
          reply.length > 5000 ||
          (action === 'approve' &&
            !['low', 'normal', 'high'].includes(priority)))
      ) {
        response
          .status(400)
          .json({ error: 'Enter a reply and choose a priority' });
        return;
      }
      const newState =
        action === 'approve'
          ? 'approved'
          : action === 'reject'
            ? 'rejected'
            : action === 'ask'
              ? state
              : action === 'priority'
                ? 'saved'
                : 'reopened';
      const newPriority =
        action === 'approve' || action === 'priority'
          ? priority
          : ticket.priority;
      const approvedReply =
        action === 'approve' ? reply.trim() : ticket.approved_reply;
      const description =
        action === 'approve'
          ? `Human approved in-app reply and set ${priority} priority: ${approvedReply}`
          : action === 'reject'
            ? 'Human rejected saved AI draft and priority suggestion'
            : action === 'ask'
              ? `Team asked for details: ${reply.trim()}`
              : action === 'priority'
                ? `Human approved ${priority} priority suggestion`
                : 'Human reopened request';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (action === 'approve' || action === 'ask') {
          const copies = await checkedCopies(
            reply.trim(),
            ticket.draft?.sources ?? [],
            client,
            ticket.draft?.internal_copies ?? [],
          );
          if (
            copies.length &&
            request.body.internal_confirmed !== reply.trim()
          ) {
            await client.query('ROLLBACK');
            response.status(409).json({
              error:
                'Internal text copied. Review the highlighted text before delivery.',
              internal_copies: copies,
            });
            return;
          }
        }
        const changed =
          ticket.review_state === null
            ? await client.query(
                `INSERT INTO ticket_reviews (session_id, ticket_id, state, priority, approved_reply)
              VALUES ($1, $2, $3, $4, $5) RETURNING state`,
                [
                  response.locals.session,
                  request.params.id,
                  newState,
                  newPriority,
                  approvedReply,
                ],
              )
            : await client.query(
                `UPDATE ticket_reviews SET state = $3, priority = $4, approved_reply = $5
              WHERE session_id = $1 AND ticket_id = $2 AND state = $6 RETURNING state`,
                [
                  response.locals.session,
                  request.params.id,
                  newState,
                  newPriority,
                  approvedReply,
                  ticket.review_state,
                ],
              );
        if (!changed.rows.length) {
          await client.query('ROLLBACK');
          response
            .status(409)
            .json({ error: 'Review action is no longer available' });
          return;
        }
        await client.query(
          `INSERT INTO ticket_events (id, ticket_id, session_id, description, created_at)
          VALUES (nextval('ticket_event_ids'), $1, $2, $3, $4)`,
          [
            request.params.id,
            response.locals.session,
            description,
            new Date().toISOString(),
          ],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        if ((error as { code?: string }).code === '23505') {
          response
            .status(409)
            .json({ error: 'Review action is no longer available' });
          return;
        }
        throw error;
      } finally {
        client.release();
      }
      response.json(
        await detail(request.params.id, response.locals.session, owner),
      );
    } catch (error) {
      next(error);
    }
  });

  app.use(
    (
      _error: unknown,
      request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = request.path === '/health' ? 503 : 500;
      console.error(
        JSON.stringify({
          event: 'api_error',
          method: request.method,
          route: request.route?.path ?? 'unknown',
          status,
        }),
      );
      response.status(status).json({ error: 'Service unavailable' });
    },
  );

  return app;
}
