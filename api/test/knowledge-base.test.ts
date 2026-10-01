import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareDatabase } from '../src/schema.js';
import {
  ownerEnv,
  sendJson,
  startInbox,
  withEnv,
  withProvider,
} from './helpers.js';

const { pool, baseUrl } = await startInbox();

test('saved and edited documents expose current sentence embeddings to the owner', async () => {
  await withEnv(ownerEnv, async () => {
    const cookie = (await fetch(`${baseUrl}/tickets`)).headers
      .get('set-cookie')!
      .split(';')[0];
    const login = await fetch(`${baseUrl}/owner/login`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' }),
    });
    const headers = {
      cookie: `${cookie}; ${login.headers.get('set-cookie')!.split(';')[0]}`,
      'content-type': 'application/json',
    };
    const created = await fetch(`${baseUrl}/help-articles`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Ending membership',
        body: 'You can stop your subscription in account settings.',
      }),
    });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    try {
      const list = async () =>
        (
          await (await fetch(`${baseUrl}/help-articles`, { headers })).json()
        ).find((article: { id: number }) => article.id === id);
      const original = await list();
      assert.equal(original.embedding.length, 384);
      assert.ok(original.embedding.every(Number.isFinite));
      assert.equal(original.embedding_model, 'Xenova/all-MiniLM-L6-v2');
      const updated = await fetch(`${baseUrl}/help-articles/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          title: 'Ending membership',
          body: 'Contact support to close your account.',
          retired: false,
        }),
      });
      assert.equal(updated.status, 200);
      assert.notDeepEqual((await list()).embedding, original.embedding);
    } finally {
      await pool.query('DELETE FROM help_articles WHERE id = $1', [id]);
    }
  });
});

test('only the signed-in owner can create, edit and retire typed internal notes', async () => {
  let id: number | undefined;
  try {
    await withEnv(ownerEnv, async () => {
      const cookie = (await fetch(`${baseUrl}/tickets`)).headers
        .get('set-cookie')!
        .split(';')[0];
      const document = {
        title: 'Staff playback incident',
        body: 'A staff-only workaround.',
        kind: 'internal_note',
      };
      const visitorHeaders = { cookie, 'content-type': 'application/json' };
      assert.equal(
        (
          await fetch(`${baseUrl}/help-articles`, {
            method: 'POST',
            headers: visitorHeaders,
            body: JSON.stringify(document),
          })
        ).status,
        403,
      );
      const login = await fetch(`${baseUrl}/owner/login`, {
        method: 'POST',
        headers: visitorHeaders,
        body: JSON.stringify({ password: 'test-password' }),
      });
      const headers = {
        ...visitorHeaders,
        cookie: `${cookie}; ${login.headers.get('set-cookie')!.split(';')[0]}`,
      };
      const created = await fetch(`${baseUrl}/help-articles`, {
        method: 'POST',
        headers,
        body: JSON.stringify(document),
      });
      assert.equal(created.status, 201);
      const note = await created.json();
      id = note.id;
      assert.equal(note.kind, 'internal_note');
      assert.equal(
        (
          await fetch(`${baseUrl}/help-articles/${id}`, {
            method: 'PATCH',
            headers: visitorHeaders,
            body: JSON.stringify({ ...document, retired: true }),
          })
        ).status,
        403,
      );
      for (const retired of [false, true]) {
        const updated = await fetch(`${baseUrl}/help-articles/${id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            ...document,
            body: 'Updated staff workaround.',
            retired,
          }),
        });
        assert.deepEqual(await updated.json(), {
          id,
          ...document,
          body: 'Updated staff workaround.',
          retired,
        });
      }
      assert.equal(
        (
          await fetch(`${baseUrl}/help-articles`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...document, kind: 'unknown' }),
          })
        ).status,
        400,
      );
    });
  } finally {
    if (id !== undefined)
      await pool.query('DELETE FROM help_articles WHERE id = $1', [id]);
  }
});

test('owner edits and retires help articles without changing the guest demo', async () => {
  const calls: {
    question: string;
    articles: { id: number; title: string; body: string }[];
  }[] = [];
  await withEnv(ownerEnv, () =>
    withProvider(
      async (request, response) => {
        assert.equal(
          request.headers.authorization,
          'Bearer test-service-secret',
        );
        let body = '';
        for await (const chunk of request) body += chunk;
        if (Buffer.byteLength(body) > 3200000) {
          response.writeHead(413).end();
          return;
        }
        const input = JSON.parse(body);
        calls.push(input);
        const article = input.articles.find(
          (item: { title: string }) => item.title === 'Orbit access',
        );
        sendJson(
          response,
          article
            ? {
                reply: article.body,
                suggested_priority: 'normal',
                source_ids: [article.id],
              }
            : {
                reply: 'Could you clarify your request?',
                suggested_priority: 'normal',
                source_ids: [],
              },
        );
      },
      async () => {
        const guestCookie = (await fetch(`${baseUrl}/tickets`)).headers
          .get('set-cookie')!
          .split(';')[0];
        const before = await (
          await fetch(`${baseUrl}/tickets/1`, {
            headers: { cookie: guestCookie },
          })
        ).json();
        assert.equal(
          (
            await fetch(`${baseUrl}/help-articles`, {
              headers: { cookie: guestCookie },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await fetch(`${baseUrl}/help-articles`, {
              method: 'POST',
              headers: {
                cookie: guestCookie,
                'content-type': 'application/json',
              },
              body: JSON.stringify({ title: 'Denied', body: 'No access' }),
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await fetch(`${baseUrl}/help-articles/1`, {
              method: 'PATCH',
              headers: {
                cookie: guestCookie,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                title: 'Denied',
                body: 'No access',
                retired: true,
              }),
            })
          ).status,
          403,
        );
        const login = await fetch(`${baseUrl}/owner/login`, {
          method: 'POST',
          headers: { cookie: guestCookie, 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'test-password' }),
        });
        const ownerCookie = login.headers.get('set-cookie')!.split(';')[0];
        const headers = {
          cookie: `${guestCookie}; ${ownerCookie}`,
          'content-type': 'application/json',
        };
        const otherCookie = (await fetch(`${baseUrl}/tickets`)).headers
          .get('set-cookie')!
          .split(';')[0];
        assert.equal(
          (
            await fetch(`${baseUrl}/help-articles`, {
              headers: { cookie: `${otherCookie}; ${ownerCookie}` },
            })
          ).status,
          403,
        );
        const listed = await fetch(`${baseUrl}/help-articles`, { headers });
        assert.equal(listed.status, 200);
        const originalArticle = (await listed.json()).find(
          (item: { id: number }) => item.id === 1,
        );
        assert.equal(
          (
            await fetch(`${baseUrl}/help-articles`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ title: '', body: 'Missing title' }),
            })
          ).status,
          400,
        );
        const created = await fetch(`${baseUrl}/help-articles`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: 'Orbit access',
            body: 'Orbit access is enabled in Settings.',
          }),
        });
        assert.equal(created.status, 201);
        const article = await created.json();
        assert.equal(article.retired, false);
        for (let index = 0; index < 7; index++) {
          const unrelated = await fetch(`${baseUrl}/help-articles`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              title: `Unrelated topic ${index}`,
              body: 'z'.repeat(5000),
            }),
          });
          assert.equal(unrelated.status, 201);
        }
        const longArticleIds: number[] = [];
        for (let index = 0; index < 2; index++) {
          const longArticle = await fetch(`${baseUrl}/help-articles`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              title: `Orbit access extra ${index}`,
              body: '\u0001'.repeat(5000),
            }),
          });
          assert.equal(longArticle.status, 201);
          longArticleIds.push((await longArticle.json()).id);
        }
        const submission = await fetch(`${baseUrl}/tickets`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ question: 'How do I use Orbit access?' }),
        });
        const { id } = await submission.json();
        const generate = () =>
          fetch(`${baseUrl}/tickets/${id}/generate`, {
            method: 'POST',
            headers,
          });
        let draft = await generate();
        assert.equal(draft.status, 200);
        assert.deepEqual(
          (await draft.json()).draft.sources.map(
            (source: { id: number }) => source.id,
          ),
          [article.id],
        );
        await pool.query(
          'UPDATE session_drafts SET source_articles = NULL WHERE ticket_id = $1',
          [id],
        );
        await prepareDatabase(pool);
        for (const longId of longArticleIds) {
          const retiredLong = await fetch(
            `${baseUrl}/help-articles/${longId}`,
            {
              method: 'PATCH',
              headers,
              body: JSON.stringify({
                title: 'Orbit access extra',
                body: '\u0001'.repeat(5000),
                retired: true,
              }),
            },
          );
          assert.equal(retiredLong.status, 200);
        }
        const edited = await fetch(`${baseUrl}/help-articles/${article.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            title: 'Orbit access',
            body: 'Orbit access now requires owner approval.',
            retired: false,
          }),
        });
        assert.equal(edited.status, 200);
        const originalDraft = await (
          await fetch(`${baseUrl}/tickets/${id}`, { headers })
        ).json();
        assert.equal(
          originalDraft.draft.sources[0].body,
          'Orbit access is enabled in Settings.',
        );
        draft = await generate();
        assert.equal(draft.status, 200);
        let ticket = await draft.json();
        assert.equal(
          ticket.draft.reply,
          'Orbit access now requires owner approval.',
        );
        assert.equal(
          ticket.draft.sources[0].body,
          'Orbit access now requires owner approval.',
        );
        const retired = await fetch(`${baseUrl}/help-articles/${article.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            title: 'Orbit access',
            body: 'Orbit access now requires owner approval.',
            retired: true,
          }),
        });
        assert.equal(retired.status, 200);
        draft = await generate();
        assert.equal(draft.status, 200);
        ticket = await draft.json();
        assert.deepEqual(ticket.draft.sources, []);
        assert.match(ticket.draft.reply, /clarify/i);
        assert.equal(calls.length, 4);
        assert.ok(calls[0].articles.some((item) => item.id === article.id));
        assert.ok(calls[0].articles.length > 3);
        assert.ok(Buffer.byteLength(JSON.stringify(calls[0])) > 32768);
        assert.ok(
          calls[2].articles.some((item) =>
            item.body.includes('owner approval'),
          ),
        );
        assert.ok(calls[3].articles.every((item) => item.id !== article.id));
        const updatedSeed = await fetch(`${baseUrl}/help-articles/1`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            title: 'New invitations',
            body: 'New invitation text.',
            retired: true,
          }),
        });
        assert.equal(updatedSeed.status, 200);
        const guest = await (
          await fetch(`${baseUrl}/tickets/1`, {
            headers: { cookie: guestCookie },
          })
        ).json();
        assert.deepEqual(guest.draft, before.draft);
        await fetch(`${baseUrl}/help-articles/1`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            title: originalArticle.title,
            body: originalArticle.body,
            retired: false,
          }),
        });
      },
    ),
  );
});
