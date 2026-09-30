import express from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { generateDraft, liveAllowance } from './generation.js';

const ownerSessionAge = 8 * 60 * 60 * 1000;
const statusOrder: Record<string, number> = { open: 0, pending: 1, resolved: 2 };

function validArticle(input: unknown): input is { title: string; body: string; retired?: boolean } {
  if (!input || typeof input !== 'object') return false;
  const { title, body } = input as { title?: unknown; body?: unknown };
  return typeof title === 'string' && !!title.trim() && title.length <= 200 &&
    typeof body === 'string' && !!body.trim() && body.length <= 5000;
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

function decide(question: string, generated: Awaited<ReturnType<typeof generateDraft>>, agentReview = false) {
  const draft = generated.draft;
  const risky = /\b(refunds?|charg(?:e|ed|es|ing)|bill(?:ed|s|ing)?|pay(?:ment|ments|ing)?|paid|price|pricing|cost|card|money|purchase|subscription|cancel|passwords?|credentials?|hack(?:ed|ing)?|compromis(?:e|ed)|breach(?:ed)?|security|stolen|unauthori[sz]ed|accounts?|log(?:ged|ging)?[ -]?in(?:to)?|sign.?in|two.factor|2fa|verification code|locked|identity|fraud)\b/i.test(question);
  const internal = draft?.sources.some((source) => source.kind !== 'help_article');
  const covered = draft?.clearly_covered === true && draft.sources.length > 0;
  const automatic = covered && draft?.requires_team === false && !internal && !risky && !agentReview;
  const outcome = generated.error === 'paused'
    ? { rule: 'Live allowance exhausted', reason: 'Live AI is paused for today' }
    : risky ? { rule: 'Money or account security', reason: 'A team member needs to check questions about money or account security.' }
    : internal ? { rule: 'Staff-only information', reason: 'The answer relies on information meant for Tunely staff.' }
    : !covered ? { rule: 'Weak help article coverage', reason: 'There is not enough clear help article coverage to answer automatically.' }
    : draft?.requires_team !== false ? { rule: 'Provider requested team review', reason: 'A team member needs to check this question before we can answer.' }
    : agentReview ? { rule: 'Agent review required', reason: 'An agent requested a new draft; it needs approval before delivery.' }
    : { rule: 'Clearly covered by public help articles', reason: 'A help article clearly covers your question, and it does not need a team member to check it.' };
  return { kind: automatic ? 'automatic_reply' : 'hand_off', ...outcome,
    topic: draft?.topic ?? 'Unclassified', suggested_priority: draft?.suggested_priority ?? 'normal',
    documents: draft?.sources.map(({ id, title, kind }) => ({ id, title, kind })) ?? [],
    sources: draft?.sources.filter((source) => source.kind === 'help_article') ?? [], paused: generated.error === 'paused' };
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
      `SELECT id, customer_name, subject, question, status, priority, created_at, decision
       FROM support_tickets WHERE id = $1 AND (session_id IS NULL OR (session_id = $2 AND created_at > NOW() - INTERVAL '1 day'))`,
      [id, session],
    );
    if (!ticket.rows.length) return null;
    const review = await pool.query(
      'SELECT state, priority, approved_reply FROM ticket_reviews WHERE ticket_id = $1 AND session_id = $2',
      [id, session],
    );
    const draft = await pool.query(
      `SELECT d.reply, d.suggested_priority, a.id, d.article_title AS title, d.article_body AS body
       FROM saved_drafts d JOIN help_articles a ON a.id = d.article_id WHERE d.ticket_id = $1`,
      [id],
    );
    const decision = ticket.rows[0].decision ? JSON.parse(ticket.rows[0].decision) : null;
    const live = owner || decision
      ? await pool.query(
          'SELECT reply, suggested_priority, source_ids, source_articles FROM session_drafts WHERE ticket_id = $1 AND session_id = $2',
          [id, session],
        )
      : { rows: [] };
    const articles = live.rows.length
      ? await pool.query('SELECT id, title, body FROM help_articles')
      : null;
    const liveSources = live.rows.length
      ? live.rows[0].source_articles
        ? JSON.parse(live.rows[0].source_articles)
        : (JSON.parse(live.rows[0].source_ids) as number[]).map((sourceId) =>
            articles!.rows.find((article) => article.id === sourceId),
          )
      : [];
    const events = await pool.query(
      `SELECT id, description, created_at FROM ticket_events
       WHERE ticket_id = $1 AND (session_id IS NULL OR session_id = $2) ORDER BY created_at, id`,
      [id, session],
    );
    const current = review.rows[0];
    const { decision: storedDecision, ...ticketFields } = ticket.rows[0];
    return {
      ...ticketFields,
      ...(decision ? { decision, live_ai: await liveAllowance(pool, session) } : {}),
      status: reviewedStatus(ticket.rows[0].status, current?.state),
      priority: current?.priority ?? ticket.rows[0].priority,
      approved_reply: current?.approved_reply ?? (decision?.kind === 'automatic_reply' ? live.rows[0]?.reply : null) ?? null,
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

  app.get('/help-articles', async (request, response, next) => {
    if (!isOwner(request.headers.cookie, response.locals.session)) {
      response.sendStatus(403);
      return;
    }
    try {
      const articles = await pool.query('SELECT id, title, body, retired FROM help_articles ORDER BY id');
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
      response.status(400).json({ error: 'Enter a title and body within the allowed lengths.' });
      return;
    }
    const { title, body } = request.body;
    try {
      const article = await pool.query(
        "INSERT INTO help_articles (id, title, body) VALUES (nextval('help_article_ids'), $1, $2) RETURNING id, title, body, retired",
        [title.trim(), body.trim()],
      );
      response.status(201).json(article.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/help-articles/:id', async (request, response, next) => {
    if (!isOwner(request.headers.cookie, response.locals.session)) {
      response.sendStatus(403);
      return;
    }
    if (!/^\d+$/.test(request.params.id) || !validArticle(request.body) ||
        typeof request.body.retired !== 'boolean') {
      response.status(400).json({ error: 'Enter a valid article, title, body and status.' });
      return;
    }
    const { title, body, retired } = request.body;
    try {
      const article = await pool.query(
        'UPDATE help_articles SET title = $1, body = $2, retired = $3 WHERE id = $4 RETURNING id, title, body, retired',
        [title.trim(), body.trim(), retired, request.params.id],
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
      const ticket = await detail(request.params.id, response.locals.session, true);
      if (!ticket) {
        response.sendStatus(404);
        return;
      }
      if (!owner && !ticket.decision) {
        response.sendStatus(403);
        return;
      }
      if (ticket.status === 'resolved') {
        response.status(409).json({ error: 'Generation is not available for this request' });
        return;
      }
      const generated = await generateDraft(pool, response.locals.session, ticket.question, owner);
      if (!generated.draft) {
        response.status(generated.error === 'paused' ? 429 : 502).json({ error: generated.error === 'paused' ? 'Live AI is paused for today' : 'Live generation is unavailable' });
        return;
      }
      const suggestion = generated.draft;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const state = !ticket.decision && ticket.review_state === 'reopened' ? 'reopened' : 'saved';
        const changed = ticket.review_state === null
          ? await client.query(`INSERT INTO ticket_reviews (session_id, ticket_id, state, priority, approved_reply)
              VALUES ($1, $2, $3, $4, $5) ON CONFLICT (session_id, ticket_id) DO NOTHING RETURNING state`,
              [response.locals.session, request.params.id, state, ticket.priority, ticket.approved_reply])
          : await client.query(`UPDATE ticket_reviews SET state = $3
              WHERE session_id = $1 AND ticket_id = $2 AND state = $4 RETURNING state`,
              [response.locals.session, request.params.id, state, ticket.review_state]);
        if (!changed.rows.length) {
          await client.query('ROLLBACK');
          response.status(409).json({ error: 'Generation is no longer available' });
          return;
        }
        await client.query(
          `INSERT INTO session_drafts (session_id, ticket_id, reply, suggested_priority, source_ids, source_articles)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (session_id, ticket_id) DO UPDATE SET reply = EXCLUDED.reply,
           suggested_priority = EXCLUDED.suggested_priority, source_ids = EXCLUDED.source_ids,
           source_articles = EXCLUDED.source_articles`,
          [response.locals.session, request.params.id, suggestion.reply.trim(), suggestion.suggested_priority,
            JSON.stringify(suggestion.source_ids), JSON.stringify(suggestion.sources)],
        );
        if (ticket.decision) {
          const decision = decide(ticket.question, generated, true);
          await client.query("UPDATE support_tickets SET status = 'open', decision = $1 WHERE id = $2", [JSON.stringify(decision), request.params.id]);
          await client.query(`INSERT INTO ticket_events (id, ticket_id, session_id, description, created_at)
            VALUES (nextval('ticket_event_ids'), $1, $2, $3, $4)`,
            [request.params.id, response.locals.session, `Hand-off: ${decision.reason}`, new Date().toISOString()]);
        }
        await client.query(`INSERT INTO ticket_events (id, ticket_id, session_id, description, created_at)
          VALUES (nextval('ticket_event_ids'), $1, $2, 'Agent requested a new answer draft', $3)`,
          [request.params.id, response.locals.session, new Date().toISOString()]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      response.json(await detail(request.params.id, response.locals.session, true));
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        response.status(409).json({ error: 'Generation is no longer available' });
        return;
      }
      next(error);
    }
  });

  app.get('/tickets', async (request, response, next) => {
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
                review_state: review.state,
              }
            : ticket;
        }).filter((ticket) => !['open', 'pending', 'resolved'].includes(String(request.query.status)) || ticket.status === request.query.status)
          .sort((first, second) => (statusOrder[first.status] ?? 1) - (statusOrder[second.status] ?? 1)),
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
      const generated = await generateDraft(pool, response.locals.session, question.trim(), isOwner(request.headers.cookie, response.locals.session));
      const draft = generated.draft;
      const decision = decide(question, generated);
      const automatic = decision.kind === 'automatic_reply';
      if (draft) {
        await pool.query(`INSERT INTO session_drafts (session_id, ticket_id, reply, suggested_priority, source_ids, source_articles)
          VALUES ($1, $2, $3, $4, $5, $6)`, [response.locals.session, ticketId, draft.reply, draft.suggested_priority, JSON.stringify(draft.source_ids), JSON.stringify(draft.sources)]);
      }
      await pool.query('UPDATE support_tickets SET status = $1, decision = $2 WHERE id = $3', [automatic ? 'resolved' : 'open', JSON.stringify(decision), ticketId]);
      await pool.query(`INSERT INTO ticket_events (id, ticket_id, description, created_at) VALUES (nextval('ticket_event_ids'), $1, $2, $3)`,
        [ticketId, `${automatic ? 'Automatic reply' : 'Hand-off'}: ${decision.reason}`, new Date().toISOString()]);
      response.status(201).json(await detail(ticketId, response.locals.session));
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
      const ticket = await detail(request.params.id, response.locals.session, owner);
      if (!ticket) {
        response.sendStatus(404);
        return;
      }
      if (
        !ticket.draft &&
        !(['approve', 'ask'].includes(request.body?.action) && ticket.status === 'open') &&
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
          (action === 'approve' && ticket.status !== 'resolved' &&
            ['saved', 'rejected', 'reopened'].includes(state ?? '')) ||
          (action === 'reject' && state === 'saved') ||
          (action === 'ask' && ticket.status === 'open' && ['saved', 'rejected', 'reopened'].includes(state)) ||
          (action === 'priority' && state === 'saved' && ticket.draft &&
            priority === ticket.draft.suggested_priority && priority !== ticket.priority) ||
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
          (action === 'approve' && !['low', 'normal', 'high'].includes(priority)))
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
      const newPriority = action === 'approve' || action === 'priority' ? priority : ticket.priority;
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
