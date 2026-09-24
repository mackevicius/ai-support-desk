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
  history: { id: number; description: string; created_at: string }[];
};

export async function getTickets(): Promise<TicketSummary[]> {
  const response = await fetch(`${process.env.API_URL ?? 'http://localhost:3001'}/tickets`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load the support inbox');
  return response.json();
}

export async function getTicket(id: string): Promise<Ticket | null> {
  const response = await fetch(`${process.env.API_URL ?? 'http://localhost:3001'}/tickets/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Could not load the support request');
  return response.json();
}