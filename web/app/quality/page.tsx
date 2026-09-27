import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getHelpArticles } from '../data';
import { getQualityReport } from './report';

export default async function QualityPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const jar = await cookies();
  const session = jar.get('demo_session')?.value;
  const owner = jar.get('owner_session')?.value;
  if (!session || !owner || !await getHelpArticles(session, owner)) redirect('/owner');
  const { run } = await searchParams;
  const report = await getQualityReport(run);

  return (
    <main className="workspace focus-view">
      <div className="detail quality-page">
        <Link href="/" className="back">Back to inbox</Link>
        <h1>Answer quality</h1>
        <nav className="quality-tabs" aria-label="Evaluation runs">
          <Link href="/quality" aria-current={run === 'live' ? undefined : 'page'}>Deterministic</Link>
          <Link href="/quality?run=live" aria-current={run === 'live' ? 'page' : undefined}>Live</Link>
        </nav>
        {report ? (
          <>
            <p className="quality-meta">{report.dataset_version} · {report.model} · {report.mode}</p>
            <p className="quality-summary">{report.cases.filter((item) => Object.values(item.checks).every(Boolean)).length} of {report.cases.length} cases pass</p>
            <div className="quality-list">
              {report.cases.map((item) => {
                const passed = Object.values(item.checks).every(Boolean);
                return (
                  <Link className="quality-case" href={`/quality/${item.id}${run === 'live' ? '?run=live' : ''}`} key={item.id}>
                    <span className="quality-case-top"><strong>{item.id}</strong><span className={passed ? 'quality-pass' : 'quality-fail'}>{passed ? 'Pass' : 'Fail'}</span></span>
                    <span>{item.question}</span>
                    <small>{item.categories.join(' · ')}</small>
                    <span className="quality-checks">{Object.entries(item.checks).map(([name, ok]) => `${name}: ${ok ? 'pass' : 'fail'}`).join(' · ')}</span>
                  </Link>
                );
              })}
            </div>
          </>
        ) : <p>No live evaluation recorded. Run the live evaluation locally with a provider key to inspect measured results.</p>}
      </div>
    </main>
  );
}