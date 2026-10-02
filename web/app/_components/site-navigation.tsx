'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

export function SiteNavigation({ seat, owner, children }: { seat: 'customer' | 'agent'; owner: boolean; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Site">
      {seat === 'customer' && !owner && pathname === '/' ? (
        <><span>Premium</span><span>Family</span><span>Download</span><strong className="text-primary">Support</strong></>
      ) : children}
    </nav>
  );
}