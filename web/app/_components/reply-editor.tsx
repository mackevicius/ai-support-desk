'use client';

import { useActionState, useEffect, useState, type ReactNode } from 'react';
import { reviewCheckedRequest } from '../actions';
import type { InternalCopy } from '../data';
import { Textarea } from '../../components/ui/textarea';
import { SendButton } from './submit-button';

export function ReplyForm({
  ticketId,
  defaultValue,
  initialCopies,
  children,
}: {
  ticketId: string;
  defaultValue: string;
  initialCopies: InternalCopy[];
  children: ReactNode;
}) {
  const [state, action] = useActionState(reviewCheckedRequest, null);
  return (
    <form action={action} className="review-form">
      <input type="hidden" name="id" value={ticketId} />
      <ReplyEditor
        key={state ? JSON.stringify(state) : 'initial'}
        ticketId={ticketId}
        defaultValue={state?.reply ?? defaultValue}
        initialCopies={state?.copies ?? initialCopies}
        error={state?.error}
      >
        {children}
      </ReplyEditor>
    </form>
  );
}

function ReplyEditor({
  ticketId,
  defaultValue,
  initialCopies,
  error: submitError,
  children,
}: {
  ticketId: string;
  defaultValue: string;
  initialCopies: InternalCopy[];
  error?: string;
  children: ReactNode;
}) {
  const [reply, setReply] = useState(defaultValue);
  const [checked, setChecked] = useState({
    reply: defaultValue,
    copies: initialCopies,
  });
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/tickets/${encodeURIComponent(ticketId)}/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reply }),
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error('Draft check failed');
          return response.json() as Promise<InternalCopy[]>;
        })
        .then((result) => {
          if (controller.signal.aborted) return;
          setChecked({ reply, copies: result });
          setError(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(true);
        });
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [ticketId, reply]);

  const fragments = [];
  let position = 0;
  for (const copy of checked.copies) {
    fragments.push(checked.reply.slice(position, copy.start));
    fragments.push(
      <mark key={copy.start}>{checked.reply.slice(copy.start, copy.end)}</mark>,
    );
    position = copy.end;
  }
  fragments.push(checked.reply.slice(position));

  return (
    <>
      <label htmlFor="reply">AI draft · edit before sending</label>
      {!!checked.copies.length && (
        <div role="alert" className="internal-copy-warning">
          <strong>
            Internal text copied. This reply may expose staff-only information.
          </strong>
          <p>{fragments}</p>
          {/* Only confirms the highlighted text; the API rejects any other reply. */}
          <input type="hidden" name="internal_confirmed" value={checked.reply} />
        </div>
      )}
      {error && (
        <p role="alert">
          Internal text check is unavailable. Nothing has been sent.
        </p>
      )}
      <Textarea
        id="reply"
        name="reply"
        aria-label="Reply"
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        required
        maxLength={5000}
        rows={5}
      />
      {submitError && <p role="alert">{submitError}</p>}
      {children}
      <SendButton
        hasInternalCopies={checked.copies.length > 0}
        empty={!reply.trim()}
      />
    </>
  );
}
