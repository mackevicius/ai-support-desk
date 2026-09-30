'use client';

import { useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { selectSeat } from '../actions';
import { Button } from '../../components/ui/button';

export function AgentSeatButton() {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() => startTransition(() => selectSeat('agent', pathname))}
    >
      Switch to Agent seat
    </Button>
  );
}
