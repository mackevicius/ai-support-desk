import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { signOutOwner } from './actions';
import { SeatSwitch } from './_components/seat-switch';
import { Button } from '../components/ui/button';
import './globals.css';

export const metadata: Metadata = {
  title: 'Support inbox | Tunely · music streaming',
  description: 'Browse support requests in the Tunely music streaming workspace.',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const owner = Boolean(cookieStore.get('owner_session')?.value);
  const seat = cookieStore.get('demo_seat')?.value === 'agent' ? 'agent' : 'customer';
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body data-seat={seat} className={seat}>
        <nav className="demo-strip" aria-label="Portfolio">Portfolio demo · <Link href="/how-it-works">How it works</Link> · <Link href="/quality">Answer quality</Link></nav>
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brandmark">T</span>
            <span>
              Tunely <span className="brand-suffix">· music streaming</span>
            </span>
          </Link>
          <SeatSwitch seat={seat} />
          {owner ? (
            <>
              <Link href="/articles" className="owner-link">Help articles</Link>
              <form action={signOutOwner}><Button variant="secondary" className="owner-link">Sign out</Button></form>
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
