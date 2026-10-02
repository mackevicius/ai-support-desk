import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { signOutOwner } from './actions';
import { getLiveAllowance } from './data';
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
  const allowance = await getLiveAllowance(
    cookieStore.get('demo_session')?.value,
  ).catch(() => null);
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body data-seat={seat} className={seat}>
        <nav className="demo-strip" aria-label="Portfolio">
          Portfolio demo · Tunely is a fictional company ·{' '}
          <Link href="/how-it-works">How it works →</Link> ·{' '}
          <Link href="/quality">Answer quality</Link>
        </nav>
        <header className="topbar">
          <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/" className="brand">
              <span
                aria-hidden="true"
                className="grid size-6.5 place-items-center rounded-full bg-primary after:h-2.5 after:w-3 after:bg-[repeating-linear-gradient(90deg,#000_0_2px,transparent_2px_4px)] after:opacity-75 after:content-['']"
              />
              Tunely <span className="brand-suffix">· music streaming</span>
            </Link>
            {allowance && (
              <span className="live-count">
                {allowance.remaining} live drafts left
              </span>
            )}
          </div>
          <nav aria-label="Site">
            <Link href="/how-it-works">How it works</Link>
            <Link href="/quality">Quality</Link>
            {owner && <Link href="/articles">Articles</Link>}
            {owner ? (
              <form action={signOutOwner}>
                <Button variant="ghost" size="sm" className="owner-link">
                  Sign out
                </Button>
              </form>
            ) : (
              <Link href="/owner" className="owner-link">Owner sign in</Link>
            )}
          </nav>
          <SeatSwitch seat={seat} />
        </header>
        {children}
      </body>
    </html>
  );
}
