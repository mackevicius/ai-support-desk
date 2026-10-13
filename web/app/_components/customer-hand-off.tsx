'use client';

import { useActionState } from 'react';
import { markConversationSolved, requestPerson } from '../actions';
import { SubmitButton } from './submit-button';

export function CustomerSolve({ ticketId }: { ticketId: number }) {
  const [error, action] = useActionState(markConversationSolved, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={ticketId} />
      <SubmitButton
        label="Solved"
        pendingLabel="Solving..."
        className="min-w-28"
      />
      {error && <p role="alert" className="mt-2 text-sm">{error}</p>}
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
      {error && <p role="alert" className="mt-2 text-sm">{error}</p>}
    </form>
  );
}