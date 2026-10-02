import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ownerEnv, sendJson, startInbox, withEnv, withProvider } from './helpers.js';

const { baseUrl } = await startInbox();
const fixture = JSON.parse(readFileSync(new URL('../../web/app/quality/results.json', import.meta.url), 'utf8'));

test('only a valid owner session can run evaluations and anyone can inspect saved live results', async () => {
  let calls = 0;
  let unavailable = false;
  await withEnv(ownerEnv, () => withProvider((request, response) => {
    calls++;
    assert.equal(request.url, '/evaluate');
    assert.equal(request.headers.authorization, 'Bearer test-service-secret');
    sendJson(response, { ...fixture, mode: 'live', model: 'test-model', evaluated_at: '2026-10-02T12:00:00+00:00' }, unavailable ? 503 : 200);
  }, async () => {
    const visitor = (await fetch(`${baseUrl}/tickets`)).headers.get('set-cookie')!.split(';')[0];
    for (const cookie of [visitor, `${visitor}; owner_session=forged`]) {
      assert.equal((await fetch(`${baseUrl}/quality/live`, { method: 'POST', headers: { cookie } })).status, 403);
    }
    const login = await fetch(`${baseUrl}/owner/login`, {
      method: 'POST', headers: { cookie: visitor, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' }),
    });
    const owner = login.headers.get('set-cookie')!.split(';')[0];
    const expired = owner.replace(/=\d+/, '=0');
    assert.equal((await fetch(`${baseUrl}/quality/live`, { method: 'POST', headers: { cookie: `${visitor}; ${expired}` } })).status, 403);
    const wrongSession = `demo_session=00000000-0000-4000-8000-000000000001; ${owner}`;
    assert.equal((await fetch(`${baseUrl}/quality/live`, { method: 'POST', headers: { cookie: wrongSession } })).status, 403);
    assert.equal(calls, 0);
    const run = await fetch(`${baseUrl}/quality/live`, { method: 'POST', headers: { cookie: `${visitor}; ${owner}` } });
    assert.equal(run.status, 200);
    const report = await run.json();
    assert.equal(report.model, 'test-model');
    assert.equal(report.evaluated_at, '2026-10-02T12:00:00+00:00');
    assert.deepEqual(report.hand_off, { correct: 6, total: 6 });
    assert.equal(report.cases.find((item: { id: string }) => item.id === 'safe-automatic-reply').actual.hand_off, false);
    assert.equal(report.cases.find((item: { id: string }) => item.id === 'risky-billing').actual.hand_off, true);
    assert.equal(report.cases.find((item: { id: string }) => item.id === 'account-security').actual.hand_off, true);
    const saved = await fetch(`${baseUrl}/quality/live`);
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), report);
    unavailable = true;
    for (let attempt = 0; attempt < 9; attempt++) {
      assert.equal((await fetch(`${baseUrl}/quality/live`, { method: 'POST', headers: { cookie: `${visitor}; ${owner}` } })).status, 503);
    }
    assert.deepEqual(await (await fetch(`${baseUrl}/quality/live`)).json(), report);
    assert.equal((await fetch(`${baseUrl}/quality/live`, { method: 'POST', headers: { cookie: `${visitor}; ${owner}` } })).status, 429);
    assert.equal(calls, 10);
  }));
});