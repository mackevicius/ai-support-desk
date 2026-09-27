import React from 'react';
import { cookies } from 'next/headers';
import { resetWorkspace, submitRequest } from './actions';
import { getTickets } from './data';
import { Queue } from './queue';
import { SubmitButton } from './_components/submit-button';

export default async function Home() {
  const tickets = await getTickets(
    (await cookies()).get('demo_session')?.value,
  );
  return (
    <main className="workspace inbox-view">
      <div className="inbox-intro">
        <div>
          <span className="eyebrow">Workspace / 01</span>
          <h1>Support inbox</h1>
        </div>
        <form action={resetWorkspace}>
          <SubmitButton className="reset-button" label="Reset demo" pendingLabel="Resetting demo..." />
        </form>
      </div>
      <form className="request-form" action={submitRequest}>
        <label htmlFor="question">New support request</label>
        <textarea
          id="question"
          name="question"
          required
          maxLength={5000}
          rows={3}
          placeholder="Describe what you need help with"
        />
        <div className="form-footer">
          <span>New requests do not receive an AI-generated answer draft.</span>
          <SubmitButton label="Submit request" pendingLabel="Submitting request..." />
        </div>
      </form>
      <Queue tickets={tickets} />
    </main>
  );
}
