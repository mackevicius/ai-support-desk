'use client';

import { useActionState } from 'react';
import { markConversationSolved, requestPerson } from '../actions';
import { SubmitButton } from './submit-button';

export function CustomerSolve({ ticketId }: { ticketId: number }) {
  const [error, action] = useActionState(markConversationSolved, null);
  return (
    <form action={action} className="solve-prompt">
      <input type="hidden" name="id" value={ticketId} />
      <span>Did this fix it?</span>
      <SubmitButton label="Solved" pendingLabel="Solving..." />
      {error && (
        <p role="alert" className="basis-full text-sm">
          {error}
        </p>
      )}
    </form>
  );
}

export function CustomerHandOff({ ticketId }: { ticketId: number }) {
  const [error, action] = useActionState(requestPerson, null);
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="id" value={ticketId} />
      <SubmitButton
        label="Didn't help? Talk to a person"
        pendingLabel="Handing off..."
        variant="secondary"
        className="h-auto min-h-9 whitespace-normal text-left"
      />
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
