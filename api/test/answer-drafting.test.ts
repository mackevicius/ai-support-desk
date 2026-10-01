import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import {
  close,
  listening,
  ownerEnv,
  readJson,
  sendJson,
  startInbox,
  withEnv,
  withProvider,
} from './helpers.js';

const { pool, baseUrl } = await startInbox();

test('a covered visitor question receives an automatic reply and a recorded explanation', async () => {
  let checkedOut = false;
  const boundedServer = createApp({
    query: pool.query.bind(pool),
    connect: async () => {
      assert.equal(
        checkedOut,
        false,
        'Submission must release its connection before generation',
      );
      checkedOut = true;
      const client = await pool.connect();
      return {
        query: client.query.bind(client),
        release: () => {
          checkedOut = false;
          client.release();
        },
      };
    },
  } as Parameters<typeof createApp>[0]).listen(0);
  const boundedUrl = await listening(boundedServer);
  try {
    await withProvider(
      async (request, response) => {
        const input = await readJson(request);
        const article = input.articles.find(
          (item: { title: string }) => item.title === 'Offline downloads',
        );
        sendJson(response, {
          reply:
            'Open a playlist and tap Download. Downloads need a paid plan.',
          suggested_priority: 'normal',
          source_ids: [article.id],
          clearly_covered: true,
          requires_team: false,
        });
      },
      async () => {
        const response = await fetch(`${boundedUrl}/tickets`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            question: 'How do I download music for offline listening?',
          }),
        });
        assert.equal(response.status, 201);
        const ticket = await response.json();
        assert.equal(ticket.status, 'resolved');
        assert.equal(ticket.decision.kind, 'automatic_reply');
        assert.equal(ticket.decision.sources[0].title, 'Offline downloads');
        assert.equal(
          ticket.approved_reply,
          'Open a playlist and tap Download. Downloads need a paid plan.',
        );
        assert.equal(ticket.live_ai.remaining, 4);
        assert.ok(
          ticket.history.some((event: { description: string }) =>
            event.description.includes(ticket.decision.reason),
          ),
        );
        const cookie = response.headers.get('set-cookie')!.split(';')[0];
        const saved = await (
          await fetch(`${boundedUrl}/tickets/${ticket.id}`, {
            headers: { cookie },
          })
        ).json();
        assert.deepEqual(saved.decision, ticket.decision);
        assert.equal(saved.approved_reply, ticket.approved_reply);
      },
    );
  } finally {
    await close(boundedServer);
  }
});

test('fixed hand-off rules override confident provider output and weak coverage', async () => {
  let covered = true;
  let sources = true;
  await withProvider(
    async (request, response) => {
      const input = await readJson(request);
      sendJson(response, {
        reply: 'A confident but unsafe reply.',
        topic: 'audio quality',
        suggested_priority: 'low',
        source_ids: sources ? [input.articles[0].id] : [],
        clearly_covered: covered,
        requires_team: false,
      });
    },
    async () => {
      for (const question of [
        'I need a refund',
        'Are refunds available?',
        'I was charged twice',
        'My account was hacked',
        'My account has been compromised',
        'Someone took over my account',
        'Unknown music issue',
        'An unsupported draft',
      ]) {
        if (question === 'Unknown music issue') covered = false;
        if (question === 'An unsupported draft') {
          covered = true;
          sources = false;
        }
        const response = await fetch(`${baseUrl}/tickets`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question }),
        });
        const ticket = await response.json();
        assert.equal(ticket.decision.kind, 'hand_off', question);
        assert.equal(ticket.approved_reply, null);
        assert.equal(ticket.decision.topic, 'audio quality');
        assert.equal(ticket.decision.suggested_priority, 'low');
        assert.equal(
          ticket.decision.rule,
          /refund|charged|hacked|compromised|account/.test(question)
            ? 'Money or account security'
            : 'Weak help article coverage',
        );
        assert.ok(
          ticket.history.some(
            (event: { description: string }) =>
              event.description === `Hand-off: ${ticket.decision.reason}`,
          ),
        );
      }
    },
  );
});

test('visitor and owner generation share daily limits and provider credit pauses', async () => {
  let calls = 0;
  let providerStatus = 200;
  const day = new Date().toISOString().slice(0, 10);
  const submit = async (cookie: string) => {
    const response = await fetch(`${baseUrl}/tickets`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'A question without clear coverage' }),
    });
    assert.equal(response.status, 201);
    return response.json();
  };
  try {
    await withEnv(ownerEnv, () =>
      withProvider(
        async (request, response) => {
          await readJson(request);
          calls++;
          sendJson(
            response,
            {
              reply: 'Please share more details.',
              suggested_priority: 'normal',
              source_ids: [],
              clearly_covered: false,
            },
            providerStatus,
          );
        },
        async () => {
          await pool.query('DELETE FROM generation_usage WHERE day = $1', [
            day,
          ]);
          const cookie = (await fetch(`${baseUrl}/tickets`)).headers
            .get('set-cookie')!
            .split(';')[0];
          for (let draft = 1; draft <= 5; draft++) {
            const ticket = await submit(cookie);
            assert.equal(ticket.live_ai.remaining, 5 - draft);
            assert.equal(ticket.decision.kind, 'hand_off');
          }
          const paused = await submit(cookie);
          assert.equal(paused.decision.reason, 'Live AI is paused for today');
          assert.equal(calls, 5);
          await fetch(`${baseUrl}/reset`, {
            method: 'POST',
            headers: { cookie },
          });
          assert.equal((await submit(cookie)).live_ai.remaining, 0);
          assert.equal(calls, 5);
          const login = await fetch(`${baseUrl}/owner/login`, {
            method: 'POST',
            headers: { cookie, 'content-type': 'application/json' },
            body: JSON.stringify({ password: 'test-password' }),
          });
          const ownerCookie = `${cookie}; ${login.headers.get('set-cookie')!.split(';')[0]}`;
          await pool.query(
            'UPDATE generation_usage SET requests = 199 WHERE day = $1',
            [day],
          );
          const owner = await fetch(`${baseUrl}/tickets/1/generate`, {
            method: 'POST',
            headers: { cookie: ownerCookie },
          });
          assert.equal(owner.status, 200);
          assert.equal(calls, 6);
          assert.equal(
            (
              await fetch(`${baseUrl}/tickets/2/generate`, {
                method: 'POST',
                headers: { cookie: ownerCookie },
              })
            ).status,
            429,
          );
          const other = (await fetch(`${baseUrl}/tickets`)).headers
            .get('set-cookie')!
            .split(';')[0];
          assert.equal(
            (await submit(other)).decision.reason,
            'Live AI is paused for today',
          );
          assert.equal(calls, 6);
          await pool.query(
            'UPDATE generation_usage SET requests = 0, paused = false WHERE day = $1',
            [day],
          );
          providerStatus = 402;
          const noCredit = await submit(other);
          assert.equal(noCredit.decision.reason, 'Live AI is paused for today');
          assert.equal(noCredit.live_ai.paused, true);
          providerStatus = 200;
          const third = (await fetch(`${baseUrl}/tickets`)).headers
            .get('set-cookie')!
            .split(';')[0];
          assert.equal(
            (await submit(third)).decision.reason,
            'Live AI is paused for today',
          );
          assert.equal(calls, 7);
        },
      ),
    );
  } finally {
    await pool.query('DELETE FROM generation_usage WHERE day = $1', [day]);
  }
});

test('uncertain, risky, internal-note and invalid answers hand off without delivering drafts', async () => {
  await pool.query(
    "INSERT INTO help_articles (id, title, body, kind) VALUES (9000, 'Staff investigation', 'Private investigation details', 'internal_note')",
  );
  try {
    await withProvider(
      async (request, response) => {
        const input = await readJson(request);
        const internal = input.question.includes('internal');
        sendJson(response, {
          reply: internal
            ? 'Private investigation details'
            : 'A suggested answer',
          suggested_priority: 'normal',
          source_ids: input.question.includes('no sources')
            ? []
            : [internal ? 9000 : 5],
          clearly_covered: input.question.includes('uncertain')
            ? false
            : input.question.includes('invalid')
              ? 'yes'
              : true,
          requires_team: input.question.includes('human check')
            ? true
            : input.question.includes('missing risk')
              ? undefined
              : false,
        });
      },
      async () => {
        for (const question of [
          'Please refund my offline plan',
          'I was billed twice',
          'Why did my subscription price increase?',
          'My account was hacked',
          'An uncertain answer',
          'An internal answer',
          'An invalid answer',
          'An answer with no sources',
          'A human check is needed',
          'A missing risk assessment',
        ]) {
          const response = await fetch(`${baseUrl}/tickets`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ question }),
          });
          assert.equal(response.status, 201);
          const ticket = await response.json();
          assert.equal(ticket.status, 'open');
          assert.equal(ticket.decision.kind, 'hand_off');
          assert.equal(ticket.approved_reply, null);
          assert.equal(
            ticket.draft?.live ?? false,
            !question.includes('invalid'),
          );
          assert.ok(
            ticket.history.some(
              (event: { description: string }) =>
                event.description === `Hand-off: ${ticket.decision.reason}`,
            ),
          );
          assert.ok(
            !JSON.stringify({
              decision: ticket.decision,
              reply: ticket.approved_reply,
            }).includes('Private investigation details'),
          );
          if (question === 'An internal answer') {
            const cookie = response.headers.get('set-cookie')!.split(';')[0];
            const customer = await (
              await fetch(`${baseUrl}/tickets/${ticket.id}?view=customer`, {
                headers: { cookie },
              })
            ).json();
            assert.equal(customer.decision.internal_count, 1);
            assert.ok(
              !JSON.stringify(customer).includes('Staff investigation'),
            );
            assert.ok(
              !JSON.stringify(customer).includes(
                'Private investigation details',
              ),
            );
            assert.equal(ticket.draft.sources[0].kind, 'internal_note');
          }
        }
      },
    );
  } finally {
    await pool.query('DELETE FROM help_articles WHERE id = 9000');
  }
});

test('a visitor cannot request live generation', async () => {
  const inbox = await fetch(`${baseUrl}/tickets`);
  const cookie = inbox.headers.get('set-cookie')!.split(';')[0];
  const response = await fetch(`${baseUrl}/tickets/1/generate`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(response.status, 403);
  const ticket = await (
    await fetch(`${baseUrl}/tickets/1`, { headers: { cookie } })
  ).json();
  assert.equal(ticket.draft.state, 'saved');
});

test('an owner generates a cited draft through Python without approving it', async () => {
  const calls: unknown[] = [];
  let providerStatus = 200;
  const provider = createServer(async (request, response) => {
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.authorization, 'Bearer fake-provider-key');
    const payload = await readJson(request);
    calls.push(payload);
    if (providerStatus !== 200) {
      sendJson(
        response,
        { error: { code: 'insufficient_quota' } },
        providerStatus,
      );
      return;
    }
    const input = JSON.parse(payload.messages[1].content);
    const offline = input.question.includes('offline');
    const article = input.articles.find(
      (item: { id: number }) => item.id === (offline ? 5 : 1),
    );
    sendJson(response, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              reply: offline
                ? 'You can save songs for offline play.'
                : 'Workspace admins can resend invitations from Settings > Team.',
              suggested_priority: 'high',
              source_ids: [article.id],
              clearly_covered: offline,
              requires_team: false,
            }),
          },
        },
      ],
    });
  });
  provider.listen(0);
  const providerUrl = await listening(provider);
  const reservation = createServer();
  reservation.listen(0);
  const pythonUrl = await listening(reservation);
  await close(reservation);
  const python = spawn(
    'python3',
    ['-u', fileURLToPath(new URL('../../ai/server.py', import.meta.url))],
    {
      env: {
        ...process.env,
        PORT: new URL(pythonUrl).port,
        AI_SERVICE_SECRET: 'test-service-secret',
        OPENAI_API_KEY: 'fake-provider-key',
        OPENAI_BASE_URL: providerUrl,
      },
    },
  );
  try {
    await withEnv(
      {
        ...ownerEnv,
        PYTHON_URL: pythonUrl,
        AI_SERVICE_SECRET: 'test-service-secret',
      },
      async () => {
        let ready = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          try {
            ready = (await fetch(`${pythonUrl}/health`)).ok;
            if (ready) break;
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.ok(ready, 'Python service did not start');
        assert.equal(
          (await fetch(`${pythonUrl}/generate`, { method: 'POST' })).status,
          403,
        );
        const cookie = (await fetch(`${baseUrl}/tickets`)).headers
          .get('set-cookie')!
          .split(';')[0];
        const login = await fetch(`${baseUrl}/owner/login`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'test-password' }),
        });
        assert.equal(login.status, 204);
        const ownerCookie = login.headers.get('set-cookie')!.split(';')[0];
        const headers = {
          cookie: `${cookie}; ${ownerCookie}`,
          'content-type': 'application/json',
        };
        const otherCookie = (await fetch(`${baseUrl}/tickets`)).headers
          .get('set-cookie')!
          .split(';')[0];
        assert.equal(
          (
            await fetch(`${baseUrl}/tickets/1/generate`, {
              method: 'POST',
              headers: { cookie: `${otherCookie}; ${ownerCookie}` },
            })
          ).status,
          403,
        );
        const submission = await fetch(`${baseUrl}/tickets`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ question: 'How do I resend an invitation?' }),
        });
        const { id } = await submission.json();
        const generated = await fetch(`${baseUrl}/tickets/${id}/generate`, {
          method: 'POST',
          headers,
        });
        assert.equal(generated.status, 200);
        const ticket = await generated.json();
        assert.equal(ticket.status, 'open');
        assert.equal(ticket.priority, 'normal');
        assert.equal(ticket.approved_reply, null);
        assert.equal(
          ticket.draft.reply,
          'Workspace admins can resend invitations from Settings > Team.',
        );
        assert.equal(ticket.draft.suggested_priority, 'high');
        assert.equal(ticket.draft.sources[0].title, 'Inviting teammates');
        assert.equal(calls.length, 2);
        const providerCall = calls[0] as {
          max_tokens: number;
          messages: { content: string }[];
        };
        assert.equal(providerCall.max_tokens, 300);
        assert.match(providerCall.messages[0].content, /clearly_covered/);
        assert.match(providerCall.messages[0].content, /topic/);
        const promptData = JSON.parse(providerCall.messages[1].content);
        assert.equal(promptData.question, 'How do I resend an invitation?');
        assert.equal(promptData.articles[0].id, 1);
        const signedOut = await (
          await fetch(`${baseUrl}/tickets/${id}`, {
            headers: { cookie },
          })
        ).json();
        assert.equal(signedOut.draft.reply, ticket.draft.reply);
        assert.equal(
          (
            await fetch(`${baseUrl}/tickets/${id}/review`, {
              method: 'POST',
              headers: { cookie, 'content-type': 'application/json' },
              body: JSON.stringify({
                action: 'approve',
                reply: ticket.draft.reply,
                priority: 'invalid',
              }),
            })
          ).status,
          400,
        );
        const prioritized = await fetch(`${baseUrl}/tickets/${id}/review`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'priority', priority: 'high' }),
        });
        assert.equal(prioritized.status, 200);
        const priorityOnly = await prioritized.json();
        assert.equal(priorityOnly.status, 'open');
        assert.equal(priorityOnly.priority, 'high');
        assert.equal(priorityOnly.approved_reply, null);
        assert.equal(priorityOnly.draft.state, 'saved');
        const approved = await fetch(`${baseUrl}/tickets/${id}/review`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            action: 'approve',
            reply: ticket.draft.reply,
            priority: 'high',
          }),
        });
        assert.equal(approved.status, 200);
        assert.equal((await approved.json()).status, 'resolved');
        assert.equal(
          (
            await fetch(`${baseUrl}/tickets/${id}/generate`, {
              method: 'POST',
              headers,
            })
          ).status,
          409,
        );
        assert.equal(calls.length, 2);
        await pool.query(
          'UPDATE generation_usage SET requests = 200 WHERE day = $1',
          [new Date().toISOString().slice(0, 10)],
        );
        const another = await fetch(`${baseUrl}/tickets`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ question: 'How do I invite a teammate?' }),
        });
        const nextTicket = await another.json();
        assert.equal(
          (
            await fetch(`${baseUrl}/tickets/${nextTicket.id}/generate`, {
              method: 'POST',
              headers,
            })
          ).status,
          429,
        );
        assert.equal(calls.length, 2);
        await pool.query(
          'UPDATE generation_usage SET requests = 0 WHERE day = $1',
          [new Date().toISOString().slice(0, 10)],
        );
        const covered = await fetch(`${baseUrl}/tickets`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ question: 'How do I listen offline?' }),
        });
        assert.equal((await covered.json()).decision.kind, 'automatic_reply');
        providerStatus = 429;
        const paused = await fetch(`${baseUrl}/tickets`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ question: 'How do I listen offline?' }),
        });
        assert.equal(
          (await paused.json()).decision.reason,
          'Live AI is paused for today',
        );
      },
    );
  } finally {
    python.kill();
    await once(python, 'exit');
    await close(provider);
    await pool.query('DELETE FROM generation_usage WHERE day = $1', [
      new Date().toISOString().slice(0, 10),
    ]);
  }
});
