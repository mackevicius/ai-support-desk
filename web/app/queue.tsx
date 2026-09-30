'use client';

import React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import type { TicketSummary } from './data';

export function Queue({
  tickets,
  selectedId,
}: {
  tickets: TicketSummary[];
  selectedId?: number;
}) {
  const [status, setStatus] = useState('all');
  const visible = tickets.filter(
    (ticket) => status === 'all' || ticket.status === status,
  );
  return (
    <aside className="queue" aria-label="Support inbox">
      <div className="queue-header">
        <span>Inbox</span>
        <strong>{tickets.length}</strong>
      </div>
      <label className="queue-filter">
        Status
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
        </select>
      </label>
      <nav aria-label="Requests">
        {visible.map((ticket) => (
          <Link
            key={ticket.id}
            href={`/tickets/${ticket.id}`}
            className="request"
            aria-current={selectedId === ticket.id ? 'page' : undefined}
          >
            <span className="request-top">
              <strong>{ticket.customer_name}</strong>
              <small>
                {new Date(ticket.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'UTC',
                })}
              </small>
            </span>
            <span className="subject">{ticket.subject}</span>
            <span className="request-meta">
              <span className={`priority ${ticket.priority}`}>
                {ticket.priority} priority
              </span>
              <span>{ticket.status}</span>
            </span>
          </Link>
        ))}
        {!visible.length && <p className="queue-empty">No requests</p>}
      </nav>
    </aside>
  );
}
