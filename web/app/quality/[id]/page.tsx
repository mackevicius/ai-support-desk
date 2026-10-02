import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getQualityReport } from '../report';

export default async function QualityCasePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
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
        <p className="quality-meta">{report.dataset_version} · {report.model} · {report.mode} · <time dateTime={report.evaluated_at}>{report.evaluated_at?.slice(0, 10) ?? 'Date not recorded'}</time></p>
        <p>{item.categories.join(' · ')}</p>
        <section className="quality-section"><h2>Question</h2><p>{item.question}</p></section>
        <section className="quality-section"><h2>Expected behavior</h2>
          <p>{item.expected.reply ?? 'Ask for clarification or hand off without citing unsupported sources.'}</p>
          {item.expected.clarification_allowed && <p>Clarification without citations is also acceptable.</p>}
          <p>Sources: {item.expected.source_ids?.join(', ') || 'none'}{item.expected.suggested_priority ? ` · Priority: ${item.expected.suggested_priority}` : ''}</p>
          {typeof item.expected.hand_off === 'boolean' && <p>Decision: {item.expected.hand_off ? 'Hand-off' : 'Automatic reply'}</p>}
        </section>
        <section className="quality-section"><h2>Actual answer</h2>
          <p>{item.actual.reply}</p>
          {item.error && <p role="alert">Generation error: {item.error}</p>}
          <p>Sources: {item.actual.source_ids.join(', ') || 'none'} · Priority: {item.actual.suggested_priority}</p>
          {typeof item.actual.hand_off === 'boolean' && <p>Decision: {item.actual.hand_off ? 'Hand-off' : 'Automatic reply'}</p>}
          {item.latency_ms !== undefined && <p>Model: {item.model ?? 'not reported'} · Latency: {item.latency_ms} ms · Usage: {item.usage?.prompt_tokens ?? 'unavailable'} input / {item.usage?.completion_tokens ?? 'unavailable'} output tokens · Estimated cost: {item.estimated_cost_usd == null ? 'unavailable' : `$${item.estimated_cost_usd.toFixed(6)}`}</p>}
          <ul>{Object.entries(item.checks).map(([name, ok]) => <li key={name} className={ok ? 'quality-pass' : 'quality-fail'}>{name}: {ok ? 'pass' : 'fail'}</li>)}</ul>
        </section>
        <section className="quality-section"><h2>Fictional supporting sources</h2>
          <p>These are published evaluation fixtures, including simulated staff-only notes. No private visitor documents or live knowledge-base edits are included.</p>
          {item.sources.length === 0 && <p>No sources cited.</p>}
          {item.sources.map((source) => <div key={source.id} className="quality-source"><h3>{source.title} (#{source.id})</h3><p>{source.body}</p></div>)}
          <h3>Available candidate documents</h3>
          {item.available_sources.map((source) => <div key={source.id} className="quality-source"><strong>{source.title} (#{source.id})</strong><p>{source.body}</p></div>)}
        </section>
      </article>
    </main>
  );
}