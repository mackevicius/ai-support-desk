import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { signOutOwner } from './actions';
import './styles.css';

export const metadata: Metadata = {
  title: 'Support inbox | Dayline',
  description: 'Browse fictional support requests in the Dayline workspace.',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const owner = Boolean((await cookies()).get('owner_session')?.value);
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brandmark">D</span>
            <span>
              dayline <span className="brand-suffix">/ support</span>
            </span>
          </Link>
          <span className="topbar-label">Support workspace</span>
          <span className="demo-label">Demo inbox</span>
          {owner ? (
            <>
              <Link href="/articles" className="owner-link">Help articles</Link>
              <form action={signOutOwner}><button className="owner-link">Sign out</button></form>
            </>
          ) : (
            <Link href="/owner" className="owner-link">Owner sign in</Link>
          )}
        </header>
        {children}
      </body>
    </html>
  );
}
