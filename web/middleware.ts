import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  if (request.cookies.get('demo_session')?.value?.match(/^[0-9a-f-]{36}$/)) {
    return NextResponse.next();
  }
  const sessionId = crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set('cookie', `demo_session=${sessionId}`);
  const response = NextResponse.next({ request: { headers } });
  response.cookies.set('demo_session', sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60,
  });
  return response;
}

export const config = { matcher: ['/((?!_next|favicon.ico).*)'] };