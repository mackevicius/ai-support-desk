'use client';

import { useActionState, useState } from 'react';
import { sendCustomerMessage } from '../actions';
import { Textarea } from '../../components/ui/textarea';
import { SubmitButton } from './submit-button';

export function CustomerComposer({ ticketId }: { ticketId: number }) {
  const [message, setMessage] = useState('');
  const [error, action, pending] = useActionState(async (_previous: string | null, formData: FormData) => {
    const result = await sendCustomerMessage(null, formData);
    if (!result) setMessage('');
    return result;
  }, null);
  return (
    <form action={action} className="customer-composer">
      <input type="hidden" name="id" value={ticketId} />
      <label htmlFor="customer-message" className="sr-only">Reply to Tunely</label>
      <div className="reply-row">
        <Textarea
          id="customer-message"
          name="message"
          required
          maxLength={5000}
          rows={2}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          readOnly={pending}
          placeholder="Reply to Tunely..."
          aria-describedby={error ? 'customer-message-error' : undefined}
        />
        <SubmitButton label="Send" pendingLabel="Sending..." />
      </div>
      {error && <p id="customer-message-error" role="alert">{error}</p>}
    </form>
  );
}