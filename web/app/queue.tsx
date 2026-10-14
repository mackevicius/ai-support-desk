'use client';

import React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import type { TicketSummary } from './data';
import { resetWorkspace } from './actions';
import { SubmitButton } from './_components/submit-button';
import { StatusPill, ticketLabel, ticketTone } from './_components/status-pill';
import { Avatar, AvatarFallback } from '../components/ui/avatar';

const tabs = [
  { id: 'needs-reply', label: 'Needs reply' },
  { id: 'all', label: 'All' },
] as const;

export function Queue({
  tickets,
  selectedId,
}: {
  tickets: TicketSummary[];
  selectedId?: number;
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('needs-reply');
  const visible = tickets.filter(
    (ticket) => tab === 'all' || ticket.status === 'open',
  );
  return (
    <aside className="queue" aria-label="Support inbox">
      <div className="queue-header">
        <h2>Support inbox</h2>
        <strong>{tickets.length}</strong>
      </div>
      <div
        role="tablist"
        aria-label="Filter requests"
        className="queue-tabs"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          const next = tabs.find((item) => item.id !== tab)!;
          setTab(next.id);
          document.getElementById(`queue-tab-${next.id}`)?.focus();
        }}
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            id={`queue-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="queue-requests"
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="queue-requests"
        aria-labelledby={`queue-tab-${tab}`}
      >
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
                  {ticket.status === 'open' ? (
                    <small>
                      {' · '}
                      {new Date(ticket.created_at).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZone: 'UTC',
                      })}
                    </small>
                  ) : (
                    <StatusPill tone={ticketTone(ticket.status)}>
                      {ticketLabel(ticket.status)}
                    </StatusPill>
                  )}
                </span>
                <span className="subject">{ticket.subject}</span>
              </span>
            </Link>
          ))}
          {!visible.length && <p className="queue-empty">No requests</p>}
        </nav>
      </div>
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
