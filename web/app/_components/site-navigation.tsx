'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function SiteNavigation({ seat, owner }: { seat: 'customer' | 'agent'; owner: boolean }) {
  const pathname = usePathname();
  const current = pathname === '/' || pathname.startsWith('/tickets/')
    ? '/'
    : pathname.startsWith('/quality/') ? '/quality' : pathname;
  const tabs = [
    { href: '/', label: seat === 'customer' ? 'Support' : 'Inbox' },
    { href: '/how-it-works', label: 'How it works' },
    { href: '/quality', label: 'Answer quality' },
    ...(owner ? [{ href: '/articles', label: 'Articles' }] : []),
  ];
  return (
    <nav aria-label="Site">
      {tabs.map(({ href, label }) => (
        <Link key={href} href={href} aria-current={current === href ? 'page' : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}