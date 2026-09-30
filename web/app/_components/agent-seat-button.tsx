'use client';

import { useRouter } from 'next/navigation';
import { Button } from '../../components/ui/button';

export function AgentSeatButton() {
  const router = useRouter();
  return <Button variant="secondary" onClick={() => {
    document.cookie = 'demo_seat=agent; Path=/; SameSite=Lax';
    router.push('/');
    router.refresh();
  }}>Switch to Agent seat</Button>;
}