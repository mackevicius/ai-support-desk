'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { generateTicket, loginOwner, resetDemo, reviewTicket, saveHelpArticle, submitQuestion } from './data';

export async function signInOwner(formData: FormData) {
  const password = formData.get('password');
  const sessionId = (await cookies()).get('demo_session')?.value;
  if (typeof password !== 'string' || !sessionId) throw new Error('Invalid sign-in request');
  const result = await loginOwner(password, sessionId);
  if (result === 'invalid' || result === 'unavailable') redirect(`/owner?error=${result}`);
  (await cookies()).set('owner_session', result, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60,
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
  if (typeof id !== 'string' || !/^\d+$/.test(id) || !sessionId || !ownerSession)
    throw new Error('Owner sign-in required');
  const status = await generateTicket(id, sessionId, ownerSession);
  if (status !== 200) redirect(`/tickets/${id}?generation=${status === 429 ? 'limit' : 'unavailable'}`);
  redirect(`/tickets/${id}`);
}

export async function saveArticle(formData: FormData) {
  const jar = await cookies();
  const sessionId = jar.get('demo_session')?.value;
  const ownerSession = jar.get('owner_session')?.value;
  const id = formData.get('id');
  const title = formData.get('title');
  const body = formData.get('body');
  if (!sessionId || !ownerSession || typeof title !== 'string' || !title.trim() || title.length > 200 ||
      typeof body !== 'string' || !body.trim() || body.length > 5000 ||
      (id !== null && (typeof id !== 'string' || !/^\d+$/.test(id)))) {
    throw new Error('Invalid help article');
  }
  await saveHelpArticle(sessionId, ownerSession, {
    ...(id === null ? {} : { id: Number(id), retired: formData.get('retired') === 'on' }),
    title, body,
  });
  redirect('/articles');
}

export async function resetWorkspace() {
  const sessionId = (await cookies()).get('demo_session')?.value;
  if (!sessionId) throw new Error('No visitor session');
  await resetDemo(sessionId);
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
  redirect(`/tickets/${id}`);
}

export async function reviewRequest(formData: FormData) {
  const id = formData.get('id');
  const action = formData.get('action');
  const sessionId = (await cookies()).get('demo_session')?.value;
  if (
    typeof id !== 'string' ||
    !/^\d+$/.test(id) ||
    typeof action !== 'string' ||
    !['approve', 'reject', 'reopen', 'priority'].includes(action) ||
    !sessionId
  ) {
    throw new Error('Invalid review request');
  }
  await reviewTicket(
    id,
    sessionId,
    action,
    formData.get('reply')?.toString(),
    formData.get('priority')?.toString(),
    (await cookies()).get('owner_session')?.value,
  );
  redirect(`/tickets/${id}`);
}
