import React from 'react';
import { cookies } from 'next/headers';
import { submitRequest } from './actions';
import { getTickets } from './data';
import { Queue } from './queue';

export default async function Home() {
  const tickets = await getTickets(
    (await cookies()).get('demo_session')?.value,
  );
  return (
    <main className="workspace inbox-view">
      <div className="inbox-intro">
        <span className="eyebrow">Workspace / 01</span>
        <h1>Support inbox</h1>
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
          <button type="submit">Submit request</button>
        </div>
      </form>
      <Queue tickets={tickets} />
    </main>
  );
}
