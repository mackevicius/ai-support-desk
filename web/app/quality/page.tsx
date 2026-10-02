import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getHelpArticles } from '../data';
import { getQualityReport } from './report';

export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; view?: string }>;
}) {
  const jar = await cookies();
  const session = jar.get('demo_session')?.value;
  const owner = jar.get('owner_session')?.value;
  if (!session || !owner || !(await getHelpArticles(session, owner)))
    redirect('/owner');
  const { run, view } = await searchParams;
  const retrievalView = view === 'retrieval';
  const report = await getQualityReport(retrievalView ? undefined : run);

  return (
    <main className="workspace focus-view">
      <div className="detail quality-page">
        <Link href="/" className="back">
          Back to inbox
        </Link>
        <h1>Answer quality</h1>
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
                  {report.dataset_version} · {report.model} · {report.mode}
                </p>
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
                          <span
                            className={passed ? 'quality-pass' : 'quality-fail'}
                          >
                            {passed ? 'Pass' : 'Fail'}
                          </span>
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
                  {report.retrieval.model} · {report.retrieval.metric} · Using{' '}
                  {report.retrieval.selected_method === 'embeddings'
                    ? 'embeddings'
                    : 'word matching'}
                </p>
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
            No live evaluation recorded. Run the live evaluation locally with a
            provider key to inspect measured results.
          </p>
        )}
      </div>
    </main>
  );
}
