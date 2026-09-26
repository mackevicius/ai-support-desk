'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { submitQuestion } from './data';

export async function submitRequest(formData: FormData) {
  const question = formData.get('question');
  if (typeof question !== 'string' || !question.trim() || question.length > 5000) {
    throw new Error('Enter a question of up to 5000 characters.');
  }
  const sessionId = (await cookies()).get('demo_session')?.value;
  if (!sessionId) throw new Error('No visitor session');
  const id = await submitQuestion(question, sessionId);
  redirect(`/tickets/${id}`);
}