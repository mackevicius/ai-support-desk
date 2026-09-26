import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { newDb } from 'pg-mem';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApp } from '../../api/src/app.js';
import { submitQuestion } from '../app/data';
import { renderHome, renderTicketPage } from '../app/views';

const originalFetch = globalThis.fetch;
const sessionId = '3b28cc4f-9c8e-4a49-bc9d-52db402fd530';
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('a visitor sees the API queue and can open a request', async () => {
  globalThis.fetch = async () =>
    Response.json([
      {
        id: 1,
        customer_name: 'Maya Chen',
        subject: 'Cannot invite my team',
        status: 'open',
        priority: 'high',
        created_at: '2026-09-20T10:00:00.000Z',
      },
    ]);
  const html = renderToStaticMarkup(await renderHome(sessionId));
  assert.match(html, /Maya Chen/);
  assert.match(html, /Cannot invite my team/);
  assert.match(html, /href="\/tickets\/1"/);
});

test('a visitor submits a question and sees it without an answer draft', async () => {
  const requests: { url: string; options?: RequestInit }[] = [];
  globalThis.fetch = async (input, options) => {
    requests.push({ url: String(input), options });
    if (options?.method === 'POST') {
      return Response.json({ id: 5, question: 'How can I invite my team?' }, { status: 201 });
    }
    return Response.json([{ id: 5, customer_name: 'Visitor', subject: 'How can I invite my team?', status: 'open', priority: 'normal', created_at: '2026-09-27T10:00:00.000Z' }]);
  };
  const id = await submitQuestion('How can I invite my team?', sessionId);
  assert.equal(id, 5);
  const html = renderToStaticMarkup(await renderHome(sessionId));
  assert.match(html, /How can I invite my team\?/);
  assert.match(html, /name="question"/);
  assert.match(html, /href="\/tickets\/5"/);
  assert.ok(requests.every(({ options }) => options?.headers && (options.headers as Record<string, string>).cookie === `demo_session=${sessionId}`));
});

test('a visitor reads a request and its history in the focused view', async () => {
  const summary = {
    id: 1,
    customer_name: 'Maya Chen',
    subject: 'Cannot invite my team',
    status: 'open',
    priority: 'high',
    created_at: '2026-09-20T10:00:00.000Z',
  };
  globalThis.fetch = async (input) =>
    Response.json(
      String(input).endsWith('/tickets/1')
        ? {
            ...summary,
            question: 'Invites do not arrive.',
            history: [
              {
                id: 1,
                description: 'Request received',
                created_at: summary.created_at,
              },
            ],
          }
        : [summary],
    );
  const html = renderToStaticMarkup(await renderTicketPage('1', sessionId));
  assert.match(html, /Invites do not arrive/);
  assert.match(html, /high priority/i);
  assert.match(html, /open/i);
  assert.match(html, /Request received/);
  assert.doesNotMatch(html, /aria-label="Support inbox"/);
  assert.match(html, /Back to inbox/);
});

test('the seeded inbox can be browsed from the UI through the API', async () => {
  const database = newDb();
  database.public.none(
    readFileSync(new URL('../../db/seed.sql', import.meta.url), 'utf8'),
  );
  const { Pool } = database.adapters.createPg();
  const pool = new Pool();
  const apiServer = createApp(pool).listen(0);
  const previousUrl = process.env.API_URL;
  try {
    await new Promise<void>((resolve) => apiServer.once('listening', resolve));
    const address = apiServer.address();
    if (!address || typeof address === 'string')
      throw new Error('No server address');
    process.env.API_URL = `http://127.0.0.1:${address.port}`;
    const queue = renderToStaticMarkup(await renderHome(sessionId));
    assert.match(queue, /Team invitations are not arriving/);
    const ticketUrl = queue.match(/href="(\/tickets\/1)"/)?.[1];
    assert.ok(ticketUrl);
    const detail = renderToStaticMarkup(await renderTicketPage(ticketUrl.split('/').at(-1)!, sessionId));
    assert.match(detail, /I invited three teammates this morning/);
    assert.match(detail, /Assigned to the support inbox/);
    assert.doesNotMatch(detail, /aria-label="Support inbox"/);

    const id = await submitQuestion('How can I invite my team?', sessionId);
    const updatedQueue = renderToStaticMarkup(await renderHome(sessionId));
    assert.match(updatedQueue, new RegExp(`href="/tickets/${id}"`));
    const submittedDetail = renderToStaticMarkup(await renderTicketPage(String(id), sessionId));
    assert.match(submittedDetail, /How can I invite my team\?/);
    assert.match(submittedDetail, /Request received/);
    assert.match(submittedDetail, /No answer draft has been generated/);
    const otherSession = '08297b1e-13c9-47c1-b9db-35582e94e59b';
    assert.doesNotMatch(renderToStaticMarkup(await renderHome(otherSession)), new RegExp(`href="/tickets/${id}"`));
    const denied = await fetch(`${process.env.API_URL}/tickets/${id}`, {
      headers: { cookie: `demo_session=${otherSession}` },
    });
    assert.equal(denied.status, 404);
  } finally {
    if (previousUrl === undefined) delete process.env.API_URL;
    else process.env.API_URL = previousUrl;
    await new Promise<void>((resolve, reject) =>
      apiServer.close((error) => (error ? reject(error) : resolve())),
    );
    await pool.end();
  }
});
