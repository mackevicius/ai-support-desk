'use client';

import { useActionState } from 'react';
import { writeVisitorArticle } from '../actions';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { SubmitButton } from './submit-button';

export function HelpArticleForm({ ticketId }: { ticketId: number }) {
  const [error, action] = useActionState(writeVisitorArticle, null);
  return (
    <form action={action} className="review-form">
      <input type="hidden" name="id" value={ticketId} />
      <label htmlFor="article-title">Title</label>
      <Input id="article-title" name="title" required maxLength={200} />
      <label htmlFor="article-body">Content</label>
      <Textarea
        id="article-body"
        name="body"
        required
        maxLength={5000}
        rows={5}
      />
      {error && <p role="alert">{error}</p>}
      <SubmitButton label="Save help article" pendingLabel="Saving..." />
    </form>
  );
}
