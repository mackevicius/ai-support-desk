'use client';

import { useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { selectSeat } from '../actions';
import { Button } from '../../components/ui/button';

export function SeatSwitch({ seat }: { seat: 'customer' | 'agent' }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border border-input/60 p-0.75 text-[13px]"
      role="group"
      aria-label="Viewing as"
    >
      <span className="px-2 text-muted-foreground">Viewing as:</span>
      {(['customer', 'agent'] as const).map((option) => (
        <Button
          key={option}
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto rounded-full px-3 py-1.25 text-[13px] font-semibold aria-pressed:bg-primary aria-pressed:font-bold aria-pressed:text-primary-foreground"
          aria-pressed={seat === option}
          disabled={pending}
          onClick={() => {
            if (seat !== option)
              startTransition(() => selectSeat(option, pathname));
          }}
        >
          {option === 'customer' ? 'Customer' : 'Agent'}
        </Button>
      ))}
    </div>
  );
}
