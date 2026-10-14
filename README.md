# POS

POS, inventory, attendance and lightweight payroll for a single retail store.
Requirements live in [docs/SRS.md](docs/SRS.md); IDs such as `AUTH-01` or `SEC-04` in code
comments and commit messages refer to it.

**Status: Phase 0 (foundation).** Sign-in, user management, device tags and the audit log
are built on Supabase. Store settings, selling, inventory and the other screens are not built
yet.

## What is in the repository

```
apps/web/                 React 18 + TypeScript + Vite PWA
  src/features/auth/      sign-in, Owner two-step, set password, idle lock
  src/features/users/     Owner user management and device list
  src/features/audit/     audit log viewer
  src/lib/supabase.ts     Supabase client and validated config
  src/styles/             design tokens (CSS variables + Tailwind theme), light and dark
supabase/
  config.toml             local stack: sign-up off, TOTP, Turnstile, 10-character passwords
  migrations/             tables, Row Level Security, database functions (SQL)
  functions/admin-users/  Owner-only Edge Function (Deno) and its tests
  tests/                  pgTAP tests for every table, role and function
  seed.sql                local development accounts only
scripts/                  one-time bootstrap of the first Owner; local helpers
vercel.json               build settings, SPA rewrite and security headers
.github/workflows/        ci.yml, deploy.yml
```

## Requirements

- Node 22 or newer (see `.nvmrc`)
- **Docker Desktop**, running: the local Supabase stack runs in containers
- **Deno 2** for the Edge Function type-check and tests
- The Supabase CLI comes with `npm install`; use it as `npx supabase`

## Run it locally

```bash
npm install
cp supabase/.env.example supabase/.env   # PowerShell: Copy-Item supabase/.env.example supabase/.env
npx supabase start                       # Postgres, Auth, Realtime, Edge Functions; first run downloads images
npm run env:local                        # writes apps/web/.env.local with the local URL and anon key
npm run dev                              # http://localhost:5173
```

`npx supabase start` applies every migration and then `supabase/seed.sql`. Useful local
addresses: Studio on http://127.0.0.1:54323, and http://127.0.0.1:54324 for the mail the
stack would have sent. `npm run db:reset` rebuilds the database from the migrations and
seed; `npm run db:stop` stops the stack.

**Local test accounts** (from `seed.sql`, password `password1234` for all of them):

| Email              | Role               |
| ------------------ | ------------------ |
| `owner@pos.test`   | Owner              |
| `special@pos.test` | Special Sales      |
| `sales@pos.test`   | Sales              |
| `off@pos.test`     | Sales, deactivated |

These accounts are **local only**. `seed.sql` is loaded by `supabase start` and
`supabase db reset` on a developer machine and in CI; `supabase db push` never runs it, so
staging and production have no default accounts (SEC-11).

The local stack does real two-step sign-in: the first time you sign in as the Owner the app
asks you to add the account to an authenticator app. Turnstile uses Cloudflare's published
always-pass test keys locally, so no challenge appears.

To try a one-time password link, add a user under Settings > Users and open the link the app
shows you.

## Checks

| Command                  | What it does                                                          |
| ------------------------ | --------------------------------------------------------------------- |
| `npm run lint`           | ESLint and Prettier                                                   |
| `npm run typecheck`      | TypeScript for the web app and scripts; `deno check` for the function |
| `npm test`               | Web unit tests (Vitest)                                               |
| `npm run test:db`        | pgTAP tests: RLS and database functions (needs the local stack)       |
| `npm run test:functions` | Deno tests for `admin-users` (needs the local stack and internet)     |
| `npm run build`          | Builds the web app                                                    |

CI runs all of them on every pull request against a fresh local stack, plus `npm audit` on
production dependencies. The function tests create accounts that are never deleted (users
are never hard-deleted); run `npm run db:reset` to clear them.

## How access is enforced

The Supabase URL and anon key are public, so the app itself is never trusted (SRS 6.3).

- **No sign-up.** Sign-up is off in Supabase Auth and there is no sign-up page or route.
  Accounts are created only by the Owner through the `admin-users` Edge Function, which
  returns a one-time link for the new user to set their own password (SEC-01, AUTH-02).
- **Profiles, read live.** Role, branch and active flag live in `profiles`. Policies read
  them on every request through `private.current_role()`, `private.is_active()` and
  `private.is_aal2()`, so a role change or deactivation applies to the very next request
  (SEC-02, SEC-04). A token whose session was ended is refused too, so "sign out everywhere"
  is immediate (SEC-13).
- **Owner two-step.** Owner-only data and the Edge Function need a session that passed the
  authenticator-app step (`aal2`, SEC-05). The app walks a new Owner through setting it up.
- **Row Level Security.** On every table, default deny, nothing for `anon`. A user reads only
  their own profile row; the Owner reads their branch. A user writes only their own `devices`
  rows, column by column (SYS-02). `audit_logs` is append-only for every API role. New tables
  and functions start with no API access.
- **Edge Function `admin-users`.** Actions `create`, `update`, `setRole`, `deactivate`,
  `signOutEverywhere`, `passwordResetLink`. Each checks the token, the live profile (Owner,
  active) and `aal2`, validates input with strict Zod schemas and writes `audit_logs` with
  the device tag (SEC-08). The Owner cannot demote or turn off their own account. This is the
  only place the service role key is used.
- **Sign-in log.** After sign-in the app calls `record_sign_in`, which writes the audit
  entry on the server (SYS-03).
- **CAPTCHA.** Cloudflare Turnstile on sign-in, checked by Supabase Auth (SEC-06).
- **Client routing is for navigation only.**

Known limits, to be aware of:

- The idle lock (AUTH-05) asks for the password. A staff PIN is not used.
- The device tag in audit logs is reported by the client, so it is a label, not proof.
  Devices cannot be signed out one at a time.
- A deactivated account cannot be turned back on from the app yet.
- The idle time is fixed at 15 minutes until the settings screen (SYS-01) exists.
- There is no self-service "forgot password": the Owner makes a reset link.
- A device that is offline learns about a deactivation when it is back online; the server
  refuses it at once either way.

## Design system

Tokens come from the Claude Design project ("Organic"): `apps/web/src/styles/index.css` holds
the colors, ramps, type, spacing, radii and shadows as CSS variables, which are also the
Tailwind theme (`bg-accent-200`, `text-neutral-700`, `font-heading`, `shadow-lg`). Dark mode
follows the device; set `data-theme="light"` or `"dark"` on `<html>` to force one. In this
project `accent` is the terracotta brand color, not shadcn's hover tint, so check that class
when adding shadcn components. Fonts (Caprasimo, Figtree) load from Google Fonts.

## First-time setup of a real project (manual)

Do this for `pos-staging` first, then `pos-prod`.

1. **Create the project** in region Southeast Asia (Singapore). `pos-prod` must be on a paid
   plan; turn the **spend cap** on and set usage alerts (NFR-10).
2. **Backups:** on `pos-prod`, confirm daily backups and enable **point-in-time recovery**
   (SYS-04, SEC-15). Rehearse one restore before launch.
3. **Authentication settings** (the hosted project does not read `supabase/config.toml`):
   - Sign In / Providers: Email on; **"Allow new users to sign up" off** (SEC-01);
     "Confirm email" on.
   - Password: minimum length **10**; **leaked-password protection** on (SEC-05).
   - Multi-Factor: **TOTP** enabled.
   - Attack Protection: **CAPTCHA** on with **Turnstile** and the site's secret key (SEC-06).
   - Rate Limits: lower the sign-in and token-verification limits from the defaults.
   - URL Configuration: Site URL = the app's address; Redirect URLs = `<app address>/set-password`.
4. **API settings:** expose only the `public` schema (SEC-07).
5. **Turnstile:** in Cloudflare create a Turnstile widget for the app's domains. The site key
   is `VITE_TURNSTILE_SITE_KEY`; the secret key goes into the Supabase CAPTCHA setting.
6. **Deploy** the database and function (see below).
7. **Vercel:** import the repository; `vercel.json` sets the build and headers. Add
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`, `VITE_STORE_NAME`
   and `VITE_STORE_ADDRESS` per environment (staging values for Preview, production values
   for Production). Never add the service role key or database password to Vercel.
8. **Create the first Owner** (SEC-03), from your own machine:
   ```powershell
   $env:SUPABASE_URL = "https://<project-ref>.supabase.co"
   $env:SUPABASE_SERVICE_ROLE_KEY = Read-Host "Service role key"
   npm run bootstrap-owner -- --email <owner email> --name "<name>" --code <2-6 letters> --store "<store name>" --app-url https://<app address>
   ```
   The key is read from that terminal's environment only; do not put it in a file. Send the
   printed link to the Owner only. They set a password, sign in, and turn on two-step sign-in
   when asked. The script refuses to run if an Owner already exists. **After the production
   Owner exists, delete `scripts/bootstrap-owner.ts` and the `bootstrap-owner` npm script,**
   and close the terminal.
9. **Check:** `curl -I https://<app address>/` shows `Content-Security-Policy`,
   `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options` and
   `Referrer-Policy` (SEC-12). The Supabase **Security Advisor** shows no warnings, and a
   read with only the anon key from outside the app returns nothing (SEC-16).

## Deploying

GitHub Actions applies migrations with `supabase db push` and deploys the Edge Function with
`supabase functions deploy`. Vercel deploys the frontend from the same branches.

- push to `dev` deploys to staging
- a `v*` tag on `main` deploys to production, after a reviewer approves it

Deploys are **off** until the repository variable `DEPLOY_ENABLED` is set to `true`; until
then the workflow is skipped.

One-time setup: in GitHub > Settings > Environments create `staging` and `production`, add
the variables and secrets listed at the top of
[.github/workflows/deploy.yml](.github/workflows/deploy.yml), and **require a reviewer on
`production`**. The service role key is not needed for deploys; do not store it in GitHub
(SEC-10).

**Free plan.** While the projects are on the Supabase Free plan,
[.github/workflows/heartbeat.yml](.github/workflows/heartbeat.yml) sends each one a request a
day so it is not paused for inactivity. It needs no secrets, only the four public repository
variables listed at its top, and it runs only once it is on the default branch.

Repository and account settings (SEC-10, SEC-11): keep the repo private; protect `main`
(pull request review and the CI check required); turn on secret scanning with push
protection and Dependabot alerts; use two-factor on the Supabase, GitHub and Vercel
accounts; only the Owner is an owner of the Supabase organization.

## Branching

Feature branches > pull request into `dev` > release pull request into `main` (SRS 7.3).
Commits follow Conventional Commits.
