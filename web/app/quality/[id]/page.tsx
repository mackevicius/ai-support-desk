import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getQualityReport } from '../report';
import { Card } from '../../../components/ui/card';
import { Separator } from '../../../components/ui/separator';
import { priorityTone, StatusPill } from '../../_components/status-pill';

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
        <Separator className="mt-6" />
        <section className="quality-section"><h2>Question</h2><p>{item.question}</p></section>
        <Separator />
        <section className="quality-section"><h2>Expected behavior</h2>
          <p>{item.expected.reply ?? 'Ask for clarification or hand off without citing unsupported sources.'}</p>
          {item.expected.clarification_allowed && <p>Clarification without citations is also acceptable.</p>}
          <p>Sources: {item.expected.source_ids?.join(', ') || 'none'}{item.expected.suggested_priority && <> · Priority: <StatusPill tone={priorityTone(item.expected.suggested_priority)}>{item.expected.suggested_priority}</StatusPill></>}</p>
          {typeof item.expected.hand_off === 'boolean' && <p>Decision: <StatusPill tone={item.expected.hand_off ? 'team' : 'ok'}>{item.expected.hand_off ? 'Hand-off' : 'Automatic reply'}</StatusPill></p>}
        </section>
        <Separator />
        <section className="quality-section"><h2>Actual answer</h2>
          <p>{item.actual.reply}</p>
          {item.error && <p role="alert">Generation error: {item.error}</p>}
          <p>Sources: {item.actual.source_ids.join(', ') || 'none'} · Priority: <StatusPill tone={priorityTone(item.actual.suggested_priority)}>{item.actual.suggested_priority}</StatusPill></p>
          {typeof item.actual.hand_off === 'boolean' && <p>Decision: <StatusPill tone={item.actual.hand_off ? 'team' : 'ok'}>{item.actual.hand_off ? 'Hand-off' : 'Automatic reply'}</StatusPill></p>}
          {item.latency_ms !== undefined && <p>Model: {item.model ?? 'not reported'} · Latency: {item.latency_ms} ms · Usage: {item.usage?.prompt_tokens ?? 'unavailable'} input / {item.usage?.completion_tokens ?? 'unavailable'} output tokens · Estimated cost: {item.estimated_cost_usd == null ? 'unavailable' : `$${item.estimated_cost_usd.toFixed(6)}`}</p>}
          <ul className="grid list-none gap-3 p-0">{Object.entries(item.checks).map(([name, ok]) => <li key={name} className="flex flex-wrap items-center gap-2">{name}: <StatusPill tone={ok ? 'ok' : 'alert'}>{ok ? 'pass' : 'fail'}</StatusPill></li>)}</ul>
        </section>
        <Separator />
        <section className="quality-section"><h2>Fictional supporting sources</h2>
          <p>These are published evaluation fixtures, including simulated staff-only notes. No private visitor documents or live knowledge-base edits are included.</p>
          {item.sources.length === 0 && <p>No sources cited.</p>}
          {item.sources.map((source) => <Card key={source.id} className="my-3 gap-2 rounded-lg p-4"><h3>{source.title} (#{source.id})</h3><p>{source.body}</p></Card>)}
          <h3>Available candidate documents</h3>
          {item.available_sources.map((source) => <Card key={source.id} className="my-3 gap-2 rounded-lg p-4"><strong>{source.title} (#{source.id})</strong><p>{source.body}</p></Card>)}
        </section>
      </article>
    </main>
  );
}