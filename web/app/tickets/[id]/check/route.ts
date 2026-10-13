import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkReply } from '../../../data';

// A route handler, not a server action: background server actions get dropped by
// Next 15's router queue when a navigation starts, which strands later actions.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sessionId = (await cookies()).get('demo_session')?.value;
  const body = await request.json().catch(() => null);
  const reply = body?.reply;
  if (
    !sessionId ||
    !/^\d+$/.test(id) ||
    typeof reply !== 'string' ||
    reply.length > 5000
  )
    return NextResponse.json({ error: 'Invalid draft check' }, { status: 400 });
  try {
    return NextResponse.json(await checkReply(id, sessionId, reply));
  } catch {
    return NextResponse.json(
      { error: 'Could not check internal text' },
      { status: 502 },
    );
  }
}
