import Link from 'next/link';
import { cookies } from 'next/headers';
import { getHelpArticles } from '../data';
import { runQualityEvaluation } from '../actions';
import { SubmitButton } from '../_components/submit-button';
import { getQualityReport } from './report';
import { StatusPill } from '../_components/status-pill';

export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; view?: string; evaluation?: string }>;
}) {
  const { run, view, evaluation } = await searchParams;
  const retrievalView = view === 'retrieval';
  const report = await getQualityReport(retrievalView ? undefined : run);
  const jar = await cookies();
  const session = jar.get('demo_session')?.value;
  const owner = jar.get('owner_session')?.value;
  const canRun = Boolean(session && owner && await getHelpArticles(session, owner));
  const leaks = report?.cases.filter((item) => item.categories.includes('internal leak attempt')) ?? [];
  const failures = report?.cases.filter((item) => !Object.values(item.checks).every(Boolean)) ?? [];

  return (
    <main className="workspace focus-view">
      <div className="detail quality-page">
        <Link href="/" className="back">
          Back to inbox
        </Link>
        <h1>Answer quality</h1>
        <p>Measured checks on a small fictional dataset, not evidence of real users or production scale.</p>
        {canRun && <form action={runQualityEvaluation} className="quality-run">
          <SubmitButton label="Run live evaluation" pendingLabel="Running evaluation..." />
          <small>Paid provider calls. Reserves 20 requests from the shared daily allowance.</small>
        </form>}
        {evaluation && <p role="alert">{evaluation === 'limit' ? 'Live AI is paused for today.' : 'Live evaluation is unavailable. Previously saved results are unchanged.'}</p>}
        <nav className="quality-tabs" aria-label="Quality checks">
          <Link
            href="/quality?view=retrieval"
            aria-current={retrievalView ? 'page' : undefined}
          >
            Document retrieval
          </Link>
          <Link
            href={`/quality${run === 'live' ? '?run=live' : ''}`}
            aria-current={retrievalView ? undefined : 'page'}
          >
            Answer checks
          </Link>
        </nav>
        {!retrievalView && (
          <nav className="quality-tabs" aria-label="Evaluation runs">
            <Link
              href="/quality"
              aria-current={run === 'live' ? undefined : 'page'}
            >
              Deterministic
            </Link>
            <Link
              href="/quality?run=live"
              aria-current={run === 'live' ? 'page' : undefined}
            >
              Live
            </Link>
          </nav>
        )}
        {report ? (
          <>
            {!retrievalView && (
              <section aria-labelledby="answer-checks-heading">
                <h2 id="answer-checks-heading">Answer checks</h2>
                <p className="quality-meta">
                  {report.dataset_version} · {report.model} · {report.mode} · <time dateTime={report.evaluated_at}>{report.evaluated_at?.slice(0, 10) ?? 'Date not recorded'}</time>
                </p>
                <p>{report.mode === 'deterministic' ? 'Fixture checks, not a live model run. Fixed provider replies exercise the generator and application hand-off rules.' : 'Saved live provider results, checked by the generator and application hand-off rules.'} Answer checks use word matching; the embedding comparison is measured separately.</p>
                <div className="quality-metrics">
                  <section aria-labelledby="hand-off-heading">
                    <h2 id="hand-off-heading">Hand-off accuracy</h2>
                    <p className="quality-summary">{report.hand_off ? `${report.hand_off.correct} of ${report.hand_off.total} decisions correct` : 'Not scored in this older report'}</p>
                    <p>Safe automatic replies, money, account security, and internal notes.</p>
                  </section>
                  <section aria-labelledby="leak-heading">
                    <h2 id="leak-heading">Internal-note leak attempts</h2>
                    <p className="quality-summary">{leaks.filter((item) => item.checks['no internal phrase copied'] === true && item.checks['internal handoff'] === true && !item.error).length} of {leaks.length} attempts blocked</p>
                    <p>Direct quotation, an omitted citation, and a prompt asking for staff-only text.</p>
                  </section>
                </div>
                <section className="quality-section" aria-labelledby="failures-heading">
                  <h2 id="failures-heading">Known failures</h2>
                  {failures.length ? <p>{failures.map((item) => item.id).join(' · ')}</p> : <p>No failures recorded in these checks.</p>}
                  <p>Exact example matching and word overlap cannot prove semantic correctness. The copy guard detects eight-word phrases, not every confidential paraphrase.</p>
                </section>
                <p className="quality-summary">
                  {
                    report.cases.filter((item) =>
                      Object.values(item.checks).every(Boolean),
                    ).length
                  }{' '}
                  of {report.cases.length} cases pass
                </p>
                <div className="quality-list">
                  {report.cases.map((item) => {
                    const passed = Object.values(item.checks).every(Boolean);
                    return (
                      <Link
                        className="quality-case"
                        href={`/quality/${item.id}${run === 'live' ? '?run=live' : ''}`}
                        key={item.id}
                      >
                        <span className="quality-case-top">
                          <strong>{item.id}</strong>
                          <StatusPill tone={passed ? 'ok' : 'alert'}>
                            {passed ? 'Pass' : 'Fail'}
                          </StatusPill>
                        </span>
                        <span>{item.question}</span>
                        <small>{item.categories.join(' · ')}</small>
                        <span className="quality-checks">
                          {Object.entries(item.checks)
                            .map(
                              ([name, ok]) =>
                                `${name}: ${ok ? 'pass' : 'fail'}`,
                            )
                            .join(' · ')}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}
            {retrievalView && report.retrieval && (
              <section aria-labelledby="retrieval-heading">
                <h2 id="retrieval-heading">Document retrieval</h2>
                <p className="quality-meta">
                  {report.dataset_version} · <time dateTime={report.evaluated_at}>{report.evaluated_at?.slice(0, 10) ?? 'Date not recorded'}</time> · {report.retrieval.model} · {report.retrieval.metric} · Using{' '}
                  {report.retrieval.selected_method === 'embeddings'
                    ? 'embeddings'
                    : 'word matching'}
                </p>
                <p>Eight saved questions against 20 fictional documents. A hit means the expected document appears in the first three matches, not that an answer is safe or correct.</p>
                <p>
                  Word matching: {report.retrieval.word_matching.hits}/
                  {report.retrieval.word_matching.total} (
                  {(report.retrieval.word_matching.hit_rate * 100).toFixed(1)}%)
                </p>
                <p>
                  Embeddings: {report.retrieval.embeddings.hits}/
                  {report.retrieval.embeddings.total} (
                  {(report.retrieval.embeddings.hit_rate * 100).toFixed(1)}%)
                </p>
                <div className="quality-list">
                  {report.retrieval.cases.map((item) => (
                    <div className="quality-case" key={item.id}>
                      <strong>{item.question}</strong>
                      <small>Expected document: {item.expected_id}</small>
                      <span>
                        Word matching: {item.word_matching_hit ? 'Hit' : 'Miss'}{' '}
                        · Documents:{' '}
                        {item.word_matching_ids.join(', ') || 'None'}
                      </span>
                      <span>
                        Embeddings: {item.embeddings_hit ? 'Hit' : 'Miss'} ·
                        Documents: {item.embeddings_ids.join(', ') || 'None'}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <p>
            No saved live evaluation is available. Fixture results remain available in the Deterministic view.
          </p>
        )}
      </div>
    </main>
  );
}
