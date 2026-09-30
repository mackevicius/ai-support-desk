import type { Pool } from 'pg';

type Article = { id: number; title: string; body: string; kind?: string };
const visitorDraftLimit = 5;
const dailyDraftLimit = 200;
export type Generation = {
  reply: string; suggested_priority: string; source_ids: number[];
  clearly_covered?: boolean; requires_team?: boolean; sources: Article[];
};

export async function liveAllowance(pool: Pick<Pool, 'query'>, session: string) {
  const day = new Date().toISOString().slice(0, 10);
  const daily = await pool.query('SELECT requests, paused FROM generation_usage WHERE day = $1', [day]);
  const visitor = await pool.query('SELECT requests FROM visitor_generation_usage WHERE session_id = $1', [session]);
  const remaining = Math.max(0, visitorDraftLimit - (visitor.rows[0]?.requests ?? 0));
  return { remaining, paused: remaining === 0 || !!daily.rows[0]?.paused || (daily.rows[0]?.requests ?? 0) >= dailyDraftLimit };
}

export async function generateDraft(pool: Pick<Pool, 'query' | 'connect'>, session: string, question: string, owner: boolean) {
  if (!process.env.PYTHON_URL || !process.env.AI_SERVICE_SECRET) return { error: 'unavailable' as const };
  const day = new Date().toISOString().slice(0, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO generation_usage (day, requests) VALUES ($1, 0) ON CONFLICT (day) DO NOTHING', [day]);
    const daily = await client.query(
      'UPDATE generation_usage SET requests = requests + 1 WHERE day = $1 AND requests < $2 AND paused = false RETURNING requests', [day, dailyDraftLimit],
    );
    if (!daily.rows.length) {
      await client.query('ROLLBACK');
      return { error: 'paused' as const };
    }
    if (!owner) {
      await client.query('INSERT INTO visitor_generation_usage (session_id, requests) VALUES ($1, 0) ON CONFLICT (session_id) DO NOTHING', [session]);
      const visitor = await client.query(
        'UPDATE visitor_generation_usage SET requests = requests + 1 WHERE session_id = $1 AND requests < $2 RETURNING requests', [session, visitorDraftLimit],
      );
      if (!visitor.rows.length) {
        await client.query('ROLLBACK');
        return { error: 'paused' as const };
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const articles: Article[] = (await pool.query('SELECT id, title, body, kind FROM help_articles WHERE retired = false ORDER BY id')).rows;
  try {
    const response = await fetch(`${process.env.PYTHON_URL}/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.AI_SERVICE_SECRET}` },
      body: JSON.stringify({ question, articles }), signal: AbortSignal.timeout(12000),
    });
    if ([402, 429].includes(response.status)) {
      await pool.query('UPDATE generation_usage SET paused = true WHERE day = $1', [day]);
      return { error: 'paused' as const };
    }
    if (!response.ok) return { error: 'unavailable' as const };
    const suggestion = await response.json();
    if (typeof suggestion.reply !== 'string' || !suggestion.reply.trim() || suggestion.reply.length > 5000 ||
        !['low', 'normal', 'high'].includes(suggestion.suggested_priority) || !Array.isArray(suggestion.source_ids) ||
        suggestion.source_ids.some((id: unknown) => !Number.isInteger(id) || !articles.some((article) => article.id === id)) ||
        new Set(suggestion.source_ids).size !== suggestion.source_ids.length ||
        (suggestion.clearly_covered !== undefined && typeof suggestion.clearly_covered !== 'boolean') ||
        (suggestion.requires_team !== undefined && typeof suggestion.requires_team !== 'boolean')) return { error: 'unavailable' as const };
    const draft: Generation = { ...suggestion, reply: suggestion.reply.trim(), sources: suggestion.source_ids.map((id: number) => articles.find((article) => article.id === id)!) };
    return { draft };
  } catch {
    return { error: 'unavailable' as const };
  }
}