'use client';

import React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import type { TicketSummary } from './data';
import { resetWorkspace } from './actions';
import { SubmitButton } from './_components/submit-button';
import { Avatar, AvatarFallback } from '../components/ui/avatar';

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
        <h2>Support inbox</h2>
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
            <Avatar className="size-9" aria-hidden="true">
              <AvatarFallback className="bg-[#ffd9bd] text-[13px] font-extrabold text-[#8a3500]">
                {ticket.customer_name
                  .trim()
                  .split(/\s+/)
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="request-copy">
              <span className="request-top">
                <strong>{ticket.customer_name}</strong>
                <small>
                  {' · '}
                  {ticket.status === 'resolved'
                    ? 'resolved'
                    : new Date(ticket.created_at).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZone: 'UTC',
                      })}
                </small>
              </span>
              <span className="subject">{ticket.subject}</span>
            </span>
          </Link>
        ))}
        {!visible.length && <p className="queue-empty">No requests</p>}
      </nav>
      <form action={resetWorkspace} className="queue-reset">
        <SubmitButton
          label="Reset demo"
          pendingLabel="Resetting demo..."
          variant="secondary"
        />
      </form>
    </aside>
  );
}
