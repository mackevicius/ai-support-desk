'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '../../components/ui/button';

export function SubmitButton({
  label,
  pendingLabel,
  className,
  variant,
}: {
  label: string;
  pendingLabel: string;
  className?: string;
  variant?: 'default' | 'secondary';
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      className={className}
      variant={variant}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function ReviewButtons({
  showReject,
  showAsk = false,
}: {
  showReject: boolean;
  showAsk?: boolean;
}) {
  const { pending } = useFormStatus();
  const [active, setActive] = useState<'approve' | 'reject' | 'ask'>('approve');

  return (
    <div className="review-actions">
      <input type="hidden" name="action" value={active} />
      <Button
        type="submit"
        className="bg-foreground text-background hover:bg-foreground/90"
        onClick={() => setActive('approve')}
        disabled={pending}
        aria-busy={pending && active === 'approve'}
      >
        {pending && active === 'approve'
          ? 'Approving reply...'
          : 'Approve in-app reply'}
      </Button>
      {showAsk && (
        <Button
          type="submit"
          variant="secondary"
          onClick={() => setActive('ask')}
          disabled={pending}
          aria-busy={pending && active === 'ask'}
        >
          {pending && active === 'ask'
            ? 'Sending question...'
            : 'Ask for details'}
        </Button>
      )}
      {showReject && (
        <Button
          type="submit"
          formNoValidate
          variant="secondary"
          onClick={() => setActive('reject')}
          disabled={pending}
          aria-busy={pending && active === 'reject'}
        >
          {pending && active === 'reject'
            ? 'Rejecting suggestion...'
            : 'Reject suggestion'}
        </Button>
      )}
    </div>
  );
}
