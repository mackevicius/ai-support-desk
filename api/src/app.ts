import express from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { draftAnswer, redraftAnswer } from './answer-drafting.js';
import { liveAllowance } from './generation.js';
import { scoreQualityReport } from './quality.js';
import {
  embedDocument,
  embeddingModel,
  logEmbeddingUsage,
  type EmbeddingUsage,
} from './embeddings.js';
import {
  internalCopies,
  internalDocuments,
  type InternalCopy,
} from './internal-copy.js';
import {
  createTicketLifecycle,
  ticketStatus,
  type Outcome,
  type TicketAction,
  type Visitor,
} from './ticket-lifecycle.js';
import { recordHistory } from './ticket-history.js';
import { createTicketReader } from './ticket-read.js';

const httpStatus: Record<Outcome['kind'], number> = {
  ok: 201,
  not_found: 404,
  forbidden: 403,
  invalid: 400,
  unavailable: 409,
  conflict: 409,
  internal_copies: 409,
};

const ownerSessionAge = 8 * 60 * 60 * 1000;
const statusOrder: Record<string, number> = {
  open: 0,
  waiting_on_customer: 1,
  solved: 2,
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

function visitorOf(request: express.Request, session: string): Visitor {
  return {
    session,
    owner: isOwner(request.headers.cookie, session),
    seat: /(?:^|;\s*)demo_seat=agent(?:;|$)/.test(request.headers.cookie ?? '')
      ? 'agent'
      : 'customer',
  };
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
  const tickets = createTicketReader(pool, checkedCopies);
  const lifecycle = createTicketLifecycle(pool, {
    read: tickets.load,
    checkCopies: checkedCopies,
  });
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
        'SELECT id, title, body, retired, kind, embedding, embedding_model FROM help_articles ORDER BY id',
      );
      response.json(articles.rows);
    } catch (error) {
      next(error);
    }
  });

  app.get('/quality/live', async (_request, response, next) => {
    try {
      const saved = await pool.query(
        'SELECT report FROM quality_reports WHERE mode = $1',
        ['live'],
      );
      if (!saved.rows.length) {
        response.sendStatus(404);
        return;
      }
      response.json(JSON.parse(saved.rows[0].report));
    } catch (error) {
      next(error);
    }
  });

  app.post('/quality/live', async (request, response, next) => {
    if (!isOwner(request.headers.cookie, response.locals.session)) {
      response.sendStatus(403);
      return;
    }
    if (!process.env.PYTHON_URL || !process.env.AI_SERVICE_SECRET) {
      response.sendStatus(503);
      return;
    }
    try {
      const day = new Date().toISOString().slice(0, 10);
      await pool.query(
        'INSERT INTO generation_usage (day, requests) VALUES ($1, 0) ON CONFLICT (day) DO NOTHING',
        [day],
      );
      const allowance = await pool.query(
        'UPDATE generation_usage SET requests = requests + 20 WHERE day = $1 AND requests <= 180 AND paused = false RETURNING requests',
        [day],
      );
      if (!allowance.rows.length) {
        response.sendStatus(429);
        return;
      }
      const result = await fetch(`${process.env.PYTHON_URL}/evaluate`, {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.AI_SERVICE_SECRET}` },
        signal: AbortSignal.timeout(180_000),
      });
      if (!result.ok) {
        response.sendStatus(503);
        return;
      }
      const rawReport = await result.json();
      if (
        rawReport.mode !== 'live' ||
        !Array.isArray(rawReport.cases) ||
        rawReport.cases.length > 20
      ) {
        response.sendStatus(503);
        return;
      }
      const report = scoreQualityReport(rawReport);
      await pool.query(
        'INSERT INTO quality_reports (mode, report) VALUES ($1, $2) ON CONFLICT (mode) DO UPDATE SET report = EXCLUDED.report',
        ['live', JSON.stringify(report)],
      );
      response.json(report);
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
      const vector = await embedDocument(
        pool,
        title,
        body,
        response.locals.session,
      );
      const article = await pool.query(
        "INSERT INTO help_articles (id, title, body, kind, embedding, embedding_model) VALUES (nextval('help_article_ids'), $1, $2, $3, $4, $5) RETURNING id, title, body, retired, kind",
        [
          title.trim(),
          body.trim(),
          kind,
          JSON.stringify(vector),
          embeddingModel,
        ],
      );
      response.status(201).json(article.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.get('/visitor/help-articles', async (request, response, next) => {
    if (
      !/(?:^|;\s*)demo_seat=agent(?:;|$)/.test(request.headers.cookie ?? '')
    ) {
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
    if (
      !/(?:^|;\s*)demo_seat=agent(?:;|$)/.test(request.headers.cookie ?? '')
    ) {
      response.sendStatus(403);
      return;
    }
    if (
      !validArticle(request.body) ||
      (request.body.kind !== undefined && request.body.kind !== 'help_article')
    ) {
      response.status(400).json({
        error:
          'Enter a help article with a title up to 200 characters and content up to 5000 characters.',
      });
      return;
    }
    const embeddingUsage: EmbeddingUsage[] = [];
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
      const vector = await embedDocument(
        client,
        request.body.title,
        request.body.body,
        response.locals.session,
        embeddingUsage,
      );
      const article = await client.query(
        `INSERT INTO visitor_help_articles (id, session_id, title, body, embedding, embedding_model)
         VALUES (nextval('help_article_ids'), $1, $2, $3, $4, $5) RETURNING id, title, body, 'help_article' AS kind`,
        [
          response.locals.session,
          request.body.title.trim(),
          request.body.body.trim(),
          JSON.stringify(vector),
          embeddingModel,
        ],
      );
      await client.query('COMMIT');
      response.status(201).json(article.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
      await logEmbeddingUsage(pool, embeddingUsage);
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
      const vector = await embedDocument(
        pool,
        title,
        body,
        response.locals.session,
      );
      const article = await pool.query(
        'UPDATE help_articles SET title = $1, body = $2, retired = $3, kind = COALESCE($5, kind), embedding = $6, embedding_model = $7 WHERE id = $4 RETURNING id, title, body, retired, kind',
        [
          title.trim(),
          body.trim(),
          retired,
          request.params.id,
          kind ?? null,
          JSON.stringify(vector),
          embeddingModel,
        ],
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
      const ticket = await tickets.load(
        request.params.id,
        response.locals.session,
        owner,
      );
      if (!ticket) {
        response.sendStatus(404);
        return;
      }
      if (ticket.status === 'solved') {
        response
          .status(409)
          .json({ error: 'Generation is not available for this request' });
        return;
      }
      if (!ticket.can_redraft) {
        response.sendStatus(403);
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
        await tickets.read(
          request.params.id,
          visitorOf(request, response.locals.session),
        ),
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
                  status: ticketStatus(ticket.status, review.state),
                  priority: review.priority,
                  review_state: review.state,
                }
              : ticket;
          })
          .filter(
            (ticket) =>
              !['open', 'waiting_on_customer', 'solved'].includes(
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
      await recordHistory(
        client,
        ticket.rows[0].id,
        null,
        { kind: 'request_received' },
        { createdAt },
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
        .json(
          await tickets.read(
            ticketId,
            visitorOf(request, response.locals.session),
          ),
        );
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
      const ticket = await tickets.read(
        request.params.id,
        visitorOf(request, response.locals.session),
      );
      if (!ticket) {
        response.sendStatus(404);
        return;
      }
      response.json(ticket);
    } catch (error) {
      next(error);
    }
  });

  function customerRoute(
    action: (body: { message?: unknown } | undefined) => TicketAction,
  ): express.RequestHandler<{ id: string }> {
    return async (request, response, next) => {
      try {
        const outcome = await lifecycle.apply(
          request.params.id,
          visitorOf(request, response.locals.session),
          action(request.body),
        );
        if (outcome.kind === 'invalid') {
          response
            .status(400)
            .json({ error: 'Enter a message of up to 5000 characters.' });
          return;
        }
        response.sendStatus(httpStatus[outcome.kind]);
      } catch (error) {
        next(error);
      }
    };
  }
  app.post(
    '/tickets/:id/solve',
    customerRoute(() => ({ type: 'solve' })),
  );
  app.post(
    '/tickets/:id/hand-off',
    customerRoute(() => ({ type: 'hand_off' })),
  );
  app.post(
    '/tickets/:id/messages',
    customerRoute((body) => ({ type: 'message', text: body?.message })),
  );

  app.post('/tickets/:id/check', async (request, response, next) => {
    try {
      const ticket = /^\d+$/.test(request.params.id)
        ? await tickets.load(request.params.id, response.locals.session, true)
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
      const { action, reply, priority, internal_confirmed } =
        request.body ?? {};
      if (action !== 'reply' && action !== 'priority') {
        response.status(409).json({ error: 'Review action is not available' });
        return;
      }
      const visitor = visitorOf(request, response.locals.session);
      const outcome = await lifecycle.apply(
        request.params.id,
        visitor,
        action === 'reply'
          ? {
              type: 'reply',
              text: reply,
              internalConfirmed: internal_confirmed,
            }
          : { type: 'priority', priority },
      );
      if (outcome.kind === 'ok') {
        response.json(await tickets.read(request.params.id, visitor));
        return;
      }
      if (outcome.kind === 'not_found') {
        response.sendStatus(404);
        return;
      }
      response.status(httpStatus[outcome.kind]).json(
        outcome.kind === 'internal_copies'
          ? {
              error:
                'Internal text copied. Review the highlighted text before delivery.',
              internal_copies: outcome.copies,
            }
          : {
              error:
                outcome.kind === 'invalid'
                  ? 'Enter a reply'
                  : outcome.kind === 'conflict'
                    ? 'Review action is no longer available'
                    : 'Review action is not available',
            },
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
