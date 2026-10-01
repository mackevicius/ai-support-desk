'use client';

import { useActionState, useEffect, useState, type ReactNode } from 'react';
import { checkDraft, reviewCheckedRequest } from '../actions';
import type { InternalCopy } from '../data';
import { Textarea } from '../../components/ui/textarea';

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
      />
      {state?.error && <p role="alert">{state.error}</p>}
      {children}
    </form>
  );
}

function ReplyEditor({
  ticketId,
  defaultValue,
  initialCopies,
}: {
  ticketId: string;
  defaultValue: string;
  initialCopies: InternalCopy[];
}) {
  const [reply, setReply] = useState(defaultValue);
  const [copies, setCopies] = useState(initialCopies);
  const [error, setError] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      checkDraft(ticketId, reply)
        .then((result) => {
          if (active) {
            setCopies(result);
            setError(false);
          }
        })
        .catch(() => {
          if (active) setError(true);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [ticketId, reply]);

  const fragments = [];
  let position = 0;
  for (const copy of copies) {
    fragments.push(reply.slice(position, copy.start));
    fragments.push(
      <mark key={copy.start}>{reply.slice(copy.start, copy.end)}</mark>,
    );
    position = copy.end;
  }
  fragments.push(reply.slice(position));

  return (
    <>
      <label htmlFor="reply">Reply</label>
      <Textarea
        id="reply"
        name="reply"
        value={reply}
        onChange={(event) => {
          setReply(event.target.value);
          setConfirmed(false);
        }}
        required
        maxLength={5000}
        rows={5}
      />
      {!!copies.length && (
        <div role="alert" className="internal-copy-warning">
          <strong>
            Internal text copied. This reply may expose staff-only information.
          </strong>
          <p>{fragments}</p>
          <label>
            <input
              type="checkbox"
              name="internal_confirmed"
              value={reply}
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{' '}
            Approve despite copied internal text
          </label>
        </div>
      )}
      {error && (
        <p role="alert">
          Internal text check is unavailable. Approval has not been sent.
        </p>
      )}
    </>
  );
}
