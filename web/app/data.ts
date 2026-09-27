export type TicketSummary = {
  id: number;
  customer_name: string;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
};

export type Ticket = TicketSummary & {
  question: string;
  approved_reply: string | null;
  review_state: 'approved' | 'rejected' | 'reopened' | null;
  draft: null | {
    state: 'saved' | 'approved' | 'rejected' | 'reopened';
    reply: string;
    suggested_priority: 'low' | 'normal' | 'high';
    sources: { id: number; title: string; body: string }[];
  };
  history: { id: number; description: string; created_at: string }[];
};

export async function getTickets(sessionId?: string): Promise<TicketSummary[]> {
  const response = await fetch(
    `${process.env.API_URL ?? 'http://localhost:3001'}/tickets`,
    {
      cache: 'no-store',
      headers: sessionId ? { cookie: `demo_session=${sessionId}` } : undefined,
    },
  );
  if (!response.ok) throw new Error('Could not load the support inbox');
  return response.json();
}

export async function getTicket(
  id: string,
  sessionId?: string,
): Promise<Ticket | null> {
  const response = await fetch(
    `${process.env.API_URL ?? 'http://localhost:3001'}/tickets/${encodeURIComponent(id)}`,
    {
      cache: 'no-store',
      headers: sessionId ? { cookie: `demo_session=${sessionId}` } : undefined,
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Could not load the support request');
  return response.json();
}

export async function submitQuestion(
  question: string,
  sessionId: string,
): Promise<number> {
  const response = await fetch(
    `${process.env.API_URL ?? 'http://localhost:3001'}/tickets`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `demo_session=${sessionId}`,
      },
      body: JSON.stringify({ question }),
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('Could not submit the support request');
  const ticket: { id: number } = await response.json();
  return ticket.id;
}

export async function resetDemo(sessionId: string) {
  const response = await fetch(
    `${process.env.API_URL ?? 'http://localhost:3001'}/reset`,
    {
      method: 'POST',
      headers: { cookie: `demo_session=${sessionId}` },
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('Could not reset the demo workspace');
}

export async function reviewTicket(
  id: string,
  sessionId: string,
  action: string,
  reply?: string,
  priority?: string,
) {
  const response = await fetch(
    `${process.env.API_URL ?? 'http://localhost:3001'}/tickets/${encodeURIComponent(id)}/review`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `demo_session=${sessionId}`,
      },
      body: JSON.stringify({ action, reply, priority }),
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('Could not review the support request');
}
