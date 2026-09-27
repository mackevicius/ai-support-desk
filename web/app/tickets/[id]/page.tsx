import React from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { reviewRequest } from '../../actions';
import { getTicket, getTickets } from '../../data';

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionId = (await cookies()).get('demo_session')?.value;
  const ticket = await getTicket(id, sessionId);
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
        {ticket.customer_name === 'Visitor' && (
          <section className="draft-notice" aria-label="Answer draft">
            No answer draft has been generated for this request.
          </section>
        )}
        {ticket.draft && (
          <section className="draft" aria-label="Answer draft">
            <h2>Saved AI draft</h2>
            <p className="draft-label">
              Saved result for this sample request. Nothing is sent without
              approval.
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
                <form action={reviewRequest} className="review-form">
                  <input type="hidden" name="id" value={ticket.id} />
                  <input type="hidden" name="action" value="approve" />
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
                  <button type="submit">Approve in-app reply</button>
                </form>
                {ticket.draft.state === 'saved' && (
                  <form action={reviewRequest}>
                    <input type="hidden" name="id" value={ticket.id} />
                    <input type="hidden" name="action" value="reject" />
                    <button type="submit" className="secondary">
                      Reject suggestion
                    </button>
                  </form>
                )}
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
                <button type="submit" className="secondary">
                  Reopen request
                </button>
              </form>
            )}
          </section>
        )}
        {!ticket.draft && ticket.status === 'resolved' && (
          <form action={reviewRequest} className="draft">
            <input type="hidden" name="id" value={ticket.id} />
            <input type="hidden" name="action" value="reopen" />
            <button type="submit" className="secondary">
              Reopen request
            </button>
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
            <button type="submit">Approve in-app reply</button>
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
