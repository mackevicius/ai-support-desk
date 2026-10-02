import Link from 'next/link';
import { resetWorkspace, submitRequest } from '../actions';
import type { Ticket, TicketSummary } from '../data';
import { Textarea } from '../../components/ui/textarea';
import { Input } from '../../components/ui/input';
import { SubmitButton } from './submit-button';
import { AgentSeatButton } from './agent-seat-button';
import { ChatBubble } from './chat-bubble';
import { StatusPill } from './status-pill';

function CustomerStatus({
  ticket,
  className,
}: {
  ticket: TicketSummary;
  className?: string;
}) {
  const answered = ticket.status === 'resolved';
  return (
    <StatusPill tone={answered ? 'ok' : 'team'} className={className}>
      {answered
        ? ticket.review_state === 'approved'
          ? 'Replied by our team'
          : 'Answered'
        : 'With our team'}
    </StatusPill>
  );
}

const examples = [
  ['Offline downloads', 'How do I download music for offline listening?'],
  ['Playback', 'Why does music stop after my Bluetooth headphones reconnect?'],
  ['Family invitations', 'How do I invite someone to my family plan?'],
  ['Billing', 'I was charged twice for my Tunely plan. Can you help?'],
  ['Playlist imports', 'Can I import playlists from another music service?'],
  ['Devices', 'How do I remove a listening device?'],
  ['Audio quality', 'How do I change audio quality?'],
] as const;

export function SupportChat({
  tickets,
  ticket,
  allowance,
  home = false,
}: {
  tickets: TicketSummary[];
  ticket?: Ticket;
  allowance: { remaining: number; paused: boolean };
  home?: boolean;
}) {
  if (home) {
    return (
      <section className="home-chat" aria-label="Support chat">
        <header>
          <h2>Tunely Support</h2>
          <p>AI assistant · a person steps in when it matters · Live AI: {allowance.remaining} answers left today</p>
        </header>
        <div className="home-chat-messages">
          <ChatBubble from="tunely">Hi! I'm Tunely Support. What's going wrong?</ChatBubble>
          <div className="home-chat-examples">
            {examples.map(([label, question]) => (
              <form action={submitRequest} key={label}>
                <input type="hidden" name="question" value={question} />
                <SubmitButton label={label} pendingLabel="Asking..." variant="secondary" />
              </form>
            ))}
          </div>
          {allowance.paused && <p role="status" className="paused-notice">Live AI is paused for today</p>}
        </div>
        <form className="home-chat-composer" action={submitRequest}>
          <label htmlFor="question" className="sr-only">New support request</label>
          <Input id="question" name="question" required maxLength={5000} placeholder="Describe what's going wrong..." />
          <SubmitButton label="Send" pendingLabel="Sending..." />
        </form>
      </section>
    );
  }
  const conversations = tickets;
  return (
    <div className="customer-panel">
      <aside className="conversations" aria-label="Your conversations">
        <div className="conversation-heading">
          <h2>Your conversations</h2>
          <Link href="/" className="new-conversation">
            New conversation
          </Link>
        </div>
        <nav aria-label="Conversations">
          {conversations.map((item) => (
            <Link
              key={item.id}
              href={`/tickets/${item.id}`}
              aria-current={ticket?.id === item.id ? 'page' : undefined}
            >
              <strong>{item.subject}</strong>
              <CustomerStatus ticket={item} className="mt-1" />
            </Link>
          ))}
          {!conversations.length && <p>No conversations yet</p>}
        </nav>
        <form action={resetWorkspace}>
          <SubmitButton
            label="Reset demo"
            pendingLabel="Resetting demo..."
            variant="secondary"
          />
        </form>
      </aside>
      <section className="support-chat" aria-label="Support chat">
        <header className="chat-heading">
          <div>
            <h2>Tunely support</h2>
            {ticket ? (
              <CustomerStatus ticket={ticket} />
            ) : (
              <span className="text-xs text-muted-foreground">
                New conversation
              </span>
            )}
          </div>
        </header>
        {ticket ? (
          <>
            <h1 className="chat-subject">{ticket.subject}</h1>
            <ChatBubble from="customer" own aria-label="Your message">
              {ticket.question}
            </ChatBubble>
            {ticket.history
              .filter((event) =>
                event.description.startsWith('Team asked for details: '),
              )
              .map((event) => (
                <ChatBubble
                  key={event.id}
                  from="agent"
                  label="Tunely team"
                  aria-label="Team question"
                >
                  {event.description.slice('Team asked for details: '.length)}
                </ChatBubble>
              ))}
            <ChatBubble from="tunely" label="Tunely" aria-label="Tunely reply">
              <p>
                {ticket.approved_reply ??
                  'A Tunely team member will reply soon'}
              </p>
              {ticket.status !== 'resolved' && (
                <div className="mt-2">
                  <AgentSeatButton />
                </div>
              )}
            </ChatBubble>
            {(ticket.decision?.paused || allowance.paused) && (
              <ChatBubble from="system" role="status">
                Live AI is paused for today
              </ChatBubble>
            )}
            {ticket.decision && (
              <details className="answer-explanation">
                <summary>How was this answered?</summary>
                <p>{ticket.decision.reason}</p>
                {!!ticket.decision.internal_count && (
                  <p>
                    {ticket.decision.internal_count} internal document
                    {ticket.decision.internal_count === 1 ? '' : 's'} used.
                  </p>
                )}
                {ticket.decision.sources.map((source) => (
                  <article key={source.id}>
                    <h3>{source.title}</h3>
                    <p>{source.body}</p>
                  </article>
                ))}
                {!ticket.decision.sources.length && (
                  <p>No help articles were used.</p>
                )}
              </details>
            )}
            <details className="chat-history">
              <summary>Ticket history</summary>
              <ol>
                {ticket.history.map((event) => (
                  <li key={event.id}>{event.description}</li>
                ))}
              </ol>
            </details>
          </>
        ) : (
          <>
            <div className="chat-welcome">
              <h3>What can we help with?</h3>
            </div>
            {allowance.paused && (
              <p role="status" className="paused-notice">
                Live AI is paused for today
              </p>
            )}
            <form className="chat-request" action={submitRequest}>
              <label htmlFor="question">New support request</label>
              <Textarea
                id="question"
                name="question"
                required
                maxLength={5000}
                rows={3}
                placeholder="Ask about your Tunely plan, music, or downloads"
              />
              <SubmitButton
                label="Submit request"
                pendingLabel="Submitting request..."
              />
            </form>
            <div className="chat-examples">
              {examples.map(([label, question]) => (
                <form action={submitRequest} key={label}>
                  <input type="hidden" name="question" value={question} />
                  <SubmitButton
                    label={label}
                    pendingLabel="Asking..."
                    variant="secondary"
                  />
                </form>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
