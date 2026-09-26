import express from 'express';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export function createApp(pool: Pick<Pool, 'query' | 'connect'>) {
  const app = express();
  app.use(express.json());
  app.use((request, response, next) => {
    const session = request.headers.cookie?.match(/(?:^|;\s*)demo_session=([0-9a-f-]{36})(?:;|$)/)?.[1];
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

  app.get('/tickets', async (_request, response, next) => {
    try {
      const result = await pool.query(`
        SELECT id, customer_name, subject, status, priority, created_at
        FROM support_tickets
        WHERE session_id IS NULL OR (session_id = $1 AND created_at > NOW() - INTERVAL '1 day')
        ORDER BY created_at DESC, id DESC
      `, [response.locals.session]);
      response.json(result.rows);
    } catch (error) {
      next(error);
    }
  });

  app.post('/tickets', async (request, response, next) => {
    const question = request.body?.question;
    if (typeof question !== 'string' || !question.trim() || question.length > 5000) {
      response.status(400).json({ error: 'Enter a question of up to 5000 characters.' });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ticket_events WHERE ticket_id IN (
        SELECT id FROM support_tickets WHERE session_id IS NOT NULL AND created_at <= NOW() - INTERVAL '1 day'
      )`);
      await client.query("DELETE FROM support_tickets WHERE session_id IS NOT NULL AND created_at <= NOW() - INTERVAL '1 day'");
      const createdAt = new Date().toISOString();
      const ticket = await client.query(
        `INSERT INTO support_tickets (id, session_id, customer_name, subject, question, status, priority, created_at)
         VALUES (nextval('support_ticket_ids'), $1, 'Visitor', $2, $3, 'open', 'normal', $4)
         RETURNING id, customer_name, subject, question, status, priority, created_at`,
        [response.locals.session, question.trim().split('\n')[0].slice(0, 120), question.trim(), createdAt],
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

  app.get('/tickets/:id', async (request, response, next) => {
    try {
      if (!/^\d+$/.test(request.params.id)) {
        response.sendStatus(404);
        return;
      }
      const ticket = await pool.query(
        `SELECT id, customer_name, subject, question, status, priority, created_at
         FROM support_tickets WHERE id = $1 AND (session_id IS NULL OR (session_id = $2 AND created_at > NOW() - INTERVAL '1 day'))`,
        [request.params.id, response.locals.session],
      );
      if (!ticket.rows.length) {
        response.sendStatus(404);
        return;
      }
      const events = await pool.query(
        'SELECT id, description, created_at FROM ticket_events WHERE ticket_id = $1 ORDER BY created_at, id',
        [request.params.id],
      );
      response.json({ ...ticket.rows[0], history: events.rows });
    } catch (error) {
      next(error);
    }
  });

  return app;
}
