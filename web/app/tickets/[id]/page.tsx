import { cookies } from 'next/headers';
import { renderTicketPage } from '../../views';

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return renderTicketPage(id, (await cookies()).get('demo_session')?.value);
}
