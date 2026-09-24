import express from 'express';
import type { Pool } from 'pg';

export function createApp(pool: Pick<Pool, 'query'>) {
  const app = express();

  app.get('/tickets', async (_request, response, next) => {
    try {
      const result = await pool.query(`
        SELECT id, customer_name, subject, status, priority, created_at
        FROM support_tickets
        ORDER BY created_at DESC, id DESC
      `);
      response.json(result.rows);
    } catch (error) {
      next(error);
    }
  });

  app.get('/tickets/:id', async (request, response, next) => {
    try {
      if (!/^\d+$/.test(request.params.id)) {
        response.sendStatus(404);
        return;
      }
      const ticket = await pool.query('SELECT * FROM support_tickets WHERE id = $1', [request.params.id]);
      if (!ticket.rows.length) {
        response.sendStatus(404);
        return;
      }
      const events = await pool.query(
        'SELECT id, description, created_at FROM ticket_events WHERE ticket_id = $1 ORDER BY created_at, id',
        [request.params.id]
      );
      response.json({ ...ticket.rows[0], history: events.rows });
    } catch (error) {
      next(error);
    }
  });

  return app;
}