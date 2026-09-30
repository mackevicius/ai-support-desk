'use client';

import { useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { selectSeat } from '../actions';
import { Button } from '../../components/ui/button';

export function SeatSwitch({ seat }: { seat: 'customer' | 'agent' }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <div className="seat-switch" role="group" aria-label="Viewing as">
      <span>Viewing as:</span>
      {(['customer', 'agent'] as const).map((option) => (
        <Button
          key={option}
          type="button"
          variant="secondary"
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
