# POS

POS, inventory, attendance and lightweight payroll for a single retail store.
Requirements live in [docs/SRS.md](docs/SRS.md); IDs such as `AUTH-01` or `SEC-04` in code
comments and commit messages refer to it.

**Status: Phase 0 (foundation).** Sign-in, user management, device tags and the audit log
are built. Store settings, selling, inventory and the other screens are not built yet.

## What is in the repository

```
apps/web/              React 18 + TypeScript + Vite PWA
  src/features/auth/   sign-in, Owner two-step, idle lock
  src/features/home/   placeholder home per role
  src/components/ui/   shadcn-style components on the design tokens
  src/lib/firebase.ts  Firebase client (App Check, offline cache, emulators)
  src/styles/          design tokens (CSS variables + Tailwind theme), light and dark
functions/             Cloud Functions (Node 22, asia-southeast1)
tests/rules/           Security Rules tests
scripts/               one-time bootstrap script for the first Owner
firestore.rules        default deny; users and auditLogs
storage.rules          default deny
firebase.json          emulators, Hosting security headers
.github/workflows/     ci.yml, deploy.yml
```

## Requirements

- Node 22 or newer (Cloud Functions run on Node 22; see `.nvmrc`)
- **Java 21 or newer** for the Firebase emulators
- For real projects only: the [gcloud CLI](https://cloud.google.com/sdk/docs/install)

## Run it locally

```bash
npm install
npm run emulators            # builds functions, then Auth, Firestore, Functions, Storage; UI on http://localhost:4000
npm run dev                  # in a second terminal; http://localhost:5173
```

The dev server needs no `.env` file: it talks to the Emulator Suite under the placeholder
project `demo-pos`, which can never reach a real Firebase project. Emulator data is kept in
`.emulator-data/` (git-ignored) between runs.

Create a local Owner (emulators running, third terminal):

```bash
# PowerShell
$env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"; $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
npm run bootstrap-owner -- --project demo-pos --email owner@example.com --name "Your Name" --code YN
```

Open the printed link and add `&newPassword=<at least 10 characters>` to set the password.

Sign in as that Owner and add staff under Settings > Users. After changing functions code,
run `npm run build -w functions`; the emulator reloads it.

**Local emulator profile.** The Auth emulator cannot do authenticator-app (TOTP) codes and
cannot issue App Check tokens. So that Owner screens can be used locally, `npm run emulators`
runs [scripts/emulator-profile.mjs](scripts/emulator-profile.mjs), which writes a git-ignored
copy of the rules with only the second-factor check relaxed; inside the emulator the functions
also skip that check and App Check. None of this exists outside the emulator: deploys, CI and
`npm run test:emulators` use the real `firestore.rules`. Two-step sign-in itself can only
be tested on staging.

## Checks

| Command                      | What it does                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `npm run lint`               | ESLint and Prettier                                                            |
| `npm run typecheck`          | TypeScript for the web app, functions, scripts and tests                       |
| `npm test`                   | Unit tests (Vitest)                                                            |
| `npm run test:emulators`     | Security Rules tests and Cloud Functions tests in the Emulator Suite           |
| `npm run test:emulators:alt` | The same tests on spare ports, for when `npm run emulators` is already running |
| `npm run build`              | Builds functions and the web app                                               |

CI runs all of them on every pull request, plus `npm audit` on production dependencies.

## How access is enforced

The Firebase web config is public, so the app itself is never trusted (SRS 6.3).

- **No sign-up.** There is no sign-up page or route. Accounts are created only by the Owner
  through the `createUser` function, which returns a one-time link for the new user to set
  their own password (SEC-01).
- **Claims.** Each account carries `role`, `branchId` and `active` custom claims, set only by
  Cloud Functions (AUTH-03). Rules and functions require a valid role and `active == true`
  (SEC-02). A blocking function refuses sign-in for an account without them and logs every
  sign-in (SYS-03).
- **Owner two-step.** Rules and functions accept an Owner only if that sign-in passed the
  authenticator-app step (SEC-05). The app walks a new Owner through setting it up.
- **Functions.** `createUser`, `updateUser`, `setUserRole`, `deactivateUser`,
  `signOutEverywhere` and `createPasswordResetLink` are Owner-only, enforce App Check, validate input with Zod and
  write `auditLogs` (SEC-08). The Owner cannot demote or turn off their own account.
- **Rules.** Default deny. `users` and `auditLogs` are read-only from clients. A user may
  write only their own device record (SYS-02), validated field by field.
- **Client routing is for navigation only.**

Known limits, to be aware of:

- After `deactivateUser`, `setUserRole` or `signOutEverywhere`, a device that is already signed
  in keeps working until its ID token expires (up to one hour); Firebase does not let rules see
  revocation. New sign-ins and token refreshes are refused immediately.
- The idle lock (AUTH-05) asks for the password. The design also shows a 4-digit staff PIN;
  the SRS does not define where a PIN would be stored or checked, so it is not built.
- The device tag in audit logs is reported by the client, so it is a label, not proof. Sign-in
  entries have none. Devices cannot be signed out one at a time; Firebase revokes per account.
- A deactivated account cannot be turned back on from the app yet.
- The idle time is fixed at 15 minutes until the settings screen (SYS-01) exists.

## Design system

Tokens come from the Claude Design project ("Organic"): `apps/web/src/styles/index.css` holds
the colors, ramps, type, spacing, radii and shadows as CSS variables, which are also the
Tailwind theme (`bg-accent-200`, `text-neutral-700`, `font-heading`, `shadow-lg`). Dark mode
follows the device; set `data-theme="light"` or `"dark"` on `<html>` to force one. In this
project `accent` is the terracotta brand color, not shadcn's hover tint, so check that class
when adding shadcn components. Fonts (Caprasimo, Figtree) load from Google Fonts.

## First-time setup of a real project (manual)

Do this for `pos-staging` first, then `pos-prod`.

1. **Create the project** on the Blaze plan. Set a **budget alert** (PHP 500, NFR-10).
2. **Firestore:** create the database in `asia-southeast1` and turn on **point-in-time
   recovery** (SEC-15). **Storage:** create the default bucket in the same region.
3. **Authentication:** upgrade to **Identity Platform**. Enable Email/Password only. Under
   Settings > User actions, **turn off "Enable create (sign-up)"** (SEC-01) and turn on
   **email enumeration protection**. Under Password policy, require at least 10 characters
   (SEC-05). Under Sign-in method > Advanced, enable **multi-factor authentication** and the
   **TOTP** provider. If the console has no TOTP switch, enable it with the Admin SDK or REST
   API as described in the Firebase "TOTP MFA" guide.
4. **App Check:** create a **reCAPTCHA Enterprise** key for the Hosting domains, register the
   web app with it, and after the first working deploy turn on **enforcement** for Firestore,
   Storage and Authentication (SEC-06). Functions enforce it in code already.
5. **Web app config:** Project settings > Your apps > add a Web app. Its values are the
   `VITE_FIREBASE_*` variables (see `apps/web/.env.example`).
6. **Deploy** (see below), so the rules, functions and the sign-in blocking function exist.
7. **Create the first Owner** (SEC-03):
   ```bash
   gcloud auth application-default login
   npm run bootstrap-owner -- --project pos-staging --email <owner email> --name "<name>" --code <2-6 letters> --store "<store name>"
   ```
   Send the printed link to the Owner only. They set a password, sign in, and turn on two-step
   sign-in when asked. **After the production Owner exists, delete
   `scripts/bootstrap-owner.ts` and the `bootstrap-owner` npm script.**
8. Check the headers once: `curl -I https://<site>/` should show `Content-Security-Policy`,
   `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options` and
   `Referrer-Policy` (SEC-12).

## Deploying

GitHub Actions deploys with **Workload Identity Federation**; there is no service account key,
and none may be added (SEC-10).

- push to `dev` deploys to staging
- a `v*` tag on `main` deploys to production
- a pull request into `dev` gets a staging preview channel

Deploys are **off** until the repository variable `DEPLOY_ENABLED` is set to `true`; until
then the workflow is skipped.

One-time setup per project:

1. Create a Workload Identity Pool and a GitHub OIDC provider restricted to this repository
   (`attribute.repository == "chieeng/POS"`).
2. Create a deploy-only service account, allow the provider to impersonate it
   (`roles/iam.workloadIdentityUser`), and grant it only what `firebase deploy` needs
   (Firebase Hosting Admin, Cloud Functions Admin, Firebase Rules Admin, Cloud Datastore Index
   Admin, Service Account User, plus the build roles Functions deployment asks for).
3. In GitHub > Settings > Environments, create `staging` and `production` and add the
   **variables** listed at the top of [.github/workflows/deploy.yml](.github/workflows/deploy.yml).
   Require a reviewer on `production`.

Repository settings (SEC-11): keep the repo private; protect `main` (pull request review and
the CI check required); turn on secret scanning with push protection and Dependabot alerts.

## Branching

Feature branches > pull request into `dev` > release pull request into `main` (SRS 7.3).
Commits follow Conventional Commits.
