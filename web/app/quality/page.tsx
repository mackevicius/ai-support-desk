import Link from 'next/link';
import { cookies } from 'next/headers';
import { getHelpArticles } from '../data';
import { runQualityEvaluation } from '../actions';
import { SubmitButton } from '../_components/submit-button';
import { getQualityReport } from './report';
import { Card } from '../../components/ui/card';
import { Separator } from '../../components/ui/separator';

type Result = { id: string; passed: boolean };

function ScoreCard({ id, title, results }: { id: string; title: string; results: Result[] }) {
  if (!results.length) return null;
  return (
    <section aria-labelledby={id}>
      <Card className="h-full gap-3 rounded-lg p-4">
        <h2 id={id}>{title}</h2>
        <strong className="quality-score">
          {results.filter((item) => item.passed).length}/{results.length}
        </strong>
        <span className="quality-dots" aria-hidden>
          {results.map((item) => (
            <span key={item.id} className="quality-dot" data-passed={item.passed} title={item.id} />
          ))}
        </span>
      </Card>
    </section>
  );
}

export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{ evaluation?: string }>;
}) {
  const { evaluation } = await searchParams;
  const report = await getQualityReport();
  const jar = await cookies();
  const session = jar.get('demo_session')?.value;
  const owner = jar.get('owner_session')?.value;
  const canRun = Boolean(session && owner && await getHelpArticles(session, owner));
  const handOffs = report.cases
    .filter((item) => item.checks['hand-off accuracy'] !== undefined)
    .map((item) => ({ id: item.id, passed: item.checks['hand-off accuracy'] === true }));
  const leaks = report.cases
    .filter((item) => item.categories.includes('internal leak attempt'))
    .map((item) => ({
      id: item.id,
      passed: item.checks['no internal phrase copied'] === true && item.checks['internal handoff'] === true && !item.error,
    }));
  const retrieval = report.retrieval;
  const documents = retrieval?.cases.map((item) => ({
    id: item.id,
    passed: retrieval.selected_method === 'embeddings' ? item.embeddings_hit : item.word_matching_hit,
  })) ?? [];

  return (
    <main className="workspace focus-view">
      <div className="detail quality-page">
        <Link href="/" className="back">
          Back to inbox
        </Link>
        <h1>Answer quality</h1>
        <p>A small fictional test set, not real users. Word checks can&apos;t prove meaning, and the copy guard misses paraphrases.</p>
        <Separator className="mt-6" />
        {canRun && <form action={runQualityEvaluation} className="quality-run">
          <SubmitButton label="Run live evaluation" pendingLabel="Running evaluation..." />
          <small>Paid provider calls. Reserves 20 requests from the shared daily allowance.</small>
        </form>}
        {evaluation && <p role="alert">{evaluation === 'limit' ? 'Live AI is paused for today.' : 'Live evaluation is unavailable. Previously saved results are unchanged.'}</p>}
        <div className="quality-scores">
          <ScoreCard id="hand-off-heading" title="Hand-off decisions correct" results={handOffs} />
          <ScoreCard id="leak-heading" title="Leak attempts blocked" results={leaks} />
          <ScoreCard id="document-heading" title="Right document found" results={documents} />
        </div>
        <section className="quality-section" aria-labelledby="tests-heading">
          <h2 id="tests-heading">Tests</h2>
          <ul className="quality-tiles">
            {report.cases.map((item) => {
              const passed = Object.values(item.checks).every(Boolean);
              return (
                <li key={item.id}>
                  <Link
                    href={`/quality/${item.id}`}
                    className="quality-tile"
                    data-passed={passed}
                    aria-label={`${item.id}: ${passed ? 'pass' : 'fail'}`}
                  >
                    <span aria-hidden>{passed ? '✓' : '✗'}</span>
                    {item.id}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
        {retrieval && (
          <section className="quality-section" aria-labelledby="retrieval-heading">
            <h2 id="retrieval-heading">Finding the right document</h2>
            <ul className="quality-bars">
              {[
                { label: 'Word matching', score: retrieval.word_matching },
                { label: 'Embeddings', score: retrieval.embeddings },
              ].map(({ label, score }) => (
                <li key={label}>
                  <span>{label}</span>
                  <span className="quality-bar" aria-hidden>
                    <span style={{ width: `${score.hit_rate * 100}%` }} />
                  </span>
                  <strong>{score.hits}/{score.total}</strong>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
