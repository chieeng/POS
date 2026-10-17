// SEC-05: Supabase's leaked-password protection needs a paid plan, so the app checks a new
// password against Have I Been Pwned's Pwned Passwords range API itself (k-anonymity).
// Only the first 5 characters of the password's SHA-1 hash leave the device; the matching is
// done here. The response is padded with dummy entries so its size reveals nothing.
const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 5_000;

export type PwnedResult = 'breached' | 'not-found' | 'unknown';

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Whether the password appears in a known data breach. 'unknown' when the service cannot be
 * reached or answers oddly: the caller then lets the password through, as the 10-character
 * minimum still applies and a third-party outage must not stop anyone setting up an account.
 */
export async function checkPwnedPassword(password: string): Promise<PwnedResult> {
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const response = await fetch(RANGE_URL + prefix, {
      headers: { 'Add-Padding': 'true' },
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return 'unknown';
    const body = await response.text();
    for (const line of body.split(/\r?\n/)) {
      const [lineSuffix, count] = line.trim().split(':');
      // Padding entries have a count of 0.
      if (lineSuffix?.toUpperCase() === suffix && Number(count) > 0) return 'breached';
    }
    return 'not-found';
  } catch {
    return 'unknown';
  }
}
