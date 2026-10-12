import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLiveAllowance, getTickets } from '../../data';
import { SupportChat } from '../../_components/support-chat';

export default async function NewConversationPage() {
  const jar = await cookies();
  if (jar.get('demo_seat')?.value === 'agent') redirect('/');
  const sessionId = jar.get('demo_session')?.value;
  const [tickets, allowance] = await Promise.all([
    getTickets(sessionId),
    getLiveAllowance(sessionId),
  ]);
  return (
    <main className="workspace customer-ticket">
      <SupportChat tickets={tickets} allowance={allowance} />
    </main>
  );
}