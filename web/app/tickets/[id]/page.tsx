import React from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTicket } from '../../data';

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ticket = await getTicket(
    id,
    (await cookies()).get('demo_session')?.value,
  );
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
