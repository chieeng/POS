# Where the project stands

The current state, so a new Claude session (or a new developer) can carry on without the chat
history. **Update this file in every PR that changes the state** (a step done, a decision
made, a date moved). Confirm it against `git log origin/dev` and `gh pr list` before acting:
those win when they disagree with this file.

Last updated: Nov 23, 2026.

## Who does what

- **The owner** (of this repository) decides, merges into `main`, creates release tags and
  approves production deploys. They test each step on staging with a separate reviewer,
  who can't see the repository or the chat (see the hand-off rules in CLAUDE.md).
- **The store owner** runs the store and uses the app as the Owner role. The owner demos the
  app to them; dates after the demo may move.
- **Claude** builds in small pull requests into `dev` and, since Nov 23, 2026, merges its own
  and Dependabot's into `dev` (CLAUDE.md, "Autonomous mode"). Never `main`, tags or releases.

## Places

| What                  | Where                                                                            |
| --------------------- | -------------------------------------------------------------------------------- |
| Repository            | `chieeng/POS` (public). `dev` = staging, `main` = production                     |
| Staging               | https://dev.pos-duz.pages.dev (Supabase project `pos-staging`)                   |
| Production            | https://pos-duz.pages.dev (Supabase project `pos-prod`), at v1.3.0 (steps 0-5)   |
| Requirements          | [SRS.md](SRS.md) (WHAT the app does)                                             |
| Go-live checklist     | [GO-LIVE.md](GO-LIVE.md)                                                         |
| Release notes         | [RELEASE-NOTES.md](RELEASE-NOTES.md) (v1.4.0, release about Nov 30)              |
| Plan after go-live    | [PLAN-AFTER-GO-LIVE.md](PLAN-AFTER-GO-LIVE.md) (with the owner's open questions) |
| Backups, restore      | [RESTORE.md](RESTORE.md)                                                         |
| Polish list           | [POLISH.md](POLISH.md) (build step 15)                                           |
| Design (HOW it looks) | The approved canvas; its link is only in the private CLAUDE.local.md             |

## Build steps (SRS 8, "Build order")

| Step | What                                                               | State                            |
| ---- | ------------------------------------------------------------------ | -------------------------------- |
| 1-4  | Settings, catalog, approvals, stock-in                             | Done, in production (v1.3.0)     |
| 5    | Product photos, CSV export                                         | Done, in production (v1.3.0)     |
| 6    | Push notifications                                                 | Dropped (Oct 31, 2026)           |
| 7    | Installable app, offline product list                              | Done on staging, not released    |
| 8    | Cash drawer (blind count, auto-close, overnight count)             | Done on staging, not released    |
| 9    | Checkout, offline outbox, payments, slip, discounts, package deals | Done on staging, not released    |
| 10   | Voids, returns, refunds, damaged items, drawer report lines        | Done and tested on staging       |
| 11   | Attendance (#108-#113, #115; #110 drawer report fix)               | Merged; staging test in progress |
| -    | New look "price card and peso note" (#92 and fixes)                | Done on staging                  |
| 12   | Customer credit (utang)                                            | After go-live                    |
| 13   | Owner dashboard and reports                                        | After go-live                    |
| 14   | Payroll (computed pay, overtime pay)                               | After go-live                    |
| 15   | Polish: held sales, physical count, CSV import, the POLISH.md list | After go-live                    |

Also after go-live, before step 12: **sale corrections** and the **archive of old sales**
(SRS 7.1; the archive by the end of January 2027), both the owner's decision of Nov 19, 2026.

## Open pull requests (Nov 23, 2026)

| PR   | What                                                    | When to merge                                                                                                                                                                        |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #130 | One source for the late deduction (board, Summary, CSV) | Into `dev` after the release (about Nov 30); no release of its own: it reaches production with the next release that is needed anyway. Then tell the design side (#129 waits for it) |
| #100 | Dependabot: jsdom 31.0.1 (tests only)                   | From Nov 27, after the step 11 fixes pull request                                                                                                                                    |
| #119 | Dependabot: @hookform/resolvers 7.0.7 (the forms)       | After the switch (Dec 9), then check sign-in and settings forms                                                                                                                      |
| #117 | Dependabot: dev-tooling group (tests and lint only)     | From Dec 4                                                                                                                                                                           |
| #118 | Dependabot: @testing-library/jest-dom 8 (tests only)    | From Dec 4                                                                                                                                                                           |
| #116 | Dependabot: runtime group (supabase-js, router, icons)  | After the switch (Dec 9)                                                                                                                                                             |
| #120 | Dependabot: Supabase CLI 3.2.0                          | HOLD until backup and deploy are tested with it                                                                                                                                      |

The Dependabot ones change the same lock file: one at a time, green before the next; the
others may need a rebase. #99 and #101 were closed by Dependabot (replaced by #119 and #120).

**Release freeze:** until the switch on Wed Dec 9 (moved from Dec 7 on Nov 26), `dev` only takes work for the v1.4.0 release
(fixes, docs, Dependabot on its dates). Post-go-live features wait on their own pull requests.

The design session's cleanup pull requests (#127, #129) are not merged before the release
(about Nov 30); #129 also waits for #130.

## Step 11: the owner's answers of Nov 23, 2026 (built in #115)

The owner accepted every recommendation. These are in SRS ATT-01, ATT-11, ATT-12 and ATT-14,
and D to H were built in #115:

- **D.** A clock tap saved offline more than 24 hours earlier is refused (it would land on the
  wrong day). The phone keeps it as "needs attention", the Owner sees it in the audit log, and
  the day is fixed by a fix request.
- **E.** A fix (request, approval or the Owner's direct fix) with a time that hasn't happened
  yet is refused.
- **F.** A person marked Absent or Rest day today can still clock in: the time in replaces the
  mark, and the audit log keeps the mark.
- **G.** A time out with no time in that day closes yesterday's day only before 4:00 AM (as
  built in #112).
- **H.** After midnight the clock shows Clock in, not Clock out; a forgotten time out is fixed
  by a fix request (the store closes at 6:00 PM).
- **I.** Kept as built in #113: no "Absent" before attendance began or for an inactive account;
  today's usual rest day also applies to past days; computed pay waits for payroll (step 14).

Days already recorded are not recalculated by these fixes. Production has no attendance data
yet.

## Next, in order

1. **Step 11, in this order (the owner's order of Nov 25, with the fallback dates of Nov 26):**
   **Fri Nov 27** part F in the store → the owner's full step 11 report → one small fixes pull
   request the same day (with the per-person absent rule, Q-ATT-1, already on its branch) →
   **Sat Nov 28 - Sun Nov 29** the owner's re-test → the owner writes "step 11 test finished".
   The re-test needs today's staging test data (the Nov 19 mark, Test Two's days), so nothing
   resets staging before it.
2. **Restore rehearsal on staging** ([RESTORE.md](RESTORE.md)), only after "step 11 test
   finished" (Nov 28-29).
3. **Release about Mon Nov 30**, once the re-test, "step 11 test finished" and the restore
   rehearsal are done: steps 7-11 and the new look go to production ([GO-LIVE.md](GO-LIVE.md),
   "Release"; notes in [RELEASE-NOTES.md](RELEASE-NOTES.md)). Claude opens the `dev` to `main`
   pull request; the owner merges, tags and approves.
4. **Production setup Nov 30 - Dec 1** ([GO-LIVE.md](GO-LIVE.md)), including the real store
   location set from a phone inside the store.
5. **Trial week from Wed Dec 2**, beside the store's current method.
6. **Switch Wed Dec 9** (the fallback dates, chosen Nov 26; dates may move after the store-owner
   demo).
7. After go-live: sale corrections, the archive of old sales, then steps 12 to 15.

## Answered: Q-ATT-1 (Nov 25, 2026)

"Absent · no time in" counts from each person's own first clock-in, not from the store's
first record; an Owner's mark shows on its day but never moves anyone's start (SRS ATT-14).
Built on the branch for the part F fixes pull request.

## Other open items

- **Design copy before Dec 14, 2026**, when standalone Claude Design closes: the canvas boards
  are saved locally; the old Organic project's files are 3 of 17 saved (next Payroll, Stock-in,
  then the rest and its design system). The local copy is in the git-ignored `.design-local/`.
- **Before go-live, for the owner:** Senior citizen and PWD discounts, and VAT, with the store's
  accountant (SRS 8, open questions). The store's product list (about 100 products) is entered
  by hand.
- **Known and left as is:** the auto-close audit line says "was never counted" even after a
  reopen (on the polish list).
