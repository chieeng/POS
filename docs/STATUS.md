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
| Release notes         | [RELEASE-NOTES.md](RELEASE-NOTES.md) (v1.4.0, release proposed Thu Dec 3)        |
| Plan after go-live    | [PLAN-AFTER-GO-LIVE.md](PLAN-AFTER-GO-LIVE.md) (with the owner's open questions) |
| Backups, restore      | [RESTORE.md](RESTORE.md)                                                         |
| Polish list           | [POLISH.md](POLISH.md) (build step 15)                                           |
| Design (HOW it looks) | The approved canvas; its link is only in the private CLAUDE.local.md             |

## Build steps (SRS 8, "Build order")

| Step | What                                                               | State                                                         |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| 1-4  | Settings, catalog, approvals, stock-in                             | Done, in production (v1.3.0)                                  |
| 5    | Product photos, CSV export                                         | Done, in production (v1.3.0)                                  |
| 6    | Push notifications                                                 | Dropped (Oct 31, 2026)                                        |
| 7    | Installable app, offline product list                              | Done on staging, not released                                 |
| 8    | Cash drawer (blind count, auto-close, overnight count)             | Done on staging, not released                                 |
| 9    | Checkout, offline outbox, payments, slip, discounts, package deals | Done on staging, not released                                 |
| 10   | Voids, returns, refunds, damaged items, drawer report lines        | Done and tested on staging                                    |
| 11   | Attendance (#108-#113, #115, #124-#125; #110 drawer report fix)    | Tested Nov 27 (A-F pass); fixes pull request and re-test next |
| -    | New look "price card and peso note" (#92 and fixes)                | Done on staging                                               |
| 12   | Customer credit (utang)                                            | After go-live                                                 |
| 13   | Owner dashboard and reports                                        | After go-live                                                 |
| 14   | Payroll (computed pay, overtime pay)                               | After go-live                                                 |
| 15   | Polish: held sales, physical count, CSV import, the POLISH.md list | After go-live                                                 |

Also after go-live, before step 12: **sale corrections** and the **archive of old sales**
(SRS 7.1; the archive by the end of January 2027), both the owner's decision of Nov 19, 2026.

## Open pull requests (Nov 23, 2026)

| PR   | What                                                    | When to merge                                                                            |
| ---- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| #127 | Design: one tag and "+N" on attendance rows             | The design session merges it first (owner tests)                                         |
| #130 | One source for the late deduction (board, Summary, CSV) | Now, before the release (the owner, Nov 27); then the design session finishes #129 on it |
| #129 | Design: Owner Today, one summary line and "Needs you"   | After #130 (owner tests); then the design Sell cleanup                                   |
| #119 | Dependabot: @hookform/resolvers 7.0.7 (the forms)       | After the switch (Dec 14), then check sign-in and settings forms                         |
| #117 | Dependabot: dev-tooling group (tests and lint only)     | After the release (Dec 3)                                                                |
| #118 | Dependabot: @testing-library/jest-dom 8 (tests only)    | After the release (Dec 3)                                                                |
| #116 | Dependabot: runtime group (supabase-js, router, icons)  | After the switch (Dec 14)                                                                |
| #120 | Dependabot: Supabase CLI 3.2.0                          | HOLD until backup and deploy are tested with it                                          |

The Dependabot ones change the same lock file: one at a time, green before the next; the
others may need a rebase. #99 and #101 were closed by Dependabot (replaced by #119 and #120).

**Release freeze:** until the switch on Mon Dec 14 (moved Nov 27), `dev` only takes work for the v1.4.0 release; the design cleanup (#127, #129, Sell) and #130 are part of it (the owner, Nov 27)
(fixes, docs, Dependabot on its dates). Post-go-live features wait on their own pull requests.

The design session's cleanup pull requests (#127, #129, then Sell) go in before the release, one
at a time, each tested by the owner; #129 needs #130.

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

The owner's new order of Nov 27, 2026 (the design cleanup goes in before the release); dates
proposed in [GO-LIVE.md](GO-LIVE.md):

1. **Design cleanup, one at a time, each tested by the owner (Nov 27 - 30):** the design session
   merges #127; Claude merges #130 (the freeze is lifted for it); the design session then
   merges #129 (it needs #130), then its Sell cleanup.
2. **Tue Dec 1:** the owner finishes the step 11 re-test of #132 (checks 5-7; 1-4 passed Nov 27) and writes "step 11 test finished".
3. **Wed Dec 2: restore rehearsal on staging** ([RESTORE.md](RESTORE.md)), never before step 2:
   staging keeps the test data until then.
4. **Thu Dec 3: release** steps 7-11 and the new look ([GO-LIVE.md](GO-LIVE.md), "Release"; notes
   in [RELEASE-NOTES.md](RELEASE-NOTES.md)). Claude opens the `dev` to `main` pull request; the
   owner merges, tags and approves.
5. **Dec 3 - 4: production setup** ([GO-LIVE.md](GO-LIVE.md)), with the location check at the shop.
6. **Trial week Mon Dec 7 - Sun Dec 13**, beside the store's current method.
7. **Switch Mon Dec 14.** Dates may move after the store-owner demo.
8. After go-live: sale corrections, the archive of old sales, then steps 12 to 15.

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
