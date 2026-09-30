export type TicketSummary = {
  id: number;
  customer_name: string;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  review_state?: 'saved' | 'approved' | 'rejected' | 'reopened' | null;
};

export function agentHomeTicket(tickets: TicketSummary[]) {
  return tickets.find((ticket) => ticket.status === 'open') ?? tickets[0];
}

export type HelpArticle = {
  id: number;
  title: string;
  body: string;
  retired: boolean;
};

export async function getHelpArticles(
  sessionId: string,
  ownerSession: string,
): Promise<HelpArticle[] | null> {
  const response = await fetch(
    `${process.env.API_URL ?? 'http://localhost:3001'}/help-articles`,
    {
      cache: 'no-store',
      headers: {
        cookie: `demo_session=${sessionId}; owner_session=${ownerSession}`,
      },
    },
  );
  if (response.status === 403) return null;
  if (!response.ok) throw new Error('Could not load help articles');
  return response.json();
}

export async function saveHelpArticle(
  sessionId: string,
  ownerSession: string,
  article: { id?: number; title: string; body: string; retired?: boolean },
) {
  const response = await fetch(
    `${process.env.API_URL ?? 'http://localhost:3001'}/help-articles${article.id ? `/${article.id}` : ''}`,
    {
      method: article.id ? 'PATCH' : 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `demo_session=${sessionId}; owner_session=${ownerSession}`,
      },
      body: JSON.stringify(article),
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('Could not save help article');
}

export type Ticket = TicketSummary & {
  decision?: {
    kind: 'automatic_reply' | 'hand_off';
    reason: string;
    rule?: string;
    topic?: string;
    suggested_priority?: string;
    documents?: { id: number; title: string; kind?: string }[];
    sources: { id: number; title: string; body: string }[];
    paused: boolean;
  };
  live_ai?: { remaining: number; paused: boolean };
  question: string;
  approved_reply: string | null;
  review_state: 'saved' | 'approved' | 'rejected' | 'reopened' | null;
  draft: null | {
    live?: boolean;
    state: 'saved' | 'approved' | 'rejected' | 'reopened';
    reply: string;
    suggested_priority: 'low' | 'normal' | 'high';
    sources: { id: number; title: string; body: string }[];
  };
  history: { id: number; description: string; created_at: string }[];
};

export async function getLiveAllowance(
  sessionId?: string,
): Promise<{ remaining: number; paused: boolean }> {
  const response = await fetch(
    `${process.env.API_URL ?? 'http://localhost:3001'}/live-ai`,
    {
      cache: 'no-store',
      headers: sessionId ? { cookie: `demo_session=${sessionId}` } : undefined,
    },
  );
  if (!response.ok) throw new Error('Could not load live AI allowance');
  return response.json();
}

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
  ownerSession?: string,
): Promise<Ticket | null> {
  const response = await fetch(
    `${process.env.API_URL ?? 'http://localhost:3001'}/tickets/${encodeURIComponent(id)}`,
    {
      cache: 'no-store',
      headers: sessionId
        ? {
            cookie: `demo_session=${sessionId}${ownerSession ? `; owner_session=${ownerSession}` : ''}`,
          }
        : undefined,
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
  ownerSession?: string,
) {
  const response = await fetch(
    `${process.env.API_URL ?? 'http://localhost:3001'}/tickets/${encodeURIComponent(id)}/review`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `demo_session=${sessionId}${ownerSession ? `; owner_session=${ownerSession}` : ''}`,
      },
      body: JSON.stringify({ action, reply, priority }),
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('Could not review the support request');
}

export async function loginOwner(password: string, sessionId: string) {
  const response = await fetch(
    `${process.env.API_URL ?? 'http://localhost:3001'}/owner/login`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `demo_session=${sessionId}`,
      },
      body: JSON.stringify({ password }),
      cache: 'no-store',
    },
  );
  if (response.status === 503) return 'unavailable';
  if (!response.ok) return 'invalid';
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith('owner_session='));
  return cookie?.split(';')[0].slice('owner_session='.length) ?? 'unavailable';
}

export async function generateTicket(
  id: string,
  sessionId: string,
  ownerSession?: string,
) {
  const response = await fetch(
    `${process.env.API_URL ?? 'http://localhost:3001'}/tickets/${encodeURIComponent(id)}/generate`,
    {
      method: 'POST',
      headers: {
        cookie: `demo_session=${sessionId}${ownerSession ? `; owner_session=${ownerSession}` : ''}`,
      },
      cache: 'no-store',
    },
  );
  return response.status;
}
