import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = { title: 'Support inbox | Dayline', description: 'Browse fictional support requests in the Dayline workspace.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>
    <header className="topbar">
      <Link href="/" className="brand"><span className="brandmark">D</span><span>dayline <span className="brand-suffix">/ support</span></span></Link>
      <span className="topbar-label">Support workspace</span>
      <span className="demo-label">Demo inbox</span>
    </header>
    {children}
  </body></html>;
}