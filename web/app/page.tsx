import React from 'react';
import { getTickets } from './data';
import { Queue } from './queue';

export default async function Home() {
  const tickets = await getTickets();
  return <main className="workspace inbox-view">
    <div className="inbox-intro"><span className="eyebrow">Workspace / 01</span><h1>Support inbox</h1></div>
    <Queue tickets={tickets} />
  </main>;
}