import express from 'express';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export function createApp(pool: Pick<Pool, 'query' | 'connect'>) {
  const app = express();
  app.use(express.json());
  function reviewedStatus(status: string, state?: string) {
    if (state === 'approved') return 'resolved';
    if (state === 'reopened') return 'open';
    return status;
  }
  async function detail(id: string, session: string) {
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
      draft: draft.rows.length
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

  app.get('/tickets', async (_request, response, next) => {
    try {
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
      const ticket = await detail(request.params.id, response.locals.session);
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
      const ticket = await detail(request.params.id, response.locals.session);
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
            : 'reopened';
      const newPriority = action === 'approve' ? priority : ticket.priority;
      const approvedReply =
        action === 'approve' ? reply.trim() : ticket.approved_reply;
      const description =
        action === 'approve'
          ? `Human approved in-app reply and set ${priority} priority: ${approvedReply}`
          : action === 'reject'
            ? 'Human rejected saved AI draft and priority suggestion'
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
      response.json(await detail(request.params.id, response.locals.session));
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
