import React from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { generateRequest, reviewRequest } from '../../actions';
import { getTicket, getTickets } from '../../data';
import { ReviewButtons, SubmitButton } from '../../_components/submit-button';

export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ generation?: string }>;
}) {
  const { id } = await params;
  const { generation } = await searchParams;
  const jar = await cookies();
  const sessionId = jar.get('demo_session')?.value;
  const owner = Boolean(jar.get('owner_session')?.value);
  const ticket = await getTicket(id, sessionId, jar.get('owner_session')?.value);
  if (!ticket) notFound();
  const queue = await getTickets(sessionId);
  const position = queue.findIndex((item) => item.id === ticket.id);
  const next = [...queue.slice(position + 1), ...queue.slice(0, position)].find(
    (item) => item.id !== ticket.id && item.status !== 'resolved',
  );

  return (
    <main className="workspace focus-view">
      <article className="detail" aria-label="Request detail">
        <Link href="/" className="back">
          Back to inbox
        </Link>
        <div className="detail-heading">
          <div>
            <span className="eyebrow">
              Request #{ticket.id} / {ticket.customer_name}
            </span>
            <h1>{ticket.subject}</h1>
          </div>
          <div className="badges">
            <span className={`priority ${ticket.priority}`}>
              {ticket.priority} priority
            </span>
            <span className="status">{ticket.status}</span>
          </div>
        </div>
        <section className="question" aria-labelledby="question-title">
          <h2 id="question-title">Customer question</h2>
          <p>{ticket.question}</p>
        </section>
        {generation && (
          <p role="alert" className="draft-notice">
            {generation === 'limit' ? 'Daily live generation limit reached.' : 'Live generation is unavailable. Please try again later.'}
          </p>
        )}
        {owner && ticket.status === 'open' && !ticket.review_state && (
          <form action={generateRequest} className="draft-notice">
            <input type="hidden" name="id" value={ticket.id} />
            <SubmitButton label={ticket.draft?.live ? 'Regenerate live draft' : 'Generate live draft'} pendingLabel="Generating draft..." />
          </form>
        )}
        {ticket.customer_name === 'Visitor' && !ticket.draft && (
          <section className="draft-notice" aria-label="Answer draft">
            No answer draft has been generated for this request.
          </section>
        )}
        {ticket.draft && (
          <section className="draft" aria-label="Answer draft">
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
            <div className="sources">
              <h3>Supporting help articles</h3>
              {ticket.draft.sources.map((source) => (
                <article key={source.id} id={`source-${source.id}`}>
                  <h4>{source.title}</h4>
                  <p>{source.body}</p>
                </article>
              ))}
            </div>
            {['saved', 'rejected', 'reopened'].includes(ticket.draft.state) && (
              <div className="review-controls">
                {ticket.draft.state === 'saved' && ticket.priority !== ticket.draft.suggested_priority && (
                  <form action={reviewRequest} className="priority-approval">
                    <input type="hidden" name="id" value={ticket.id} />
                    <input type="hidden" name="action" value="priority" />
                    <input type="hidden" name="priority" value={ticket.draft.suggested_priority} />
                    <SubmitButton label={`Apply ${ticket.draft.suggested_priority} priority`} pendingLabel="Applying priority..." />
                  </form>
                )}
                <form action={reviewRequest} className="review-form">
                  <input type="hidden" name="id" value={ticket.id} />
                  <label htmlFor="reply">Reply</label>
                  <textarea
                    id="reply"
                    name="reply"
                    defaultValue={
                      ticket.draft.state === 'saved'
                        ? ticket.draft.reply
                        : ticket.draft.state === 'reopened'
                          ? (ticket.approved_reply ?? '')
                          : ''
                    }
                    required
                    maxLength={5000}
                    rows={5}
                  />
                  <label htmlFor="priority">Priority</label>
                  <select
                    id="priority"
                    name="priority"
                    defaultValue={
                      ticket.draft.state === 'saved'
                        ? ticket.draft.suggested_priority
                        : ticket.priority
                    }
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                  <ReviewButtons showReject={ticket.draft.state === 'saved'} />
                </form>
              </div>
            )}
            {ticket.draft.state === 'rejected' && (
              <p>
                Suggestion rejected. No reply was delivered. Write your own
                reply to resolve the request.
              </p>
            )}
            {ticket.approved_reply && (
              <div className="approved-reply">
                <h3>Approved in-app reply</h3>
                <p>{ticket.approved_reply}</p>
              </div>
            )}
            {ticket.draft.state === 'approved' && (
              <form action={reviewRequest}>
                <input type="hidden" name="id" value={ticket.id} />
                <input type="hidden" name="action" value="reopen" />
                <SubmitButton label="Reopen request" pendingLabel="Reopening request..." className="secondary" />
              </form>
            )}
          </section>
        )}
        {!ticket.draft && ticket.status === 'resolved' && (
          <form action={reviewRequest} className="draft">
            <input type="hidden" name="id" value={ticket.id} />
            <input type="hidden" name="action" value="reopen" />
            <SubmitButton label="Reopen request" pendingLabel="Reopening request..." className="secondary" />
          </form>
        )}
        {!ticket.draft && ticket.review_state === 'reopened' && (
          <form action={reviewRequest} className="draft review-form">
            <h2>Write a replacement reply</h2>
            <input type="hidden" name="id" value={ticket.id} />
            <input type="hidden" name="action" value="approve" />
            <label htmlFor="reply">Reply</label>
            <textarea
              id="reply"
              name="reply"
              required
              maxLength={5000}
              rows={5}
            />
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
            <SubmitButton label="Approve in-app reply" pendingLabel="Approving reply..." />
          </form>
        )}
        {!ticket.draft && ticket.approved_reply && (
          <section className="approved-reply">
            <h2>Approved in-app reply</h2>
            <p>{ticket.approved_reply}</p>
          </section>
        )}
        <section className="history" aria-labelledby="history-title">
          <h2 id="history-title">History</h2>
          <ol>
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
          </ol>
        </section>
        {next && (
          <Link href={`/tickets/${next.id}`} className="next-request">
            Next request &rarr;
          </Link>
        )}
      </article>
    </main>
  );
}
