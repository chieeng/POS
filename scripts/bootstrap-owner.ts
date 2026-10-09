/**
 * ONE-TIME SCRIPT: creates the first Owner account (SEC-03).
 *
 * DELETE THIS FILE (and the "bootstrap-owner" npm script) once the production Owner exists.
 * Every later account is created by the Owner inside the app.
 *
 * It signs in with Application Default Credentials: your own Google account, through
 * `gcloud auth application-default login`. It never reads a service account key file
 * (SEC-10), contains no default password and creates nothing if an Owner already exists.
 *
 *   npm run bootstrap-owner -- --project pos-staging --email owner@example.com \
 *     --name "Full Name" --code RS [--branch main] [--store "Store name"]
 *
 * The Owner then sets their own password through the one-time link printed at the end.
 */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

interface Options {
  project: string;
  email: string;
  name: string;
  code: string;
  branch: string;
  store: string | undefined;
}

function fail(message: string): never {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

function readOptions(): Options {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      email: { type: 'string' },
      name: { type: 'string' },
      code: { type: 'string' },
      branch: { type: 'string', default: 'main' },
      store: { type: 'string' },
    },
    strict: true,
  });

  const project = values.project?.trim() ?? '';
  const email = values.email?.trim().toLowerCase() ?? '';
  const name = values.name?.trim() ?? '';
  const code = values.code?.trim().toUpperCase() ?? '';
  const branch = values.branch.trim();

  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project))
    fail('--project must be a Firebase project id.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('--email must be a valid email address.');
  if (name.length < 1 || name.length > 80) fail('--name is required (up to 80 characters).');
  if (!/^[A-Z0-9]{2,6}$/.test(code))
    fail('--code must be 2 to 6 letters or digits (for receipt numbers).');
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(branch))
    fail('--branch must be lowercase letters, digits or dashes.');

  return { project, email, name, code, branch, store: values.store?.trim() || undefined };
}

async function ownerAlreadyExists(): Promise<boolean> {
  const inFirestore = await getFirestore()
    .collection('users')
    .where('role', '==', 'owner')
    .limit(1)
    .get();
  if (!inFirestore.empty) return true;

  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    if (page.users.some((user) => user.customClaims?.role === 'owner')) return true;
    pageToken = page.pageToken;
  } while (pageToken);
  return false;
}

async function confirmProject(project: string, usingEmulators: boolean) {
  if (usingEmulators) {
    console.log('Using the local Emulator Suite. No real project is touched.');
    return;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(
    `This creates the first Owner in the REAL project "${project}".\nType the project id to continue: `,
  );
  prompt.close();
  if (answer.trim() !== project) fail('Project id did not match. Nothing was changed.');
}

async function main() {
  const options = readOptions();
  const usingEmulators = Boolean(
    process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST,
  );
  if (
    !usingEmulators &&
    (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST)
  ) {
    fail('Set both FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST, or neither.');
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !usingEmulators) {
    fail(
      'GOOGLE_APPLICATION_CREDENTIALS is set. This script must not use a key file (SEC-10).\n' +
        'Unset it and run `gcloud auth application-default login` instead.',
    );
  }

  await confirmProject(options.project, usingEmulators);
  initializeApp({ projectId: options.project });
  const auth = getAuth();
  const db = getFirestore();

  if (await ownerAlreadyExists()) {
    fail('An Owner already exists in this project. Nothing was changed. Delete this script.');
  }

  const created = await auth.createUser({
    email: options.email,
    displayName: options.name,
    // Random and never shown: the Owner sets their own password through the link below.
    password: randomBytes(32).toString('base64url'),
    // TOTP enrollment (SEC-05) needs a verified email; you vouch for it by running this.
    emailVerified: true,
  });

  try {
    await auth.setCustomUserClaims(created.uid, {
      role: 'owner',
      branchId: options.branch,
      active: true,
    });

    const batch = db.batch();
    const branchRef = db.collection('branches').doc(options.branch);
    if (!(await branchRef.get()).exists) {
      batch.create(branchRef, { name: options.store ?? 'Store', branchId: options.branch });
    }
    batch.create(db.collection('users').doc(created.uid), {
      displayName: options.name,
      email: options.email,
      role: 'owner',
      userCode: options.code,
      branchId: options.branch,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.create(db.collection('auditLogs').doc(), {
      action: 'user.create',
      actorId: created.uid,
      branchId: options.branch,
      deviceTag: null,
      targetType: 'user',
      targetId: created.uid,
      after: {
        email: options.email,
        displayName: options.name,
        role: 'owner',
        userCode: options.code,
      },
      reason: 'First Owner created by scripts/bootstrap-owner.ts (SEC-03)',
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    await auth.deleteUser(created.uid).catch(() => undefined);
    throw error;
  }

  const link = await auth.generatePasswordResetLink(options.email);
  console.log(`\nOwner created: ${options.email} (branch "${options.branch}").`);
  console.log('\nOne-time link to set the password (give it only to the Owner):\n');
  console.log(link);
  console.log('\nNext: sign in, turn on two-step sign-in when asked, then DELETE this script.\n');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
