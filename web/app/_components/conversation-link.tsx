'use client';

import type { ReactNode } from 'react';
import Link, { useLinkStatus } from 'next/link';

export function ConversationLink({
  href,
  current,
  className,
  children,
  label,
}: {
  href: string;
  current: boolean;
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <Link href={href} prefetch={false} aria-current={current ? 'page' : undefined} className={className} aria-label={label}>
      <ConversationLinkContent>{children}</ConversationLinkContent>
    </Link>
  );
}

function ConversationLinkContent({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span className="conversation-link-content" aria-busy={pending}>
      {children}
      {pending && <span role="status" className="conversation-loading">Loading conversation...</span>}
    </span>
  );
}