import { NextResponse } from 'next/server';

function splitUrls(raw: string): string[] {
  return (raw || '')
    .split(/[,\s]+/g)
    .map(s => s.trim())
    .filter(Boolean);
}

export async function GET() {
  // Prefer non-public envs if present (but fall back to NEXT_PUBLIC_ so existing Vercel setup works)
  const urlsRawPrivate = process.env.TURN_URLS || '';
  const urlsRawPublic = process.env.NEXT_PUBLIC_TURN_URLS || '';
  const usernamePrivate = process.env.TURN_USERNAME || '';
  const usernamePublic = process.env.NEXT_PUBLIC_TURN_USERNAME || '';
  const credentialPrivate = process.env.TURN_CREDENTIAL || '';
  const credentialPublic = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '';

  const urlsRaw = urlsRawPrivate || urlsRawPublic || '';
  const username = usernamePrivate || usernamePublic || '';
  const credential = credentialPrivate || credentialPublic || '';

  const urls = splitUrls(urlsRaw);
  const enabled = urls.length > 0 && Boolean(username) && Boolean(credential);

  // This endpoint is meant to be consumed by the client, so these values are effectively public.
  // Still, we avoid logging them and we mark the response as no-store.
  return NextResponse.json(
    {
      enabled,
      urls,
      username: enabled ? username : '',
      credential: enabled ? credential : '',
      // Diagnostics (safe to expose; does not include secrets)
      diagnostics: {
        seen: {
          TURN_URLS: Boolean(urlsRawPrivate),
          NEXT_PUBLIC_TURN_URLS: Boolean(urlsRawPublic),
          TURN_USERNAME: Boolean(usernamePrivate),
          NEXT_PUBLIC_TURN_USERNAME: Boolean(usernamePublic),
          TURN_CREDENTIAL: Boolean(credentialPrivate),
          NEXT_PUBLIC_TURN_CREDENTIAL: Boolean(credentialPublic),
        },
        lengths: {
          TURN_URLS: urlsRawPrivate.length,
          NEXT_PUBLIC_TURN_URLS: urlsRawPublic.length,
        },
        parsedUrlsCount: urls.length,
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  );
}


