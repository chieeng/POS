# POS project: instructions for Claude

At the start of every session: read this file and docs/STATUS.md (where things stand, what
comes next), docs/SRS.md (at least sections 7.1, 7.2 and 8, plus the requirements for the
current step), then confirm the state with `git log origin/dev` and `gh pr list` before doing
anything (they win over STATUS.md). Read the design file before any screen work.

## Docs that hold the state

- `docs/STATUS.md`: what is built, open PRs, decisions waiting to be built, what comes next and
  the dates. Update it in every PR that changes any of these.
- `docs/SRS.md`: WHAT the app does, every decision the owner made, and the build order (SRS 8).
- `docs/GO-LIVE.md`: dates, release steps, production setup, trial and switch.
- `docs/RESTORE.md`: backups, restoring, and the restore rehearsal on staging.
- `docs/POLISH.md`: the step 15 polish list.
- `CLAUDE.local.md` (private, never committed): the design canvas link and the old design
  project's link and ID. Those links exist nowhere else.

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
- The design canvas decides HOW it looks: layout, components, colours, wording style. Since
  Nov 13, 2026 that is the approved "price card and peso note" canvas (SRS 7.2); the old
  Organic design project is kept only as the record of what each screen holds.
- Lime is for money actions only (the `money` button: Pay, Complete sale, Open drawer, Close
  drawer). Every other main action is ink (`primary`).
- A feature the design shows but the SRS doesn't have is not built (design-only features are
  listed in SRS 7.2).
- When the design implements one of our features differently from the SRS (behaviour, role,
  rule), follow the SRS and keep the design's look. List each difference in the PR; ask the
  owner only when it involves money or daily workflow.
- Every screen built or changed follows its canvas board and uses `components/ui` with the
  SRS 7.2 standard values and design tokens only (Tailwind's default colours don't exist in
  this theme). If a screen has no board yet, follow the drawn screens and say where you
  guessed.
- Read the screen's canvas board (and the navigation boards) before any screen work. Where the
  canvas and the old project are, and how to reach them, is in CLAUDE.local.md. Only change the
  canvas when the owner asks for a design change; the old Organic project is READ ONLY.

## Way of working

- Don't ask questions one at a time. Take your recommended option and list it under
  "Decisions I made" in the PR.
- Stop and ask (all of a step's questions in ONE message) only when a decision involves money,
  prices, discounts, cash, utang, payroll or receipts/BIR; could lose or expose data or can't be
  undone; would cost money or approach a Free-plan limit; changes how staff or the Owner work
  day to day; or differs from the SRS or the design file.
- Small PRs, all into `dev`, each on a new branch from `origin/dev`. Never stack on unmerged
  PRs. When two PRs conflict, rebase the second after the first merges. After each PR, merge
  it when "Autonomous mode" below allows, or say "ready to merge #N", then start the next.
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

- Small wording or polish findings (no effect on money, stock or security) go to
  `docs/POLISH.md` for step 15, after go-live, instead of their own PR (the owner's rule of
  Nov 21, 2026). Findings that touch money, stock or security are still fixed before go-live.
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

- Hand-offs use simple, plain words: the owner and the reviewer are not developers.
- Every hand-off (Test, Re-test, Reviewer) is written as ONE paste-ready prompt addressed to
  the reviewer: who they are and their job ("You are reviewing… guide me, the owner…"), the
  background, the PRs, the steps in order, the checks with expected results, what is known
  and expected, and what to report back (pass or fail per check, plus a short message for the
  developer). One prompt may carry both the reviewer and the test parts.
- Two Claude sessions work on this repo: the "POS project continuation" session builds the
  system (the build order, features, database, behaviour); the design session does design
  changes and design fixes only (tokens, components' look, restyling screens to their canvas
  boards). Each keeps to its own part, works in its own git worktree, and branches from
  `origin/dev`. The main folder stays on an old branch; leave it. One local Supabase (Docker) is
  shared by the worktrees: if `db reset` fails or tables are missing, the other session may be
  resetting; wait and retry.
- One small PR at a time. Pace: don't start a new PR while 2 or more of Claude's PRs (from
  either session; Dependabot doesn't count) are waiting to be merged. Stop, give the reviewer
  hand-off, and wait for the owner.
- Releases: Claude opens the release PR from `dev` to `main`; the owner merges it, creates the
  `v*` tag and approves the production deploy (docs/GO-LIVE.md, "Release").

## Autonomous mode (the owner's rule of Nov 23, 2026)

Claude goes from task to task by itself and merges into `dev` (never `main`):

- **Claude may merge its own PR into `dev`** when CI is green, the PR is small and one topic,
  Claude tested it, and CLAUDE.md, docs/STATUS.md and its PR table are up to date. Rebase on the
  latest `dev` first. CI failing at "Start local Supabase" with "port 54322 already in use":
  re-run the failed jobs once. The design session also merges its look-only PRs; when both
  touch the same file, the build session's PR goes first and the design PR rebases.
- **A PR the owner said to hold** (for example "merge after part E") waits for their word.
- **Dependabot** is merged by Claude on the dates in docs/STATUS.md, one at a time, green
  before the next. Claude checks what it can after each; the reviewer checks what needs the
  owner's sign-in.
- **Release freeze:** the release takes all of `dev`. Until the switch (Mon Dec 21, 2026, proposed Nov 27), `dev` only
  takes work meant for that release (fixes, docs, Dependabot on its dates). Post-go-live
  features are built on their own branches and their PRs stay open until after the switch, so
  a trial-week fix can still be released alone.
- **Always stop and ask** (collect every question into ONE Reviewer hand-off, never one by one):
  - anything on `main` or production: merging `dev` to `main`, tags, approving the production
    Deploy, `GO_LIVE`, production data or settings;
  - anything that wipes or bulk-changes staging data (restore rehearsal, reseeds, destructive
    migrations): staging holds the owner's test data until they say a test is finished;
  - the Supabase CLI 3 update (#120): backups and deploy are tested with it first, and Claude
    gives the test plan before testing;
  - anything that costs money or leaves the Supabase Free plan or Cloudflare's free tier;
  - business or legal rules the SRS doesn't decide (utang terms, payroll rates, overtime pay,
    Senior/PWD discounts, VAT, flat late fines): they wait for the store-owner demo and the
    accountant. Claude builds what the SRS decides, keeps a list of open questions, and goes
    on with other parts;
  - any change to money, stock or audit logging beyond what the SRS says;
  - anything that needs the owner's sign-in, 2-step code, secrets or presence in the store;
  - a failing test Claude can't explain.
- The owner's reviewer still checks everything that needs the owner's sign-in.
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
- Never push to `main`. No tags or releases. Never merge into `main` (the owner does). PRs into
  `dev` are merged as in "Autonomous mode" above.
- The repo is PUBLIC: scan every diff for secrets, private IDs and private links. Never commit
  `.claude/skills` or CLAUDE.local.md. The Claude Design link and project ID live only in
  CLAUDE.local.md: never in the repo, a commit, a PR, a log or a hand-off.
- Never ask the owner to paste passwords, tokens, the service role key, the database password
  or secret keys; ask yes/no instead. New secrets go only into Supabase or GitHub secrets, with
  exact click steps for the owner.
- React 18 (not 19), TypeScript 6 (not 7). Prefer npm versions at least two weeks old. Match
  the surrounding code; add tests where behaviour changes.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- PR descriptions end with:
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
