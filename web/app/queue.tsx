import React from 'react';
import Link from 'next/link';
import type { TicketSummary } from './data';

export function Queue({ tickets }: { tickets: TicketSummary[] }) {
  return <aside className="queue" aria-label="Support inbox">
    <div className="queue-header"><span>Inbox</span><strong>{tickets.length}</strong></div>
    <nav aria-label="Requests">
      {tickets.map((ticket) => <Link key={ticket.id} href={`/tickets/${ticket.id}`} className="request">
        <span className="request-top"><strong>{ticket.customer_name}</strong><small>{new Date(ticket.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</small></span>
        <span className="subject">{ticket.subject}</span>
        <span className="request-meta"><span className={`priority ${ticket.priority}`}>{ticket.priority} priority</span><span>{ticket.status}</span></span>
      </Link>)}
    </nav>
  </aside>;
}