import Link from 'next/link';
import { signInOwner } from '../actions';
import { SubmitButton } from '../_components/submit-button';
import { Input } from '../../components/ui/input';
import { Card } from '../../components/ui/card';
import { Separator } from '../../components/ui/separator';

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
        <Separator className="my-6" />
        {error && <p role="alert">{error === 'invalid' ? 'Incorrect password.' : 'Owner sign-in is unavailable.'}</p>}
        <Card className="rounded-lg p-6">
          <form action={signInOwner} className="review-form">
            <label htmlFor="owner-password">Password</label>
            <Input id="owner-password" name="password" type="password" required autoComplete="current-password" />
            <SubmitButton label="Sign in" pendingLabel="Signing in..." />
          </form>
        </Card>
      </section>
    </main>
  );
}