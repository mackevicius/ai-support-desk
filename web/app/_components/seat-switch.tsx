'use client';

import { useRouter } from 'next/navigation';
import { Button } from '../../components/ui/button';

export function SeatSwitch({ seat }: { seat: 'customer' | 'agent' }) {
  const router = useRouter();

  function selectSeat(nextSeat: 'customer' | 'agent') {
    document.cookie = `demo_seat=${nextSeat}; Path=/; SameSite=Lax`;
    router.push('/');
    router.refresh();
  }

  return (
    <div className="seat-switch" role="group" aria-label="Viewing as">
      <span>Viewing as:</span>
      {(['customer', 'agent'] as const).map((option) => (
        <Button
          key={option}
          type="button"
          variant="secondary"
          aria-pressed={seat === option}
          onClick={() => selectSeat(option)}
        >
          {option === 'customer' ? 'Customer' : 'Agent'}
        </Button>
      ))}
    </div>
  );
}
