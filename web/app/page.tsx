import React from 'react';
import { cookies } from 'next/headers';
import { resetWorkspace, submitRequest } from './actions';
import { getLiveAllowance, getTickets } from './data';
import { SupportChat } from './_components/support-chat';
import { Queue } from './queue';
import { SubmitButton } from './_components/submit-button';
import { Textarea } from '../components/ui/textarea';

export default async function Home() {
  const jar = await cookies();
  const tickets = await getTickets(
    jar.get('demo_session')?.value,
  );
  if (jar.get('demo_seat')?.value !== 'agent') {
    const allowance = await getLiveAllowance(jar.get('demo_session')?.value);
    return <main className="workspace customer-home"><section className="tunely-intro">
      <h1>Tunely</h1><p>Your music.<br />Without missing a beat.</p>
      <img src="https://images.unsplash.com/photo-1461360370896-922624d12aa1?auto=format&fit=crop&w=700&q=80" alt="A record playing on a turntable" width="700" height="467" />
    </section><SupportChat tickets={tickets} allowance={allowance} /></main>;
  }
  return (
    <main className="workspace inbox-view">
      <div className="inbox-intro">
        <div>
          <span className="eyebrow">Workspace / 01</span>
          <h1>Support inbox</h1>
        </div>
        <form action={resetWorkspace}>
          <SubmitButton className="reset-button" variant="secondary" label="Reset demo" pendingLabel="Resetting demo..." />
        </form>
      </div>
      <form className="request-form" action={submitRequest}>
        <label htmlFor="question">New support request</label>
        <Textarea
          id="question"
          name="question"
          required
          maxLength={5000}
          rows={3}
          placeholder="Describe what you need help with"
        />
        <div className="form-footer">
          <span>Ask Tunely a question</span>
          <SubmitButton label="Submit request" pendingLabel="Submitting request..." />
        </div>
      </form>
      <Queue tickets={tickets} />
    </main>
  );
}
