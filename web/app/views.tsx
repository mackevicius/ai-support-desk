import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { submitRequest } from './actions';
import { getTicket, getTickets } from './data';
import { Queue } from './queue';

export async function renderHome(sessionId?: string) {
  const tickets = await getTickets(sessionId);
  return (
    <main className="workspace inbox-view">
      <div className="inbox-intro">
        <span className="eyebrow">Workspace / 01</span>
        <h1>Support inbox</h1>
      </div>
      <form className="request-form" action={submitRequest}>
        <label htmlFor="question">New support request</label>
        <textarea id="question" name="question" required maxLength={5000} rows={3} placeholder="Describe what you need help with" />
        <div className="form-footer">
          <span>New requests do not receive an AI-generated answer draft.</span>
          <button type="submit">Submit request</button>
        </div>
      </form>
      <Queue tickets={tickets} />
    </main>
  );
}

export async function renderTicketPage(id: string, sessionId?: string) {
  const ticket = await getTicket(id, sessionId);
  if (!ticket) notFound();

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
      </article>
    </main>
  );
}