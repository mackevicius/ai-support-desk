'use client';

import React, { startTransition, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const RETRY_DELAY_MS = 5_000;
const MAX_ATTEMPTS = 24;
// Module scope so the count survives the boundary remounting after each failed retry.
let attempts = 0;

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(attempts);

  const retry = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  useEffect(() => {
    if (attempt >= MAX_ATTEMPTS) return;
    const timer = setTimeout(() => {
      attempts = attempt + 1;
      setAttempt(attempts);
      retry();
    }, RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [attempt]);

  const gaveUp = attempt >= MAX_ATTEMPTS;

  return (
    <main className="workspace">
      <span className="eyebrow">Service unavailable</span>
      <h1>
        {gaveUp
          ? 'The support service is not responding'
          : 'Waking up the support service'}
      </h1>
      <p role="status">
        {gaveUp
          ? 'Please try again in a moment.'
          : 'It sleeps when idle and can take up to a minute to start. Retrying automatically…'}
      </p>
      {gaveUp && (
        <button
          className="reset-button"
          onClick={() => {
            attempts = 0;
            setAttempt(0);
            retry();
          }}
        >
          Try again
        </button>
      )}
    </main>
  );
}
