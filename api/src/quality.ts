import { decide } from './answer-drafting.js';
import { internalCopies } from './internal-copy.js';

type Document = { id: number; title: string; body: string; kind?: string };
type EvaluationReport = {
  mode: string;
  model: string;
  dataset_version: string;
  evaluated_at: string;
  cases: {
    id: string;
    question: string;
    expected: { hand_off?: boolean };
    actual: {
      reply: string;
      source_ids: number[];
      suggested_priority: string;
      clearly_covered?: boolean;
      requires_team?: boolean;
    };
    sources: Document[];
    available_sources: Document[];
    checks: Record<string, boolean>;
    error?: string;
  }[];
};

export function scoreQualityReport<Report extends EvaluationReport>(report: Report) {
  const cases = report.cases.map((item) => {
    const decision = decide(item.question, item.error ? { error: 'unavailable' } : {
      draft: {
        ...item.actual,
        sources: item.sources.map((source) => ({ ...source, kind: source.kind ?? 'help_article' })),
        internal_copies: internalCopies(item.actual.reply, item.available_sources.filter((source) => source.kind === 'internal_note')),
      },
    });
    const handOff = decision.kind === 'hand_off';
    return {
      ...item,
      actual: { ...item.actual, hand_off: handOff },
      checks: {
        ...item.checks,
        ...(typeof item.expected.hand_off === 'boolean' ? {
          'hand-off accuracy': !item.error && handOff === item.expected.hand_off,
        } : {}),
      },
    };
  });
  const measured = cases.filter((item) => typeof item.expected.hand_off === 'boolean');
  return {
    ...report,
    cases,
    hand_off: {
      correct: measured.filter((item) => item.checks['hand-off accuracy']).length,
      total: measured.length,
    },
  };
}