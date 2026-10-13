import React from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { generateRequest } from '../../actions';
import { getConversation } from '../../data';
import { SubmitButton } from '../../_components/submit-button';
import { ReplyForm } from '../../_components/reply-editor';
import { SupportChat } from '../../_components/support-chat';
import { Queue } from '../../queue';
import { HelpArticleForm } from '../../_components/help-article-form';
import { ChatBubble } from '../../_components/chat-bubble';
import { ConversationUpdates } from '../../_components/conversation-updates';
import {
  StatusPill,
  priorityTone,
  ticketLabel,
  ticketTone,
} from '../../_components/status-pill';

export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ generation?: string; article?: string }>;
}) {
  const { id } = await params;
  const { generation, article } = await searchParams;
  const jar = await cookies();
  const sessionId = jar.get('demo_session')?.value;
  const owner = Boolean(jar.get('owner_session')?.value);
  const {
    ticket,
    tickets: queue,
    allowance,
  } = await getConversation(
    id,
    sessionId,
    jar.get('owner_session')?.value,
    jar.get('demo_seat')?.value === 'agent' ? 'agent' : 'customer',
  );
  if (!ticket) notFound();
  if (jar.get('demo_seat')?.value !== 'agent') {
    return (
      <main className="workspace customer-ticket">
        <SupportChat tickets={queue} ticket={ticket} allowance={allowance} />
      </main>
    );
  }
  const position = queue.findIndex((item) => item.id === ticket.id);
  const next = [...queue.slice(position + 1), ...queue.slice(0, position)].find(
    (item) => item.id !== ticket.id && item.status === 'open',
  );
  const draftAnswered =
    ticket.history.findLastIndex((event) =>
      event.description.startsWith('Agent replied: '),
    ) >
    ticket.history.findLastIndex(
      (event) => event.description === 'Agent requested a new answer draft',
    );

  return (
    <main className="workspace focus-view agent-workspace">
      <Queue tickets={queue} selectedId={ticket.id} />
      <article className="detail" aria-label="Request detail">
        <h1 className="sr-only">{ticket.subject}</h1>
        <section className="agent-messages" aria-label="Conversation">
          <ChatBubble from="customer">{ticket.question}</ChatBubble>
          <ChatBubble from="system">
            {ticket.decision?.kind === 'automatic_reply'
              ? 'AI replied automatically'
              : 'AI handed this conversation to you'}
          </ChatBubble>
          <ConversationUpdates
            history={ticket.history}
            agent
            reply={ticket.approved_reply}
          />
        </section>
        <div className="agent-composer">
          {generation && (
            <p role="alert" className="draft-notice">
              {generation === 'limit'
                ? 'Live AI is paused for today'
                : 'Live generation is unavailable. Please try again later.'}
            </p>
          )}
          {article === 'saved' && (
            <p role="status" className="draft-notice">
              Help article saved.
            </p>
          )}
          {ticket.customer_name === 'Visitor' && !ticket.draft && (
            <section className="draft-notice" aria-label="Answer draft">
              No answer draft has been generated for this request.
            </section>
          )}
          {ticket.draft && ticket.status !== 'solved' && (
            <section className="draft" aria-label="Answer draft">
              <div className="review-controls">
                <ReplyForm
                  key={`${ticket.draft.reply}-${ticket.history.length}`}
                  ticketId={String(ticket.id)}
                  initialCopies={
                    draftAnswered ? [] : (ticket.draft.internal_copies ?? [])
                  }
                  defaultValue={draftAnswered ? '' : ticket.draft.reply}
                >
                  <label htmlFor="priority">Priority</label>
                  <select
                    id="priority"
                    name="priority"
                    defaultValue={ticket.draft.suggested_priority}
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </ReplyForm>
              </div>
            </section>
          )}
          {!ticket.draft && ticket.status !== 'solved' && (
            <section className="draft">
              <h2>Write a replacement reply</h2>
              <ReplyForm
                ticketId={String(ticket.id)}
                defaultValue=""
                initialCopies={[]}
              >
                <label htmlFor="priority">Priority</label>
                <select
                  id="priority"
                  name="priority"
                  defaultValue={ticket.priority}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </ReplyForm>
            </section>
          )}
          {ticket.can_redraft && ticket.status !== 'solved' && (
            <form action={generateRequest} className="agent-redraft">
              <input type="hidden" name="id" value={ticket.id} />
              <SubmitButton
                label={
                  (!owner || !ticket.is_sample) && ticket.decision
                    ? 'Redraft'
                    : ticket.draft?.live
                      ? 'Regenerate live draft'
                      : 'Generate live draft'
                }
                pendingLabel="Generating draft..."
                variant="secondary"
              />
              {ticket.live_ai && (
                <p>{ticket.live_ai.remaining} live drafts left</p>
              )}
            </form>
          )}
          {next && (
            <Link href={`/tickets/${next.id}`} className="next-request">
              Next request &rarr;
            </Link>
          )}
        </div>
      </article>
      <aside className="decision-trail" aria-label="How the AI decided">
        <h2>How the AI decided</h2>
        <ol>
          <li>
            <h3>Read the message</h3>
            <p>
              {ticket.decision?.topic ?? 'Sample request'} ·{' '}
              {ticket.decision?.suggested_priority ??
                ticket.draft?.suggested_priority ??
                ticket.priority}{' '}
              priority
            </p>
            <div className="badges">
              <StatusPill tone={priorityTone(ticket.priority)}>
                {ticket.priority} priority
              </StatusPill>
              <StatusPill tone={ticketTone(ticket.status)}>
                {ticketLabel(ticket.status)}
              </StatusPill>
            </div>
          </li>
          <li>
            <h3>Searched the knowledge base</h3>
            {(ticket.decision?.documents ?? ticket.draft?.sources ?? []).map(
              (source) => (
                <article key={source.id} id={`source-${source.id}`}>
                  <h4>{source.title}</h4>
                  <span className="source-kind">
                    {source.kind === 'internal_note' ? 'Internal' : 'Help'}
                  </span>
                  <details>
                    <summary>Read source</summary>
                    <p>
                      {
                        (
                          ticket.draft?.sources ??
                          ticket.decision?.sources ??
                          []
                        ).find((article) => article.id === source.id)?.body
                      }
                    </p>
                  </details>
                </article>
              ),
            )}
            {!(ticket.decision?.documents ?? ticket.draft?.sources ?? [])
              .length && <p>No supporting documents found.</p>}
          </li>
          <li>
            <h3>Checked the rules</h3>
            <p>
              {ticket.decision?.rule ?? 'Agent review required for this sample'}
            </p>
          </li>
          <li>
            <h3>
              {ticket.decision?.kind === 'automatic_reply'
                ? 'Replied automatically'
                : 'Handed off to a person'}
            </h3>
            <p>
              {ticket.decision?.reason ??
                'This sample draft is waiting for agent review.'}
            </p>
          </li>
          {ticket.history.some((event) => event.description === 'Customer asked for a person') && (
            <li>
              <h3>Handed off to a person</h3>
              <p>Customer asked for a person</p>
            </li>
          )}
        </ol>
        {ticket.decision?.reason_code === 'knowledge_gap' &&
          ticket.status !== 'solved' && (
            <section
              className="knowledge-gap"
              aria-labelledby="knowledge-gap-title"
            >
              <h2 id="knowledge-gap-title">Knowledge gap</h2>
              <details>
                <summary>Write a help article for this</summary>
                <HelpArticleForm ticketId={ticket.id} />
              </details>
            </section>
          )}
        {ticket.draft && (
          <div className="agent-draft-meta">
            <h2>{ticket.draft.live ? 'Live AI draft' : 'Saved AI draft'}</h2>
            <p className="draft-label">
              {ticket.draft.live
                ? 'Live suggestion. Nothing is sent without approval.'
                : 'Saved result for this sample request. Nothing is sent without approval.'}
            </p>
            <p>
              Suggested priority:{' '}
              <strong>{ticket.draft.suggested_priority}</strong>
            </p>
            <p className="source-links">
              Sources:{' '}
              {ticket.draft.sources.map((source) => (
                <a key={source.id} href={`#source-${source.id}`}>
                  {source.title}
                </a>
              ))}
            </p>
          </div>
        )}
        <section className="history" aria-labelledby="history-title">
          <h2 id="history-title">History</h2>
          <ul>
            {ticket.history.map((event) => (
              <li key={event.id}>
                <time dateTime={event.created_at}>
                  {new Date(event.created_at).toLocaleString('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'UTC',
                  })}{' '}
                  UTC
                </time>
                <p>{event.description}</p>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </main>
  );
}
