'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  agentHomeTicket,
  checkReply,
  type InternalCopy,
  generateTicket,
  getTickets,
  loginOwner,
  resetDemo,
  reviewTicket,
  saveHelpArticle,
  saveVisitorHelpArticle,
  submitQuestion,
} from './data';

export async function selectSeat(seat: 'customer' | 'agent', pathname: string) {
  if (seat !== 'customer' && seat !== 'agent') throw new Error('Invalid seat');
  const jar = await cookies();
  jar.set('demo_seat', seat, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  if (/^\/tickets\/\d+$/.test(pathname)) redirect(pathname);
  if (seat === 'agent') {
    const tickets = await getTickets(jar.get('demo_session')?.value);
    const selected = agentHomeTicket(tickets);
    if (selected) redirect(`/tickets/${selected.id}`);
  }
  redirect('/');
}

export async function signInOwner(formData: FormData) {
  const password = formData.get('password');
  const sessionId = (await cookies()).get('demo_session')?.value;
  if (typeof password !== 'string' || !sessionId)
    throw new Error('Invalid sign-in request');
  const result = await loginOwner(password, sessionId);
  if (result === 'invalid' || result === 'unavailable')
    redirect(`/owner?error=${result}`);
  (await cookies()).set('owner_session', result, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60,
  });
  redirect('/');
}

export async function signOutOwner() {
  (await cookies()).delete('owner_session');
  redirect('/');
}

export async function generateRequest(formData: FormData) {
  const id = formData.get('id');
  const jar = await cookies();
  const sessionId = jar.get('demo_session')?.value;
  const ownerSession = jar.get('owner_session')?.value;
  if (typeof id !== 'string' || !/^\d+$/.test(id) || !sessionId)
    throw new Error('Invalid generation request');
  const status = await generateTicket(id, sessionId, ownerSession);
  revalidatePath('/', 'layout');
  if (status !== 200)
    redirect(
      `/tickets/${id}?generation=${status === 429 ? 'limit' : 'unavailable'}`,
    );
  redirect(`/tickets/${id}`);
}

export async function saveArticle(formData: FormData) {
  const jar = await cookies();
  const sessionId = jar.get('demo_session')?.value;
  const ownerSession = jar.get('owner_session')?.value;
  const id = formData.get('id');
  const title = formData.get('title');
  const body = formData.get('body');
  const kind = formData.get('kind') ?? 'help_article';
  if (
    !sessionId ||
    !ownerSession ||
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > 200 ||
    typeof body !== 'string' ||
    !body.trim() ||
    body.length > 5000 ||
    (kind !== 'help_article' && kind !== 'internal_note') ||
    (id !== null && (typeof id !== 'string' || !/^\d+$/.test(id)))
  ) {
    throw new Error('Invalid help article');
  }
  await saveHelpArticle(sessionId, ownerSession, {
    ...(id === null
      ? {}
      : { id: Number(id), retired: formData.get('retired') === 'on' }),
    title,
    body,
    kind,
  });
  redirect('/articles');
}

export async function writeVisitorArticle(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const jar = await cookies();
  const sessionId = jar.get('demo_session')?.value;
  const id = formData.get('id');
  const title = formData.get('title');
  const body = formData.get('body');
  if (!sessionId || jar.get('demo_seat')?.value !== 'agent')
    return 'Only the Agent seat can write help articles.';
  if (
    typeof id !== 'string' ||
    !/^\d+$/.test(id) ||
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > 200 ||
    typeof body !== 'string' ||
    !body.trim() ||
    body.length > 5000
  ) {
    return 'Enter a title up to 200 characters and content up to 5000 characters.';
  }
  const error = await saveVisitorHelpArticle(sessionId, { title, body });
  if (error) return error;
  redirect(`/tickets/${id}?article=saved`);
}

export async function checkDraft(id: string, reply: string) {
  const sessionId = (await cookies()).get('demo_session')?.value;
  if (
    !sessionId ||
    !/^\d+$/.test(id) ||
    typeof reply !== 'string' ||
    reply.length > 5000
  )
    throw new Error('Invalid draft check');
  return checkReply(id, sessionId, reply);
}

export type DraftReviewState = {
  reply: string;
  copies: InternalCopy[];
  error?: string;
} | null;

export async function reviewCheckedRequest(
  _previous: DraftReviewState,
  formData: FormData,
): Promise<DraftReviewState> {
  return performReview(formData);
}

export async function resetWorkspace() {
  const sessionId = (await cookies()).get('demo_session')?.value;
  if (!sessionId) throw new Error('No visitor session');
  await resetDemo(sessionId);
  revalidatePath('/', 'layout');
  redirect('/');
}

export async function submitRequest(formData: FormData) {
  const question = formData.get('question');
  if (
    typeof question !== 'string' ||
    !question.trim() ||
    question.length > 5000
  ) {
    throw new Error('Enter a question of up to 5000 characters.');
  }
  const sessionId = (await cookies()).get('demo_session')?.value;
  if (!sessionId) throw new Error('No visitor session');
  const id = await submitQuestion(question, sessionId);
  revalidatePath('/', 'layout');
  redirect(`/tickets/${id}`);
}

export async function reviewRequest(formData: FormData) {
  await performReview(formData);
}

async function performReview(formData: FormData): Promise<DraftReviewState> {
  const id = formData.get('id');
  const action = formData.get('action');
  const sessionId = (await cookies()).get('demo_session')?.value;
  if (
    typeof id !== 'string' ||
    !/^\d+$/.test(id) ||
    typeof action !== 'string' ||
    !['approve', 'reject', 'reopen', 'priority', 'ask'].includes(action) ||
    !sessionId
  ) {
    throw new Error('Invalid review request');
  }
  const copies = await reviewTicket(
    id,
    sessionId,
    action,
    formData.get('reply')?.toString(),
    formData.get('priority')?.toString(),
    (await cookies()).get('owner_session')?.value,
    formData.get('internal_confirmed')?.toString(),
  );
  if (copies) return { reply: formData.get('reply')?.toString() ?? '', copies };
  if (
    action === 'approve' &&
    (await cookies()).get('demo_seat')?.value === 'agent'
  ) {
    const next = (await getTickets(sessionId)).find(
      (ticket) => ticket.status === 'open',
    );
    redirect(next ? `/tickets/${next.id}` : '/');
  }
  redirect(`/tickets/${id}`);
}
