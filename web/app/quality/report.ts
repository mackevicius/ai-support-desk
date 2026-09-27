import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import deterministic from './results.json';

export type QualityCase = {
  id: string;
  question: string;
  categories: string[];
  expected: { reply?: string; source_ids?: number[]; suggested_priority?: string; clarification?: boolean; clarification_allowed?: boolean };
  actual: { reply: string; source_ids: number[]; suggested_priority: string };
  checks: Record<string, boolean | undefined>;
  sources: { id: number; title: string; body: string }[];
  available_sources: { id: number; title: string; body: string }[];
  model?: string | null;
  latency_ms?: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  estimated_cost_usd?: number;
  error?: string;
};

export type QualityReport = {
  mode: string;
  model: string;
  dataset_version: string;
  cases: QualityCase[];
};

export async function getQualityReport(run?: string): Promise<QualityReport | null> {
  if (run !== 'live') return deterministic as QualityReport;
  try {
    return JSON.parse(await readFile(join(process.cwd(), 'app/quality/live-results.json'), 'utf8')) as QualityReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}