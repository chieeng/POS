import { createClient } from '@supabase/supabase-js';
import { HttpError } from './errors.ts';
import { parseInput, requireOwner } from './guard.ts';
import { HANDLERS } from './handlers.ts';
import { requestSchema } from './schemas.ts';

// Owner-only user administration (AUTH-02..04, SEC-01, SEC-04, SEC-13).
//
// This is the only place the service role key is used (SEC-10). It is read from the
// function's own environment, never sent to a client and never logged.

// Callers authenticate with a bearer token, not cookies, so any origin may ask; the guard
// decides who gets an answer.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) throw new Error('The function environment is not configured.');
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** The set-password screen of the app that made the call, if it sent an origin. */
function setPasswordUrl(request: Request): string | undefined {
  const origin = request.headers.get('Origin');
  // Supabase Auth only honours this if it is in the project's redirect allow-list;
  // otherwise the link falls back to the site URL.
  return origin && /^https?:\/\/[^/]+$/.test(origin) ? `${origin}/set-password` : undefined;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    if (request.method !== 'POST') throw new HttpError('invalid-argument', 'Invalid input.');

    const admin = adminClient();
    const owner = await requireOwner(request, admin);

    const body = await request.json().catch(() => undefined);
    const { action, input } = parseInput(requestSchema, body);
    const result = await HANDLERS[action](
      { admin, owner, setPasswordUrl: setPasswordUrl(request) },
      input,
    );
    return json(200, result);
  } catch (error) {
    if (error instanceof HttpError) {
      return json(error.status, {
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    console.error('admin-users: unexpected error', error instanceof Error ? error.message : '');
    return json(500, { error: { code: 'internal', message: 'Something went wrong. Try again.' } });
  }
});
