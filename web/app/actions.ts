'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resetDemo, reviewTicket, submitQuestion } from './data';

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
    !['approve', 'reject', 'reopen'].includes(action) ||
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
  );
  redirect(`/tickets/${id}`);
}
