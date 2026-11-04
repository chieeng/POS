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
  "ready to merge #N", then start the next.
- Before EVERY PR, re-read the SRS sections for that PR and its design file; don't rely on
  memory from earlier in the session.
- Every PR description lists the SRS sections and the design files read for it.
- Decisions the owner makes in chat go into docs/SRS.md (or into this file if it is a working
  rule) in the next PR, never only in the chat.
- When a rule changes, update this file in the same PR.
- ONE click-only test checklist at the end of each step: phone and laptop, every role
  (including Special Sales), light and dark. If a command is truly needed, give the exact
  PowerShell command and what the owner should see.
- The Owner signs in with TOTP, so Owner flows can't be tested locally; the owner checks them
  on staging.
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
