import React from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { agentHomeTicket, getLiveAllowance, getTickets } from './data';
import { SupportChat } from './_components/support-chat';
import { submitRequest } from './actions';
import { SubmitButton } from './_components/submit-button';
import { Queue } from './queue';

const topics = [
  ['Playback', 'Skipping, audio quality, lyrics', 'How do I turn on lossless audio?'],
  ['Downloads', 'Offline listening and storage', 'My downloads disappeared'],
  ['Family plan', 'Invites, members, switching plans', 'My family plan invite link expired'],
  ['Billing', 'Charges, receipts, refunds', 'I was charged twice this month'],
  ['Account & security', 'Login, password, hacked account', 'I think my account was hacked'],
  ['Cars & devices', 'Speakers, TVs, car systems', 'Can I play Tunely in my car?'],
] as const;

export default async function Home() {
  const jar = await cookies();
  const tickets = await getTickets(jar.get('demo_session')?.value);
  if (jar.get('demo_seat')?.value !== 'agent') {
    const allowance = await getLiveAllowance(jar.get('demo_session')?.value);
    return (
      <main className="workspace customer-home">
        <section className="tunely-intro">
          <h1>All your music.<br />Help when it skips.</h1>
          <p>Chat with Tunely Support. Most questions are answered in seconds, and a real person takes over when it matters.</p>
          <div className="now-playing" aria-hidden="true">
            <img src="https://images.unsplash.com/photo-1461360370896-922624d12aa1?auto=format&fit=crop&w=128&q=80" alt="" width="64" height="64" />
            <div><strong>Midnight Static</strong><br /><small>The Hollows</small><div className="playback-progress"><span /></div></div>
          </div>
        </section>
        <SupportChat tickets={tickets} allowance={allowance} home />
        <section
          className="support-steps"
          aria-label="How Tunely Support works"
        >
          <h2>How Tunely Support works</h2>
          <ol>
            <li>
              <span>1</span>
              <h3>Tell us what's wrong</h3>
              <p>In your own words, or pick a common problem.</p>
            </li>
            <li>
              <span>2</span>
              <h3>Get an answer in seconds</h3>
              <p>Our AI answers from Tunely's help articles and shows you which ones it used.</p>
            </li>
            <li>
              <span>3</span>
              <h3>A person steps in when it matters</h3>
              <p>Billing, account security, or anything the AI isn't sure about goes to our team.</p>
            </li>
          </ol>
        </section>
        <section className="support-topics" aria-label="Browse by topic">
          <h2>Browse by topic</h2>
          <div className="topic-grid">
            {topics.map(([title, description, question]) => (
              <article key={title} className="topic-tile">
                <h3>{title}</h3><p>{description}</p>
                <form action={submitRequest}>
                  <input type="hidden" name="question" value={question} />
                  <SubmitButton label={`"${question}" →`} pendingLabel="Asking..." variant="secondary" />
                </form>
              </article>
            ))}
          </div>
        </section>
      </main>
    );
  }
  const selected = agentHomeTicket(tickets);
  if (selected) redirect(`/tickets/${selected.id}`);
  return (
    <main className="workspace agent-workspace">
      <Queue tickets={tickets} />
      <section className="detail" aria-label="Request detail">
        <h1>No requests</h1>
      </section>
      <aside className="decision-trail" aria-label="How the AI decided">
        <h2>How the AI decided</h2>
      </aside>
    </main>
  );
}
