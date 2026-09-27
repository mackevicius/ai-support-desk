'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';

export function SubmitButton({
  label,
  pendingLabel,
  className,
}: {
  label: string;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function ReviewButtons({ showReject }: { showReject: boolean }) {
  const { pending } = useFormStatus();
  const [active, setActive] = useState<'approve' | 'reject'>('approve');

  return (
    <>
      <input type="hidden" name="action" value={active} />
      <button
        type="submit"
        onClick={() => setActive('approve')}
        disabled={pending}
        aria-busy={pending && active === 'approve'}
      >
        {pending && active === 'approve' ? 'Approving reply...' : 'Approve in-app reply'}
      </button>
      {showReject && (
        <button
          type="submit"
          formNoValidate
          className="secondary"
          onClick={() => setActive('reject')}
          disabled={pending}
          aria-busy={pending && active === 'reject'}
        >
          {pending && active === 'reject' ? 'Rejecting suggestion...' : 'Reject suggestion'}
        </button>
      )}
    </>
  );
}