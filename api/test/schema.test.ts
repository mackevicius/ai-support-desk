import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newDb } from 'pg-mem';
import { createApp } from '../src/app.js';
import { prepareDatabase } from '../src/schema.js';
import { close, listening, ownerEnv, withEnv } from './helpers.js';

test('an existing inbox keeps its data when the session schema is installed', async () => {
  const oldDatabase = newDb();
  oldDatabase.public.none(`
    CREATE TABLE support_tickets (
      id integer PRIMARY KEY, customer_name text NOT NULL, subject text NOT NULL,
      question text NOT NULL, status text NOT NULL, priority text NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE ticket_events (
      id integer PRIMARY KEY, ticket_id integer NOT NULL REFERENCES support_tickets(id),
      description text NOT NULL, created_at timestamptz NOT NULL
    );
    INSERT INTO support_tickets VALUES
      (1, 'Maya Chen', 'Existing request', 'Can you help?', 'open', 'normal', '2026-09-20T10:00:00Z');
    CREATE TABLE help_articles (id integer PRIMARY KEY, title text NOT NULL, body text NOT NULL);
    INSERT INTO help_articles VALUES
      (5, 'Owner article five', 'Keep five'), (6, 'Owner article six', 'Keep six'), (7, 'Owner article seven', 'Keep seven');
  `);
  const { Pool: OldPool } = oldDatabase.adapters.createPg();
  const oldPool = new OldPool();
  await prepareDatabase(oldPool);
  await prepareDatabase(oldPool);
  await oldPool.query('DROP SEQUENCE ticket_event_ids');
  await prepareDatabase(oldPool);
  const oldServer = createApp(oldPool).listen(0);
  try {
    await withEnv(ownerEnv, async () => {
      const url = await listening(oldServer);
      const inbox = await fetch(`${url}/tickets`);
      assert.equal((await inbox.json())[0].subject, 'Existing request');
      const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
      const login = await fetch(`${url}/owner/login`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'test-password' }),
      });
      const articles = await (
        await fetch(`${url}/help-articles`, {
          headers: {
            cookie: `${cookie}; ${login.headers.get('set-cookie')!.split(';')[0]}`,
          },
        })
      ).json();
      for (const title of [
        'Offline downloads',
        'Family plan invitations',
        'Changing audio quality',
      ]) {
        assert.equal(
          articles.filter(
            (article: { title: string }) => article.title === title,
          ).length,
          1,
        );
      }
      assert.equal(
        articles.find((article: { id: number }) => article.id === 5).body,
        'Keep five',
      );
      const submitted = await fetch(`${url}/tickets`, {
        method: 'POST',
        headers: {
          cookie: inbox.headers.get('set-cookie')!.split(';')[0],
          'content-type': 'application/json',
        },
        body: JSON.stringify({ question: 'A new question' }),
      });
      assert.equal(submitted.status, 201);
      assert.equal(
        (await submitted.json()).history[0].description,
        'Request received',
      );
    });
  } finally {
    await close(oldServer);
    await oldPool.end();
  }
});

test('an empty database starts with the fictional inbox and keeps visitor changes on restart', async () => {
  const freshDatabase = newDb();
  const { Pool: FreshPool } = freshDatabase.adapters.createPg();
  const freshPool = new FreshPool();
  try {
    await prepareDatabase(freshPool);
    const freshServer = createApp(freshPool).listen(0);
    try {
      const url = await listening(freshServer);
      const inbox = await fetch(`${url}/tickets`);
      assert.deepEqual(
        (await inbox.json()).map((ticket: { id: number }) => ticket.id),
        [1, 2, 3, 4, 5],
      );
      const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
      const submitted = await fetch(`${url}/tickets`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'Keep this after restart' }),
      });
      assert.equal(submitted.status, 201);
      const { id } = await submitted.json();
      await prepareDatabase(freshPool);
      const starter = await (await fetch(`${url}/tickets/1`, { headers: { cookie } })).json();
      assert.ok(starter.draft.reply);
      assert.equal(starter.history.length, 2);
      const kept = await fetch(`${url}/tickets/${id}`, { headers: { cookie } });
      assert.equal(kept.status, 200);
    } finally {
      await close(freshServer);
    }
  } finally {
    await freshPool.end();
  }
});

test('a Dayline-era inbox is replaced with saved Tunely cases only once', async () => {
  const database = newDb();
  database.public.none(`
    CREATE TABLE support_tickets (
      id integer PRIMARY KEY, customer_name text NOT NULL, subject text NOT NULL,
      question text NOT NULL, status text NOT NULL, priority text NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE ticket_events (
      id integer PRIMARY KEY, ticket_id integer NOT NULL REFERENCES support_tickets(id),
      description text NOT NULL, created_at timestamptz NOT NULL
    );
    INSERT INTO support_tickets VALUES
      (1, 'Maya Chen', 'Team invitations are not arriving', 'Invite teammates', 'open', 'high', '2026-09-20T10:00:00Z');
    CREATE TABLE help_articles (id integer PRIMARY KEY, title text NOT NULL, body text NOT NULL);
    INSERT INTO help_articles VALUES (1, 'Inviting teammates', 'Workspace invitations');
  `);
  const { Pool } = database.adapters.createPg();
  const pool = new Pool();
  await prepareDatabase(pool);
  const server = createApp(pool).listen(0);
  try {
    const url = await listening(server);
    const inbox = await fetch(`${url}/tickets`);
    const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await inbox.json()).length, 5);
    const detail = async () => (await fetch(`${url}/tickets/1`, { headers: { cookie } })).json();
    const before = await detail();
    assert.equal(before.subject, 'Family invitation keeps failing');
    assert.equal(before.draft.sources[0].title, 'Family plan invitations');
    await prepareDatabase(pool);
    assert.deepEqual(await detail(), before);
    await withEnv(ownerEnv, async () => {
      const login = await fetch(`${url}/owner/login`, {
        method: 'POST', headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'test-password' }),
      });
      const articles = await (await fetch(`${url}/help-articles`, {
        headers: { cookie: `${cookie}; ${login.headers.get('set-cookie')!.split(';')[0]}` },
      })).json();
      assert.equal(articles.length, 20);
      assert.ok(!JSON.stringify(articles).includes('Workspace invitations'));
    });
  } finally {
    await close(server);
    await pool.end();
  }
});
