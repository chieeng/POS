# Where the project stands

The current state, so a new Claude session (or a new developer) can carry on without the chat
history. **Update this file in every PR that changes the state** (a step done, a decision
made, a date moved). Confirm it against `git log origin/dev` and `gh pr list` before acting:
those win when they disagree with this file.

Last updated: Nov 27, 2026.

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
| Release notes         | [RELEASE-NOTES.md](RELEASE-NOTES.md) (v1.4.0, release Thu Dec 10, proposed)      |
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

| PR   | What                                                   | When to merge                                                    |
| ---- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| #119 | Dependabot: @hookform/resolvers 7.0.7 (the forms)      | After the switch (Dec 21), then check sign-in and settings forms |
| #117 | Dependabot: dev-tooling group (tests and lint only)    | After the release (Dec 10)                                       |
| #118 | Dependabot: @testing-library/jest-dom 8 (tests only)   | After the release (Dec 10)                                       |
| #116 | Dependabot: runtime group (supabase-js, router, icons) | After the switch (Dec 21)                                        |
| #120 | Dependabot: Supabase CLI 3.2.0                         | HOLD until backup and deploy are tested with it                  |

The Dependabot ones change the same lock file: one at a time, green before the next; the
others may need a rebase. #99 and #101 were closed by Dependabot (replaced by #119 and #120).

**Release freeze:** until the switch (Mon Dec 21, proposed Nov 27), `dev` only takes work for
the v1.4.0 release (fixes, docs, Dependabot on its dates). The design's Round 3 is part of it
(the owner, Nov 27). Post-go-live features wait on their own pull requests.

The design session's Round 3 pull requests (every page: navigation, then Sell, cart, Pay and
slip, then the cash drawer, attendance and the rest) go in before the release, at most 2 open at
a time; the owner tests the Owner screens. The design session says "Round 3 done" when all are
merged.

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

**Round 3 approved (the owner, Nov 27, 2026):** #127, #130 and #129 are merged and on staging.
The design's Round 3 (a full UI update of every page) is built before the release, and the dates
move about one week. Claude proposed the dates below on Nov 27; **they wait for the owner's
yes** ([GO-LIVE.md](GO-LIVE.md)). Staging keeps its test data; **no restore rehearsal yet**.

1. **Round 3, Sat Nov 28 - Fri Dec 4:** the design session's small pull requests; the owner
   tests the Owner screens; the design session says "Round 3 done".
2. **Fri Dec 4: feature checklist.** After "Round 3 done", Claude gives the owner every SRS
   requirement against what is built: ID, short name, priority (Must / Should / Could), status
   (Built + tested by the owner / Built, not tested yet / Partly built / Not built / Moved to
   after go-live, with its step), and where to test it (screen and user). Then: the Must haves
   not fully done before go-live, the features in the app that are not in the SRS, and the open
   questions for the store owner or the accountant.
3. **Sat Dec 5 - Mon Dec 7:** the owner tests the checklist's "Built, not tested yet" items.
4. **Tue Dec 8:** the owner finishes the step 11 re-test of #132 (checks 5-7; 1-4 passed
   Nov 27) and writes "step 11 test finished".
5. **Tue Dec 8 - Wed Dec 9: the owner's demo to the store owner on staging**, after Round 3 and
   before the release; their answers go into production setup (questions below).
6. **Wed Dec 9: restore rehearsal on staging** ([RESTORE.md](RESTORE.md)), never before step 4
   ("step 11 test finished") and after the demo: staging keeps the test data until then.
7. **Thu Dec 10: release** steps 7-11 and the new look ([GO-LIVE.md](GO-LIVE.md), "Release";
   notes in [RELEASE-NOTES.md](RELEASE-NOTES.md)). Claude opens the `dev` to `main` pull
   request; the owner merges, tags and approves.
8. **Dec 10 - 11: production setup** ([GO-LIVE.md](GO-LIVE.md)), with the location check at the
   shop.
9. **Trial week Mon Dec 14 - Sun Dec 20**, beside the store's current method.
10. **Switch Mon Dec 21** (the week before Christmas; if it slips again, after New Year).
11. After go-live: sale corrections, the archive of old sales (by the end of January 2027), then
    steps 12 to 15.

## Answered: Q-ATT-1 (Nov 25, 2026)

"Absent · no time in" counts from each person's own first clock-in, not from the store's
first record; an Owner's mark shows on its day but never moves anyone's start (SRS ATT-14).
Built in #132 (merged Nov 27).

## Questions for the store-owner demo (Dec 8 - 9, proposed)

Their answers go into production setup ([GO-LIVE.md](GO-LIVE.md)) or the plan after go-live:

- Shift times and the late rule (latest time in, grace, late deduction: none, minutes or flat).
- Who approves requests when the Owner can't be reached.
- Payroll: P1 overtime pay (paid or not, at what rate) and P7 overtime only on a whole day
  (recommended); daily rates; holiday pay ([PLAN-AFTER-GO-LIVE.md](PLAN-AFTER-GO-LIVE.md), step 14).
- Items sold in two units (per piece and per pack): two products for now.
- Utang terms U1 to U6 ([PLAN-AFTER-GO-LIVE.md](PLAN-AFTER-GO-LIVE.md), step 12).
- With the accountant: Senior citizen and PWD discounts, VAT, and whether unofficial slips are
  enough.

## Other open items

- **Design copy before Dec 14, 2026**, when standalone Claude Design closes: done Nov 27 (the
  canvas boards and all 17 old Organic files with their design system), in the git-ignored
  `.design-local/`.
- **Before go-live, for the owner:** Senior citizen and PWD discounts, and VAT, with the store's
  accountant (SRS 8, open questions). The store's product list (about 100 products) is entered
  by hand.
- **Known and left as is:** the auto-close audit line says "was never counted" even after a
  reopen (on the polish list).
