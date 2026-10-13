'use client';

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

export function SendButton({
  hasInternalCopies,
  empty,
}: {
  hasInternalCopies: boolean;
  empty: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <div className="review-actions">
      <input type="hidden" name="action" value="reply" />
      <Button
        type="submit"
        className="bg-foreground text-background hover:bg-foreground/90"
        disabled={pending || empty}
        aria-busy={pending}
      >
        {pending ? 'Sending...' : hasInternalCopies ? 'Send anyway' : 'Send'}
      </Button>
    </div>
  );
}
