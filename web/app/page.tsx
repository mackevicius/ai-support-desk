import { cookies } from 'next/headers';
import { renderHome } from './views';

export default async function Home() {
  return renderHome((await cookies()).get('demo_session')?.value);
}
