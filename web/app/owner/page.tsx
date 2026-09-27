import Link from 'next/link';
import { signInOwner } from '../actions';
import { SubmitButton } from '../_components/submit-button';

export default async function OwnerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="workspace focus-view">
      <section className="detail owner-form">
        <Link href="/" className="back">Back to inbox</Link>
        <h1>Owner sign in</h1>
        {error && <p role="alert">{error === 'invalid' ? 'Incorrect password.' : 'Owner sign-in is unavailable.'}</p>}
        <form action={signInOwner} className="review-form">
          <label htmlFor="owner-password">Password</label>
          <input id="owner-password" name="password" type="password" required autoComplete="current-password" />
          <SubmitButton label="Sign in" pendingLabel="Signing in..." />
        </form>
      </section>
    </main>
  );
}