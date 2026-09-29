import Link from 'next/link';

export default function HowItWorks() {
  return (
    <main className="workspace">
      <div className="detail">
        <Link href="/" className="back">Back to inbox</Link>
        <h1>How it works</h1>
        <p className="mt-6 text-muted">More about this portfolio demo is coming soon.</p>
      </div>
    </main>
  );
}