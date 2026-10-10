import { supabase } from './supabase';

const TAG_KEY = 'pos.deviceTag';
// No 0/O or 1/I/L, so a tag read aloud or off a slip is unambiguous.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TAG_PATTERN = /^[A-Z0-9]{4}$/;

export function generateDeviceTag(random: (max: number) => number = secureRandom): string {
  return Array.from({ length: 4 }, () => ALPHABET.charAt(random(ALPHABET.length))).join('');
}

function secureRandom(max: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] ?? 0) % max;
}

/**
 * SYS-02: this device's short tag, created on first use and kept in the browser. It labels
 * receipts and audit entries; it is not a secret and is never used to grant access.
 */
export function getDeviceTag(): string {
  try {
    const stored = localStorage.getItem(TAG_KEY);
    if (stored && TAG_PATTERN.test(stored)) return stored;
    const tag = generateDeviceTag();
    localStorage.setItem(TAG_KEY, tag);
    return tag;
  } catch {
    // Storage blocked: a per-page-load tag is the best available.
    return (fallbackTag ??= generateDeviceTag());
  }
}
let fallbackTag: string | undefined;

/** A short human label such as "Android phone · Chrome", for the Owner's device list. */
export function describeDevice(userAgent: string): string {
  const ua = userAgent;
  const device = /iPad|Tablet|(Android(?!.*Mobile))/.test(ua)
    ? /iPad/.test(ua)
      ? 'iPad'
      : 'Android tablet'
    : /iPhone/.test(ua)
      ? 'iPhone'
      : /Android/.test(ua)
        ? 'Android phone'
        : /Windows/.test(ua)
          ? 'Windows PC'
          : /Macintosh|Mac OS X/.test(ua)
            ? 'Mac'
            : /Linux|CrOS/.test(ua)
              ? 'Laptop'
              : 'Device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  return `${device} · ${browser}`;
}

/**
 * Records this device under the signed-in user (SYS-02). The server stamps the time it was
 * last seen; Row Level Security lets a user write only their own rows.
 */
export async function registerDevice(user: { uid: string }): Promise<void> {
  const { error } = await supabase.from('devices').upsert(
    {
      user_id: user.uid,
      device_tag: getDeviceTag(),
      label: describeDevice(navigator.userAgent).slice(0, 60),
    },
    { onConflict: 'user_id,device_tag' },
  );
  if (error) throw error;
}
