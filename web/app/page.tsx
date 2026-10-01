import React from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { agentHomeTicket, getLiveAllowance, getTickets } from './data';
import { SupportChat } from './_components/support-chat';
import { Queue } from './queue';

export default async function Home() {
  const jar = await cookies();
  const tickets = await getTickets(jar.get('demo_session')?.value);
  if (jar.get('demo_seat')?.value !== 'agent') {
    const allowance = await getLiveAllowance(jar.get('demo_session')?.value);
    return (
      <main className="workspace customer-home">
        <section className="tunely-intro">
          <h1>Tunely</h1>
          <p>
            Your music.
            <br />
            Without missing a beat.
          </p>
          <img
            src="https://images.unsplash.com/photo-1461360370896-922624d12aa1?auto=format&fit=crop&w=700&q=80"
            alt="A record playing on a turntable"
            width="700"
            height="467"
          />
        </section>
        <SupportChat tickets={tickets} allowance={allowance} />
        <section className="support-steps" aria-label="How Tunely Support works">
          <h2>How Tunely Support works</h2>
          <ol>
            <li><span>01</span><h3>Tell us</h3><p>What happened with your music?</p></li>
            <li><span>02</span><h3>Get an answer in seconds</h3><p>Answers grounded in Tunely's knowledge base.</p></li>
            <li><span>03</span><h3>A person steps in when it matters</h3><p>Our team checks sensitive or uncertain answers.</p></li>
          </ol>
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
