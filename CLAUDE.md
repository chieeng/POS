# POS project: instructions for Claude

At the start of every session: read docs/SRS.md (at least sections 7.1, 7.2 and 8, plus the
requirements for the current step), then check `git log origin/dev` and `gh pr list` to see
where things stand. Read the design file before any screen work.

After a compaction, or whenever unsure, re-read this file, docs/SRS.md and the design file
before continuing.

## The project

POS and inventory web app for one retail store, about 20 users on their own phones and
laptops. Roles: owner, special_sales, sales.

- apps/web: React 18 + Vite, TypeScript 6, Tailwind v4, shadcn/ui-style Radix components in
  `components/ui`, Zustand, Vitest + jsdom, Dexie.
- Supabase (Free plan): staging follows `dev`, production follows `main`. Migrations in
  `supabase/migrations`, pgTAP tests in `supabase/tests`, Edge Function
  `supabase/functions/admin-users`.
- Hosting on Cloudflare Pages. GitHub Actions: `ci.yml`, `deploy.yml` (dev to staging; a
  `v*` tag to production with a required reviewer), `heartbeat.yml`, `backup.yml`.
- docs/SRS.md is the source of truth for WHAT the app does.

## Design rule

- The SRS decides WHAT the app does: behaviour, rules, permissions, money.
- The Claude Design file decides HOW it looks: layout, components, colours, wording style.
- A feature the design shows but the SRS doesn't have is not built (design-only features are
  listed in SRS 7.2).
- When the design implements one of our features differently from the SRS (behaviour, role,
  rule), follow the SRS and keep the design's look. List each difference in the PR; ask the
  owner only when it involves money or daily workflow.
- Every screen built or changed follows its design file and uses `components/ui` with the
  SRS 7.2 standard values and design tokens only (Tailwind's default colours don't exist in
  this theme). If a screen has no design file, follow the existing Organic components and say
  where you guessed.
- Read the screen's design file (and Nav for navigation) before any screen work. The design
  project is READ ONLY: never edit it. Where it is and how to reach it is in CLAUDE.local.md.

## Way of working

- Don't ask questions one at a time. Take your recommended option and list it under
  "Decisions I made" in the PR.
- Stop and ask (all of a step's questions in ONE message) only when a decision involves money,
  prices, discounts, cash, utang, payroll or receipts/BIR; could lose or expose data or can't be
  undone; would cost money or approach a Free-plan limit; changes how staff or the Owner work
  day to day; or differs from the SRS or the design file.
- Small PRs, all into `dev`, each on a new branch from `origin/dev`. Never stack on unmerged
  PRs. When two PRs conflict, rebase the second after the first merges. After each PR say
  "ready to merge #N", then start the next (unless the pace rule below says to wait).
- Before EVERY PR, re-read the SRS sections for that PR and its design file; don't rely on
  memory from earlier in the session.
- Every PR description lists the SRS sections and the design files read for it.
- Decisions the owner makes in chat go into docs/SRS.md (or into this file if it is a working
  rule) in the next PR, never only in the chat.
- When a rule changes, update this file in the same PR.
- The Owner signs in with TOTP, so Owner flows can't be tested locally; they are checked on
  staging.
- Testing hand-off: the owner tests with a separate reviewer, not with Claude. At the END of
  each step, and whenever a PR needs a check on staging before the next one, write ONE
  copy-paste block titled "Test hand-off: <step / PRs>" for the owner to send to the
  reviewer. Don't walk the owner through the test. The block covers every role (including
  Special Sales), phone and laptop, light and dark. It must stand on its own (the reviewer
  can't see the repo or the chat) and contain:
  1. What was built, in plain words, and which PRs (merged or not).
  2. Where to test: the staging URL (https://dev.pos-duz.pages.dev), and which data on staging
     to use or set up first (products, drawer state, test users by name: Owner on the laptop,
     Test Special 5 / Test Two on the phone).
  3. The checks in order, one per line: who, which device, what to do, and exactly what they
     should see (amounts, labels, wording).
  4. Money and blind-count checks spelled out with the expected numbers. Work every expected
     stock and cash number out again check by check before sending: anything the app refuses
     (a reused reference, too little cash) takes no stock and adds no cash.
  5. Offline checks (Airplane mode) where the step has offline behaviour.
  6. Anything Claude is unsure about or couldn't test itself (for example Owner screens), so
     the reviewer looks there first.
  7. Known limitations and things deliberately left out, so they aren't reported as bugs.
  8. Anything that must wait (for example next-day checks), with what to do the evening
     before.

  No secrets, passwords, one-time links, design link or project ID in the block. If a command
  is truly needed, give the exact PowerShell command and what should be seen.

- When the owner comes back with the reviewer's findings, fix them on ONE small PR from `dev`,
  say "ready to merge #N", and give a short "Re-test hand-off" block the same way.
- Reviewer hand-off after EVERY task: whenever Claude finishes something and needs the owner to
  act (a PR is ready, an answer is needed, a step is done, or something failed), the reply ends
  with ONE copy-paste block titled "Reviewer hand-off". The owner sends it to a separate
  reviewer who guides them and can't see the repo or the chat. It contains:
  1. What was just done, in plain words.
  2. Every open PR right now (from `gh pr list`), including Dependabot: number, title, ready or
     not, merge order, and any conflicts between them.
  3. What the owner should do next, in order (merge X, then Y, wait for green).
  4. What to check on staging after merging, with expected results, or "nothing to test yet;
     tested at the end of step N".
  5. Any question Claude is waiting on, with its recommendation.
  6. What Claude will do next once the owner has acted.

  No secrets, passwords, one-time links, design link or project ID in the block. At the end of
  a step, the hand-off includes the full "Test hand-off" checklist.

- Pace: don't start a new PR while 2 or more of Claude's PRs are waiting to be merged. Stop,
  give the reviewer hand-off, and wait for the owner.
- On this Windows setup long Bash heredocs break: write long files with the Write tool, and
  check that a failed command left no partial changes.

## Checks before each PR

- `npx supabase db reset`, then `npm run test:db`
- Vitest from inside `apps/web` (`npx vitest run`)
- `npm run lint` and `npm run typecheck` from the repo root
- `npx vite build` in `apps/web`
- New tables and functions are also added to `supabase/tests/010_schema.sql`.

## Ground rules

- Supabase Free plan only, permanently: database 500 MB, storage 1 GB, egress 5 + 5 GB a month,
  Realtime 200 connections and 2M messages a month, Edge Functions 500k calls a month. Check
  every design against these and flag anything close. Say so before anything that costs money
  or can't be undone.
- Never push to `main`. No tags or releases. Never merge PRs (the owner does).
- The repo is PUBLIC: scan every diff for secrets, private IDs and private links. Never commit
  `.claude/skills` or CLAUDE.local.md.
- Never ask the owner to paste passwords, tokens, the service role key, the database password
  or secret keys; ask yes/no instead. New secrets go only into Supabase or GitHub secrets, with
  exact click steps for the owner.
- React 18 (not 19), TypeScript 6 (not 7). Prefer npm versions at least two weeks old. Match
  the surrounding code; add tests where behaviour changes.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- PR descriptions end with:
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
