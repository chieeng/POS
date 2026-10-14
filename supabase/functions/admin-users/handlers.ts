import type { SupabaseClient } from '@supabase/supabase-js';
import { fromDatabase, HttpError } from './errors.ts';
import { parseInput, type OwnerContext } from './guard.ts';
import {
  createUserSchema,
  deactivateUserSchema,
  setUserRoleSchema,
  updateUserSchema,
  userIdSchema,
  type Action,
} from './schemas.ts';

export interface ActionContext {
  admin: SupabaseClient;
  owner: OwnerContext;
  /** Where one-time password links send the user: the app's set-password screen. */
  setPasswordUrl: string | undefined;
}

type Handler = (context: ActionContext, input: unknown) => Promise<Record<string, unknown>>;

// A deactivated account stays banned: 100 years.
const BAN_FOREVER = '876000h';

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * A one-time link that lets its holder set the account's password. Never stored or logged.
 *
 * It points at the app's set-password screen, with the token in the part after "#", which
 * browsers never send to a server. Opening the link only loads the page: the token is used
 * when the person presses Continue. So a link preview in a chat app, an email scanner or a
 * second tab cannot use it up. Making a new link cancels the previous one.
 */
async function passwordLink({ admin, setPasswordUrl }: ActionContext, email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash || !setPasswordUrl) {
    console.error('admin-users: could not make a password link', error?.code ?? 'no link');
    throw new HttpError('internal', 'Could not make the password link. Try again.');
  }
  return `${setPasswordUrl}#token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
}

/**
 * AUTH-02, SEC-01: the only way an account is ever created. The new user gets a random
 * password nobody knows and sets their own through the one-time link returned to the Owner.
 */
const create: Handler = async (context, raw) => {
  const { admin, owner } = context;
  const input = parseInput(createUserSchema, raw);

  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: randomPassword(),
    // The Owner vouches for the address; there is no self-service confirmation step.
    email_confirm: true,
  });
  if (error || !data.user) {
    if (error?.code === 'email_exists' || error?.code === 'user_already_exists') {
      throw new HttpError('already-exists', 'An account with this email already exists.');
    }
    console.error('admin-users: createUser failed', error?.code ?? 'no user');
    throw new HttpError('internal', 'Something went wrong. Try again.');
  }
  const uid = data.user.id;

  const { error: profileError } = await admin.rpc('admin_create_profile', {
    p_actor: owner.uid,
    p_user_id: uid,
    p_email: input.email,
    p_display_name: input.displayName,
    p_role: input.role,
    p_user_code: input.userCode,
    p_device_tag: input.deviceTag ?? null,
  });
  if (profileError) {
    // Do not leave a half-made account behind.
    await admin.auth.admin.deleteUser(uid).catch(() => undefined);
    throw fromDatabase(profileError);
  }

  return { uid, resetLink: await passwordLink(context, input.email) };
};

/** AUTH-02: the Owner edits a user's name and user code. */
const update: Handler = async ({ admin, owner }, raw) => {
  const input = parseInput(updateUserSchema, raw);
  const { data, error } = await admin.rpc('admin_update_profile', {
    p_actor: owner.uid,
    p_user_id: input.uid,
    p_display_name: input.displayName ?? null,
    p_user_code: input.userCode ?? null,
    p_device_tag: input.deviceTag ?? null,
  });
  if (error) throw fromDatabase(error);
  return { uid: input.uid, ...((data as Record<string, unknown> | null) ?? {}) };
};

/** AUTH-03: the role is changed only here, by the Owner. */
const setRole: Handler = async ({ admin, owner }, raw) => {
  const input = parseInput(setUserRoleSchema, raw);
  const { error } = await admin.rpc('admin_set_role', {
    p_actor: owner.uid,
    p_user_id: input.uid,
    p_role: input.role,
    p_device_tag: input.deviceTag ?? null,
  });
  if (error) throw fromDatabase(error, 'change the role of');
  return { uid: input.uid, role: input.role };
};

/** SEC-04: active = false, every session ended and the Auth user banned, in one call. */
const deactivate: Handler = async ({ admin, owner }, raw) => {
  const input = parseInput(deactivateUserSchema, raw);
  // The database step comes first: it refuses the Owner's own account and other branches,
  // and from that moment RLS denies the user everything.
  const { error } = await admin.rpc('admin_deactivate', {
    p_actor: owner.uid,
    p_user_id: input.uid,
    p_reason: input.reason ?? null,
    p_device_tag: input.deviceTag ?? null,
  });
  if (error) throw fromDatabase(error, 'turn off');

  const { error: banError } = await admin.auth.admin.updateUserById(input.uid, {
    ban_duration: BAN_FOREVER,
  });
  if (banError) {
    console.error('admin-users: ban failed after deactivation', banError.code ?? 'unknown');
    throw new HttpError(
      'internal',
      'The account is turned off, but blocking its sign-in failed. Try again.',
    );
  }
  return { uid: input.uid, active: false };
};

/** AUTH-04, SEC-13: sign a user out of every device without turning the account off. */
const signOutEverywhere: Handler = async ({ admin, owner }, raw) => {
  const input = parseInput(userIdSchema, raw);
  const { error } = await admin.rpc('admin_sign_out_everywhere', {
    p_actor: owner.uid,
    p_user_id: input.uid,
    p_device_tag: input.deviceTag ?? null,
  });
  if (error) throw fromDatabase(error);
  return { uid: input.uid };
};

/** "Forgot your password? Ask the Owner to reset it." Returns a one-time link to pass on. */
const passwordResetLink: Handler = async (context, raw) => {
  const input = parseInput(userIdSchema, raw);
  const { data: email, error } = await context.admin.rpc('admin_log_password_reset', {
    p_actor: context.owner.uid,
    p_user_id: input.uid,
    p_device_tag: input.deviceTag ?? null,
  });
  if (error) throw fromDatabase(error);
  return { uid: input.uid, resetLink: await passwordLink(context, String(email)) };
};

export const HANDLERS: Record<Action, Handler> = {
  create,
  update,
  setRole,
  deactivate,
  signOutEverywhere,
  passwordResetLink,
};
