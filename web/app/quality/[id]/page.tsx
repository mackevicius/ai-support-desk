import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getHelpArticles } from '../../data';
import { getQualityReport } from '../report';

export default async function QualityCasePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const jar = await cookies();
  const session = jar.get('demo_session')?.value;
  const owner = jar.get('owner_session')?.value;
  if (!session || !owner || !await getHelpArticles(session, owner)) redirect('/owner');
  const { run } = await searchParams;
  const { id } = await params;
  const report = await getQualityReport(run);
  const item = report?.cases.find((entry) => entry.id === id);
  if (!report || !item) notFound();

  return (
    <main className="workspace focus-view">
      <article className="detail quality-page">
        <Link href={`/quality${run === 'live' ? '?run=live' : ''}`} className="back">Back to quality</Link>
        <h1>{item.id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')}</h1>
        <p className="quality-meta">{report.dataset_version} · {report.model} · {report.mode}</p>
        <p>{item.categories.join(' · ')}</p>
        <section className="quality-section"><h2>Question</h2><p>{item.question}</p></section>
        <section className="quality-section"><h2>Expected behavior</h2>
          <p>{item.expected.reply ?? 'Ask for clarification or hand off without citing unsupported sources.'}</p>
          {item.expected.clarification_allowed && <p>Clarification without citations is also acceptable.</p>}
          <p>Sources: {item.expected.source_ids?.join(', ') || 'none'}{item.expected.suggested_priority ? ` · Priority: ${item.expected.suggested_priority}` : ''}</p>
        </section>
        <section className="quality-section"><h2>Actual answer</h2>
          <p>{item.actual.reply}</p>
          {item.error && <p role="alert">Generation error: {item.error}</p>}
          <p>Sources: {item.actual.source_ids.join(', ') || 'none'} · Priority: {item.actual.suggested_priority}</p>
          {item.latency_ms !== undefined && <p>Model: {item.model ?? 'not reported'} · Latency: {item.latency_ms} ms · Usage: {item.usage?.prompt_tokens ?? 'unavailable'} input / {item.usage?.completion_tokens ?? 'unavailable'} output tokens · Estimated cost: {item.estimated_cost_usd == null ? 'unavailable' : `$${item.estimated_cost_usd.toFixed(6)}`}</p>}
          <ul>{Object.entries(item.checks).map(([name, ok]) => <li key={name} className={ok ? 'quality-pass' : 'quality-fail'}>{name}: {ok ? 'pass' : 'fail'}</li>)}</ul>
        </section>
        <section className="quality-section"><h2>Supporting sources</h2>
          {item.sources.length === 0 && <p>No sources cited.</p>}
          {item.sources.map((source) => <div key={source.id} className="quality-source"><h3>{source.title} (#{source.id})</h3><p>{source.body}</p></div>)}
          <h3>Available candidate documents</h3>
          {item.available_sources.map((source) => <div key={source.id} className="quality-source"><strong>{source.title} (#{source.id})</strong><p>{source.body}</p></div>)}
        </section>
      </article>
    </main>
  );
}