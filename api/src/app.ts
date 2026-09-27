import express from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';

const ownerSessionAge = 8 * 60 * 60 * 1000;

function matchesSecret(provided: string, expected: string) {
  const actual = createHmac('sha256', 'owner-login').update(provided).digest();
  const target = createHmac('sha256', 'owner-login').update(expected).digest();
  return timingSafeEqual(actual, target);
}

function ownerSession(session: string) {
  const secret = process.env.OWNER_SESSION_SECRET;
  if (!secret) return null;
  const expiry = Date.now() + ownerSessionAge;
  const signature = createHmac('sha256', secret).update(`${session}.${expiry}`).digest('hex');
  return `${expiry}.${signature}`;
}

function isOwner(cookie: string | undefined, session: string) {
  const secret = process.env.OWNER_SESSION_SECRET;
  const token = cookie?.match(/(?:^|;\s*)owner_session=(\d+\.[a-f0-9]{64})(?:;|$)/)?.[1];
  if (!secret || !token) return false;
  const [expiry, signature] = token.split('.');
  if (Number(expiry) <= Date.now()) return false;
  const expected = createHmac('sha256', secret).update(`${session}.${expiry}`).digest('hex');
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

export function createApp(pool: Pick<Pool, 'query' | 'connect'>) {
  const app = express();
  app.use(express.json());
  function reviewedStatus(status: string, state?: string) {
    if (state === 'approved') return 'resolved';
    if (state === 'reopened') return 'open';
    return status;
  }
  async function detail(id: string, session: string, owner = false) {
    const ticket = await pool.query(
      `SELECT id, customer_name, subject, question, status, priority, created_at
       FROM support_tickets WHERE id = $1 AND (session_id IS NULL OR (session_id = $2 AND created_at > NOW() - INTERVAL '1 day'))`,
      [id, session],
    );
    if (!ticket.rows.length) return null;
    const review = await pool.query(
      'SELECT state, priority, approved_reply FROM ticket_reviews WHERE ticket_id = $1 AND session_id = $2',
      [id, session],
    );
    const draft = await pool.query(
      `SELECT d.reply, d.suggested_priority, a.id, a.title, a.body
       FROM saved_drafts d JOIN help_articles a ON a.id = d.article_id WHERE d.ticket_id = $1`,
      [id],
    );
    const live = owner
      ? await pool.query(
          'SELECT reply, suggested_priority, source_ids FROM session_drafts WHERE ticket_id = $1 AND session_id = $2',
          [id, session],
        )
      : { rows: [] };
    const articles = live.rows.length
      ? await pool.query('SELECT id, title, body FROM help_articles')
      : null;
    const liveSources = live.rows.length
      ? (JSON.parse(live.rows[0].source_ids) as number[]).map((sourceId) =>
          articles!.rows.find((article) => article.id === sourceId),
        )
      : [];
    const events = await pool.query(
      `SELECT id, description, created_at FROM ticket_events
       WHERE ticket_id = $1 AND (session_id IS NULL OR session_id = $2) ORDER BY created_at, id`,
      [id, session],
    );
    const current = review.rows[0];
    return {
      ...ticket.rows[0],
      status: reviewedStatus(ticket.rows[0].status, current?.state),
      priority: current?.priority ?? ticket.rows[0].priority,
      approved_reply: current?.approved_reply ?? null,
      review_state: current?.state ?? null,
      draft: live.rows.length
        ? {
            live: true,
            state: current?.state ?? 'saved',
            reply: live.rows[0].reply,
            suggested_priority: live.rows[0].suggested_priority,
            sources: liveSources,
          }
        : draft.rows.length
        ? {
            state: current?.state ?? 'saved',
            reply: draft.rows[0].reply,
            suggested_priority: draft.rows[0].suggested_priority,
            sources: [
              {
                id: draft.rows[0].id,
                title: draft.rows[0].title,
                body: draft.rows[0].body,
              },
            ],
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

  app.post('/owner/login', (request, response) => {
    const password = process.env.OWNER_PASSWORD;
    const secret = process.env.OWNER_SESSION_SECRET;
    if (!password || !secret) {
      response.status(503).json({ error: 'Owner login is unavailable' });
      return;
    }
    if (typeof request.body?.password !== 'string' || !matchesSecret(request.body.password, password)) {
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

  app.post('/tickets/:id/generate', async (request, response, next) => {
    if (!isOwner(request.headers.cookie, response.locals.session)) {
      response.sendStatus(403);
      return;
    }
    try {
      if (!/^\d+$/.test(request.params.id)) {
        response.sendStatus(404);
        return;
      }
      const ticket = await detail(request.params.id, response.locals.session, true);
      if (!ticket) {
        response.sendStatus(404);
        return;
      }
      const existing = await pool.query(
        'SELECT ticket_id FROM session_drafts WHERE ticket_id = $1 AND session_id = $2',
        [request.params.id, response.locals.session],
      );
      if (ticket.status === 'resolved' || ticket.review_state || existing.rows.length) {
        response.status(409).json({ error: 'Generation is not available for this request' });
        return;
      }
      if (!process.env.PYTHON_URL || !process.env.AI_SERVICE_SECRET) {
        response.status(503).json({ error: 'Live generation is unavailable' });
        return;
      }
      const articles = (await pool.query('SELECT id, title, body FROM help_articles ORDER BY id')).rows;
      const body = JSON.stringify({ question: ticket.question, articles });
      const reservedTokens = Buffer.byteLength(body) * 6 + 4096 + 300;
      const day = new Date().toISOString().slice(0, 10);
      await pool.query(
        'INSERT INTO generation_usage (day, requests, reserved_tokens) VALUES ($1, 0, 0) ON CONFLICT (day) DO NOTHING',
        [day],
      );
      const allowance = await pool.query(
        `UPDATE generation_usage SET requests = requests + 1, reserved_tokens = reserved_tokens + $2
         WHERE day = $1 AND requests < 20 AND reserved_tokens + $2 <= 400000 RETURNING requests`,
        [day, reservedTokens],
      );
      if (!allowance.rows.length) {
        response.status(429).json({ error: 'Daily generation limit reached' });
        return;
      }
      const generated = await fetch(`${process.env.PYTHON_URL}/generate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.AI_SERVICE_SECRET}`,
        },
        body,
        signal: AbortSignal.timeout(12000),
      });
      if (!generated.ok) {
        response.status(502).json({ error: 'Live generation is unavailable' });
        return;
      }
      const suggestion = await generated.json();
      if (
        typeof suggestion.reply !== 'string' || !suggestion.reply.trim() ||
        suggestion.reply.length > 5000 ||
        !['low', 'normal', 'high'].includes(suggestion.suggested_priority) ||
        !Array.isArray(suggestion.source_ids) ||
        suggestion.source_ids.some((id: unknown) => !Number.isInteger(id) || !articles.some((article) => article.id === id)) ||
        new Set(suggestion.source_ids).size !== suggestion.source_ids.length
      ) {
        response.status(502).json({ error: 'Invalid generation response' });
        return;
      }
      await pool.query(
        `INSERT INTO session_drafts (session_id, ticket_id, reply, suggested_priority, source_ids)
         VALUES ($1, $2, $3, $4, $5)`,
        [response.locals.session, request.params.id, suggestion.reply.trim(), suggestion.suggested_priority, JSON.stringify(suggestion.source_ids)],
      );
      response.json(await detail(request.params.id, response.locals.session, true));
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        response.status(409).json({ error: 'Generation is no longer available' });
        return;
      }
      next(error);
    }
  });

  app.get('/tickets', async (_request, response, next) => {
    try {
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
        result.rows.map((ticket) => {
          const review = reviews.rows.find(
            (item) => item.ticket_id === ticket.id,
          );
          return review
            ? {
                ...ticket,
                status: reviewedStatus(ticket.status, review.state),
                priority: review.priority,
              }
            : ticket;
        }),
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
      const event = await client.query(
        `INSERT INTO ticket_events (id, ticket_id, description, created_at)
         VALUES (nextval('ticket_event_ids'), $1, 'Request received', $2)
         RETURNING id, description, created_at`,
        [ticket.rows[0].id, createdAt],
      );
      await client.query('COMMIT');
      response.status(201).json({ ...ticket.rows[0], history: event.rows });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
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
        request.params.id, response.locals.session,
        isOwner(request.headers.cookie, response.locals.session),
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

  app.post('/tickets/:id/review', async (request, response, next) => {
    try {
      if (!/^\d+$/.test(request.params.id)) {
        response.sendStatus(404);
        return;
      }
      const owner = isOwner(request.headers.cookie, response.locals.session);
      if (!owner) {
        const live = await pool.query(
          'SELECT ticket_id FROM session_drafts WHERE ticket_id = $1 AND session_id = $2',
          [request.params.id, response.locals.session],
        );
        if (live.rows.length) {
          response.sendStatus(403);
          return;
        }
      }
      const ticket = await detail(request.params.id, response.locals.session, owner);
      if (!ticket) {
        response.sendStatus(404);
        return;
      }
      if (
        !ticket.draft &&
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
      const state = ticket.review_state ?? ticket.draft?.state;
      if (
        !(
          (action === 'approve' &&
            ['saved', 'rejected', 'reopened'].includes(state ?? '')) ||
          (action === 'reject' && state === 'saved') ||
          (action === 'priority' && state === 'saved' && ticket.draft &&
            priority === ticket.draft.suggested_priority && priority !== ticket.priority) ||
          (action === 'reopen' && ticket.status === 'resolved')
        )
      ) {
        response.status(409).json({ error: 'Review action is not available' });
        return;
      }
      if (
        action === 'approve' &&
        (typeof reply !== 'string' ||
          !reply.trim() ||
          reply.length > 5000 ||
          !['low', 'normal', 'high'].includes(priority))
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
            : action === 'priority'
              ? 'saved'
              : 'reopened';
      const newPriority = action === 'approve' || action === 'priority' ? priority : ticket.priority;
      const approvedReply =
        action === 'approve' ? reply.trim() : ticket.approved_reply;
      const description =
        action === 'approve'
          ? `Human approved in-app reply and set ${priority} priority: ${approvedReply}`
          : action === 'reject'
            ? 'Human rejected saved AI draft and priority suggestion'
            : action === 'priority'
              ? `Human approved ${priority} priority suggestion`
            : 'Human reopened request';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
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
      response.json(await detail(request.params.id, response.locals.session, owner));
    } catch (error) {
      next(error);
    }
  });

  app.use((
    _error: unknown,
    request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    const status = request.path === '/health' ? 503 : 500;
    console.error(JSON.stringify({
      event: 'api_error',
      method: request.method,
      route: request.route?.path ?? 'unknown',
      status,
    }));
    response.status(status).json({ error: 'Service unavailable' });
  });

  return app;
}
