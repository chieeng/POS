// Integration tests for the admin-users Edge Function against the local Supabase stack.
// Run with `npm run test:functions` (the stack must be up: `npx supabase start`).
import { assert, assertEquals, assertFalse, assertMatch } from '@std/assert';
import {
  admin,
  ANON_KEY,
  auditOf,
  call,
  createBranch,
  profileOf,
  rowsWithToken,
  RUN,
  seedUser,
  sessionWorks,
  signIn,
  signInWithSecondStep,
  strangerClient,
} from './testing.ts';

// The clients keep timers and connections of their own; these are integration tests.
const options = { sanitizeOps: false, sanitizeResources: false };

// ---- Fixture: one branch with every kind of caller, and a second branch -------------------
const branch = await createBranch('main');
const otherBranch = await createBranch('other');

const owner = await seedUser('owner', 'owner', branch);
const sales = await seedUser('sales', 'sales', branch);
const special = await seedUser('special', 'special_sales', branch);
const nobody = await seedUser('nobody', null);
const target = await seedUser('target', 'sales', branch);
const outsider = await seedUser('outsider', 'sales', otherBranch);
const turnedOffOwner = await seedUser('owner-off', 'owner', otherBranch);
const signedOutOwner = await seedUser('owner-out', 'owner', otherBranch);

const ownerSession = await signInWithSecondStep(owner);
const ownerWithoutSecondStep = await signIn(owner);
const salesSession = await signIn(sales);
const specialSession = await signIn(special);
const nobodySession = await signIn(nobody);
const turnedOffSession = await signInWithSecondStep(turnedOffOwner);
const signedOutSession = await signInWithSecondStep(signedOutOwner);
assert(ownerWithoutSecondStep && salesSession && specialSession && nobodySession);

// A token issued before the account was turned off, and one issued before its sessions
// were ended. Both are still inside their one-hour lifetime.
const turnedOff = await admin
  .from('profiles')
  .update({ active: false })
  .eq('id', turnedOffOwner.id);
const signedOut = await admin.rpc('admin_sign_out_everywhere', {
  p_actor: signedOutOwner.id,
  p_user_id: signedOutOwner.id,
});
assertEquals([turnedOff.error, signedOut.error], [null, null]);

const asOwner = (action: string, input: unknown) => call(ownerSession.token, { action, input });

const newUser = () => ({
  email: `new-${crypto.randomUUID().slice(0, 8)}.${RUN}@fn.test`,
  displayName: 'Jun Reyes',
  role: 'sales',
  userCode: 'JR',
});

// ---- Access checks shared by every action (SEC-08) ----------------------------------------
const ACTIONS: [string, () => Record<string, unknown>][] = [
  ['create', () => ({ ...newUser(), userCode: 'ZZ' })],
  ['update', () => ({ uid: target.id, displayName: 'New Name' })],
  ['setRole', () => ({ uid: target.id, role: 'special_sales' })],
  ['deactivate', () => ({ uid: target.id })],
  ['signOutEverywhere', () => ({ uid: target.id })],
  ['passwordResetLink', () => ({ uid: target.id })],
];

for (const [action, input] of ACTIONS) {
  Deno.test(`${action}: refuses a caller who is not signed in`, options, async () => {
    assertEquals((await call(null, { action, input: input() })).status, 401);
    // The public anon key is a valid JWT, but it is nobody's session.
    assertEquals((await call(ANON_KEY, { action, input: input() })).status, 401);
  });

  Deno.test(`${action}: refuses a forged token`, options, async () => {
    const [header, , signature] = ownerSession.token.split('.');
    const payload = btoa(JSON.stringify({ sub: owner.id, role: 'authenticated', aal: 'aal2' }));
    assertEquals(
      (await call(`${header}.${payload}.${signature}`, { action, input: input() })).status,
      401,
    );
    assertEquals((await call('not-a-token', { action, input: input() })).status, 401);
  });

  Deno.test(`${action}: refuses an account without a profile`, options, async () => {
    const result = await call(nobodySession.token, { action, input: input() });
    assertEquals([result.status, result.code], [403, 'permission-denied']);
  });

  Deno.test(`${action}: refuses Sales and Special Sales`, options, async () => {
    for (const session of [salesSession, specialSession]) {
      const result = await call(session.token, { action, input: input() });
      assertEquals([result.status, result.code], [403, 'permission-denied']);
      assertEquals(result.message, 'Only the Owner can do this.');
    }
  });

  Deno.test(
    `${action}: refuses an Owner who skipped the second step (SEC-05)`,
    options,
    async () => {
      const result = await call(ownerWithoutSecondStep.token, { action, input: input() });
      assertEquals([result.status, result.code], [403, 'permission-denied']);
      assertEquals(result.message, 'Two-step sign-in is required for the Owner.');
    },
  );

  Deno.test(
    `${action}: refuses an Owner token issued before the account was turned off`,
    options,
    async () => {
      const result = await call(turnedOffSession.token, { action, input: input() });
      assertEquals([result.status, result.code], [403, 'permission-denied']);
    },
  );

  Deno.test(
    `${action}: refuses an Owner token issued before "sign out everywhere"`,
    options,
    async () => {
      const result = await call(signedOutSession.token, { action, input: input() });
      assertEquals([result.status, result.code], [401, 'unauthenticated']);
    },
  );

  Deno.test(`${action}: refuses malformed input`, options, async () => {
    for (const bad of [{ ...input(), extra: 'field' }, null, 'text', []]) {
      const result = await asOwner(action, bad);
      assertEquals([result.status, result.code], [400, 'invalid-argument']);
    }
  });
}

Deno.test('refuses an unknown action, a missing body and other methods', options, async () => {
  assertEquals((await asOwner('delete', { uid: target.id })).code, 'invalid-argument');
  assertEquals((await call(ownerSession.token, null)).code, 'invalid-argument');
  assertEquals(
    (await call(ownerSession.token, { action: 'update', input: {}, as: owner.id })).code,
    'invalid-argument',
  );
});

Deno.test('none of the refused calls changed anything', options, async () => {
  const profile = await profileOf(target.id);
  assertEquals([profile?.display_name, profile?.role, profile?.active], ['target', 'sales', true]);
  for (const action of [
    'user.update',
    'user.setRole',
    'user.deactivate',
    'user.signOutEverywhere',
  ]) {
    assertEquals((await auditOf(action, target.id)).length, 0);
  }
});

// ---- create (AUTH-02, SEC-01) -------------------------------------------------------------
Deno.test(
  'create: makes the account, profile and audit entry, and returns a one-time link',
  options,
  async () => {
    const input = { ...newUser(), deviceTag: 'A1B2' };
    const result = await asOwner('create', input);
    assertEquals(result.status, 200);
    const uid = String(result.body.uid);

    const profile = await profileOf(uid);
    assertEquals(
      [profile?.email, profile?.display_name, profile?.role, profile?.user_code, profile?.active],
      [input.email, 'Jun Reyes', 'sales', 'JR', true],
    );
    // Always the caller's own branch.
    assertEquals(profile?.branch_id, branch);

    const [entry] = await auditOf('user.create', uid);
    assertEquals(
      [entry?.actor_id, entry?.branch_id, entry?.device_tag],
      [owner.id, branch, 'A1B2'],
    );
    assertEquals(entry?.after, {
      email: input.email,
      displayName: 'Jun Reyes',
      role: 'sales',
      userCode: 'JR',
    });

    const link = String(result.body.resetLink);
    // The app's set-password screen, with the token after "#" (never sent to a server).
    assertMatch(link, /^http:\/\/localhost:5173\/set-password#token_hash=[^&]+&type=recovery$/);
    // The link is never stored.
    assertFalse(JSON.stringify(entry).includes('token'));

    // Nobody knows the password: the account cannot be signed in to until the link is used.
    assertEquals(await signIn({ id: uid, email: input.email }), null);
  },
);

Deno.test('create: the caller cannot choose the branch, uid or password', options, async () => {
  for (const extra of [
    { branchId: otherBranch },
    { uid: target.id },
    { password: 'password1234' },
  ]) {
    const result = await asOwner('create', { ...newUser(), userCode: 'XB', ...extra });
    assertEquals(result.code, 'invalid-argument');
  }
});

Deno.test('create: refuses a duplicate email', options, async () => {
  const result = await asOwner('create', { ...newUser(), email: sales.email, userCode: 'DE' });
  assertEquals([result.status, result.code], [409, 'already-exists']);
  assertEquals(result.message, 'An account with this email already exists.');
});

Deno.test(
  'create: refuses a duplicate user code and leaves no half-made account',
  options,
  async () => {
    const first = { ...newUser(), userCode: 'DUP' };
    assertEquals((await asOwner('create', first)).status, 200);

    const second = { ...newUser(), userCode: 'dup' };
    const result = await asOwner('create', second);
    assertEquals([result.status, result.code], [409, 'already-exists']);
    assertEquals(result.message, 'This user code is already taken.');

    const { data } = await admin.from('profiles').select('id').eq('email', second.email);
    assertEquals(data, []);
    // The email is free again, so no Auth account was left behind.
    const retry = await asOwner('create', { ...second, userCode: 'DUP2' });
    assertEquals(retry.status, 200);
  },
);

// ---- update (AUTH-02) ---------------------------------------------------------------------
Deno.test(
  'update: changes name and user code, logs before and after with the device tag',
  options,
  async () => {
    const user = await seedUser('edit-me', 'sales', branch);
    const before = await profileOf(user.id);
    const result = await asOwner('update', {
      uid: user.id,
      displayName: ' Juan Reyes ',
      userCode: 'jnr',
      deviceTag: 'A1B2',
    });
    assertEquals(result.body, { uid: user.id, displayName: 'Juan Reyes', userCode: 'JNR' });

    const profile = await profileOf(user.id);
    assertEquals([profile?.display_name, profile?.user_code], ['Juan Reyes', 'JNR']);
    const [entry] = await auditOf('user.update', user.id);
    assertEquals(entry?.before, { displayName: 'edit-me', userCode: before?.user_code });
    assertEquals(entry?.after, { displayName: 'Juan Reyes', userCode: 'JNR' });
    assertEquals(entry?.device_tag, 'A1B2');

    // Writes nothing when nothing changes.
    const again = await asOwner('update', {
      uid: user.id,
      displayName: 'Juan Reyes',
      userCode: 'JNR',
    });
    assertEquals(again.body, { uid: user.id });
    assertEquals((await auditOf('user.update', user.id)).length, 1);
  },
);

Deno.test('update: refuses a user code that someone else has', options, async () => {
  const taken = (await profileOf(special.id))?.user_code;
  const result = await asOwner('update', { uid: sales.id, userCode: taken });
  assertEquals([result.status, result.code], [409, 'already-exists']);
});

Deno.test('update: cannot change role, branch or active flag', options, async () => {
  for (const extra of [{ role: 'owner' }, { branchId: otherBranch }, { active: false }]) {
    const result = await asOwner('update', { uid: sales.id, displayName: 'x', ...extra });
    assertEquals(result.code, 'invalid-argument');
  }
  const profile = await profileOf(sales.id);
  assertEquals([profile?.role, profile?.branch_id, profile?.active], ['sales', branch, true]);
});

Deno.test('update: cannot reach a user of another branch', options, async () => {
  const result = await asOwner('update', { uid: outsider.id, displayName: 'Hacked' });
  assertEquals([result.status, result.code], [404, 'not-found']);
  assertEquals((await profileOf(outsider.id))?.display_name, 'outsider');
});

// ---- setRole (AUTH-03) --------------------------------------------------------------------
Deno.test(
  'setRole: changes the role, logs before and after, and ends the sessions',
  options,
  async () => {
    const user = await seedUser('promote-me', 'sales', branch);
    const session = await signIn(user);
    assert(session && (await sessionWorks(session)));

    const result = await asOwner('setRole', {
      uid: user.id,
      role: 'special_sales',
      deviceTag: 'A1B2',
    });
    assertEquals(result.body, { uid: user.id, role: 'special_sales' });
    assertEquals((await profileOf(user.id))?.role, 'special_sales');
    assertFalse(await sessionWorks(session));

    const [entry] = await auditOf('user.setRole', user.id);
    assertEquals(entry?.before, { role: 'sales' });
    assertEquals(entry?.after, { role: 'special_sales' });
    assertEquals(entry?.device_tag, 'A1B2');
  },
);

Deno.test('setRole: refuses changing your own role', options, async () => {
  const result = await asOwner('setRole', { uid: owner.id, role: 'sales' });
  assertEquals([result.status, result.code], [412, 'failed-precondition']);
  assertEquals(result.message, 'You cannot change the role of your own account.');
  assertEquals((await profileOf(owner.id))?.role, 'owner');
});

Deno.test('setRole: cannot reach another branch or an unknown user', options, async () => {
  assertEquals((await asOwner('setRole', { uid: outsider.id, role: 'owner' })).code, 'not-found');
  assertEquals((await profileOf(outsider.id))?.role, 'sales');
  assertEquals(
    (await asOwner('setRole', { uid: crypto.randomUUID(), role: 'sales' })).code,
    'not-found',
  );
});

// ---- deactivate (SEC-04) ------------------------------------------------------------------
Deno.test(
  'deactivate: turns the account off, ends its sessions, bans it, keeps the profile',
  options,
  async () => {
    const user = await seedUser('leaver', 'sales', branch);
    const session = await signIn(user);
    assert(session && (await sessionWorks(session)));

    const result = await asOwner('deactivate', {
      uid: user.id,
      reason: 'Left the store',
      deviceTag: 'A1B2',
    });
    assertEquals(result.body, { uid: user.id, active: false });

    // AUTH-02: never hard-deleted.
    assertEquals((await profileOf(user.id))?.active, false);
    assertFalse(await sessionWorks(session));
    // Banned: the right password no longer signs in.
    assertEquals(await signIn(user), null);

    const [entry] = await auditOf('user.deactivate', user.id);
    assertEquals(entry?.before, { active: true, role: 'sales' });
    assertEquals(entry?.after, { active: false });
    assertEquals([entry?.reason, entry?.device_tag], ['Left the store', 'A1B2']);

    // No role and no link for an account that is off.
    assertEquals(
      (await asOwner('setRole', { uid: user.id, role: 'sales' })).code,
      'failed-precondition',
    );
    const link = await asOwner('passwordResetLink', { uid: user.id });
    assertEquals([link.status, link.message], [412, 'This account is turned off.']);
  },
);

Deno.test('deactivate: refuses turning off your own account', options, async () => {
  const result = await asOwner('deactivate', { uid: owner.id });
  assertEquals([result.status, result.code], [412, 'failed-precondition']);
  assertEquals(result.message, 'You cannot turn off your own account.');
  assertEquals((await profileOf(owner.id))?.active, true);
  assert(await sessionWorks(ownerSession));
});

Deno.test('deactivate: cannot reach a user of another branch', options, async () => {
  assertEquals((await asOwner('deactivate', { uid: outsider.id })).code, 'not-found');
  assertEquals((await profileOf(outsider.id))?.active, true);
});

// ---- signOutEverywhere (AUTH-04, SEC-13) --------------------------------------------------
Deno.test(
  'signOutEverywhere: ends every session without turning the account off',
  options,
  async () => {
    const user = await seedUser('lost-phone', 'sales', branch);
    const phone = await signIn(user);
    const laptop = await signIn(user);
    assert(phone && laptop && (await sessionWorks(phone)) && (await sessionWorks(laptop)));
    await admin.from('devices').insert({ user_id: user.id, device_tag: 'P1P1', label: 'Phone' });
    assertEquals((await rowsWithToken(phone.token, 'devices')).length, 1);

    const result = await asOwner('signOutEverywhere', { uid: user.id, deviceTag: 'A1B2' });
    assertEquals(result.body, { uid: user.id });
    assertFalse(await sessionWorks(phone));
    assertFalse(await sessionWorks(laptop));

    // The old token reads nothing from the database either, although it has not expired.
    assertEquals(await rowsWithToken(phone.token, 'devices'), []);

    assertEquals((await profileOf(user.id))?.active, true);
    const [entry] = await auditOf('user.signOutEverywhere', user.id);
    assertEquals([entry?.actor_id, entry?.device_tag], [owner.id, 'A1B2']);

    // The account still works: the user can sign in again.
    assert(await signIn(user));
  },
);

// ---- passwordResetLink --------------------------------------------------------------------
Deno.test(
  'passwordResetLink: returns a link for an active user and logs the action, not the link',
  options,
  async () => {
    const result = await asOwner('passwordResetLink', { uid: special.id, deviceTag: 'A1B2' });
    assertEquals(result.status, 200);
    assertMatch(
      String(result.body.resetLink),
      /^http:\/\/localhost:5173\/set-password#token_hash=[^&]+&type=recovery$/,
    );

    const entries = await auditOf('user.passwordResetLink', special.id);
    assertEquals(entries.length, 1);
    assertEquals([entries[0]?.before, entries[0]?.after, entries[0]?.reason], [null, null, null]);
    assertFalse(JSON.stringify(entries).includes('token'));
  },
);

Deno.test(
  'a one-time link is used only when the app presents it, only once, and a newer link cancels it',
  options,
  async () => {
    const user = await seedUser('link-user', 'sales', branch);
    const tokenOf = (link: unknown) =>
      decodeURIComponent(/token_hash=([^&]+)/.exec(String(link))?.[1] ?? '');

    const first = tokenOf((await asOwner('passwordResetLink', { uid: user.id })).body.resetLink);
    const second = tokenOf((await asOwner('passwordResetLink', { uid: user.id })).body.resetLink);

    // Making the second link cancelled the first.
    const stale = await strangerClient().auth.verifyOtp({ token_hash: first, type: 'recovery' });
    assert(stale.error);

    // Pressing Continue: the app presents the token, which signs the user in.
    const app = strangerClient();
    const used = await app.auth.verifyOtp({ token_hash: second, type: 'recovery' });
    assertEquals(used.error, null);
    assertEquals(used.data.user?.id, user.id);

    // That session may set a password of at least 10 characters (SEC-05).
    const short = await app.auth.updateUser({ password: 'short1234' });
    assertEquals(short.error?.code, 'weak_password');
    const chosen = await app.auth.updateUser({ password: 'chosen-by-user-1' });
    assertEquals(chosen.error, null);

    // The same token never works twice.
    const again = await strangerClient().auth.verifyOtp({ token_hash: second, type: 'recovery' });
    assert(again.error);
  },
);

Deno.test('passwordResetLink: cannot reach a user of another branch', options, async () => {
  assertEquals((await asOwner('passwordResetLink', { uid: outsider.id })).code, 'not-found');
});

// ---- record_sign_in (SYS-03, SEC-02) ------------------------------------------------------
Deno.test(
  'record_sign_in: logs a sign-in by an account with an active profile',
  options,
  async () => {
    const { error } = await salesSession.client.rpc('record_sign_in', { p_device_tag: 'A1B2' });
    assertEquals(error, null);
    const [entry] = await auditOf('auth.signIn', sales.id);
    assertEquals(
      [entry?.actor_id, entry?.branch_id, entry?.device_tag],
      [sales.id, branch, 'A1B2'],
    );
  },
);

Deno.test(
  'record_sign_in: refuses an account without a profile, or one that is off',
  options,
  async () => {
    const noProfile = await nobodySession.client.rpc('record_sign_in', { p_device_tag: 'A1B2' });
    assert(noProfile.error);
    const turnedOff = await turnedOffSession.client.rpc('record_sign_in', { p_device_tag: 'A1B2' });
    assert(turnedOff.error);
    assertEquals((await auditOf('auth.signIn', nobody.id)).length, 0);
    assertEquals((await auditOf('auth.signIn', turnedOffOwner.id)).length, 0);
  },
);

// ---- No way in from outside the app (SEC-01, SEC-06, SEC-16) ------------------------------
Deno.test('nobody can sign up with the public anon key', options, async () => {
  const email = `intruder.${RUN}@fn.test`;
  const { data, error } = await strangerClient().auth.signUp({
    email,
    password: 'password1234',
    options: { captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' },
  });
  assert(error);
  assertEquals(data.user, null);
  const { data: profiles } = await admin.from('profiles').select('id').eq('email', email);
  assertEquals(profiles, []);
});

Deno.test('sign-in without a CAPTCHA token is refused', options, async () => {
  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: sales.email, password: 'password1234' }),
    },
  );
  const body = await response.json();
  assertEquals([response.status, body.error_code], [400, 'captcha_failed']);
});

// ---- The admin database functions are closed to every client ------------------------------
Deno.test('no client can call an admin_* database function directly', options, async () => {
  for (const session of [salesSession, ownerSession]) {
    const { error } = await session.client.rpc('admin_set_role', {
      p_actor: owner.id,
      p_user_id: target.id,
      p_role: 'owner',
    });
    assert(error);
  }
  assertEquals((await profileOf(target.id))?.role, 'sales');
});
