# Go-live checklist

The steps to take the app from staging to the store, in order. No secrets, links to private
projects or passwords belong in this file (the repository is public). Where the project stands
today is in [STATUS.md](STATUS.md).

## Dates (proposed Nov 27, 2026, one week later for the design's Round 3; waiting for the owner's yes)

| When                      | What                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Sat Nov 28 - Fri Dec 4    | The design's Round 3 (every page), small pull requests; the owner tests the Owner screens; then "Round 3 done" |
| Fri Dec 4                 | Claude gives the owner the feature checklist (every SRS requirement against what is built)                     |
| Sat Dec 5 - Mon Dec 7     | The owner tests the checklist's "Built, not tested yet" items                                                  |
| **Tue Dec 8**             | The rest of the step 11 re-test (#132 checks 5-7), then "step 11 test finished"                                |
| **Tue Dec 8 - Wed Dec 9** | **The demo to the store owner on staging**, after Round 3; their answers go into production setup              |
| Wed Dec 9                 | Restore rehearsal on staging (only after "step 11 test finished" and the demo)                                 |
| **Thu Dec 10**            | Release steps 7-11 and the new look to production                                                              |
| Dec 10 - Dec 11           | Production setup, with the location check at the shop                                                          |
| **Mon Dec 14**            | Trial week starts, beside the store's current method (Mon Dec 14 - Sun Dec 20)                                 |
| **Mon Dec 21**            | Switch                                                                                                         |

If something slips, each later date moves by the same number of days; the trial always runs a
full week before the switch. The switch falls in the week before Christmas; if it slips again,
the next switch date is proposed after New Year (Mon Jan 4, 2027) rather than Christmas week.

Earlier dates (confirmed Nov 27, replaced the same day by Round 3): demo Dec 1-2, release
Thu Dec 3, trial Mon Dec 7, switch Mon Dec 14.

## Before the release (staging)

- [x] The D-H attendance fixes merged (#115).
- [x] The offline indicator fix merged (#122, Nov 24, after step 11 test part E).
- [ ] Every step up to step 11 tested on staging, and the step 11 test's fixes merged.
- [ ] Restore rehearsal done on staging (see [RESTORE.md](RESTORE.md), "Restore rehearsal on
      staging"), when the owner says so, after the step 11 test. It goes back only to a backup
      taken minutes before, so only the rehearsal's own test change is undone.
- [ ] Dependabot: #100 (jsdom, tests only) merged from Nov 27, after the step 11 fixes; the others wait until after the
      release (dates in [STATUS.md](STATUS.md)); #120, the Supabase CLI 3, waits until backup
      and deploy are tested with it.
- [ ] Release notes up to date ([RELEASE-NOTES.md](RELEASE-NOTES.md), v1.4.0).
- [ ] Production sign-in settings checked: sign-ups off, confirm email on, password minimum 10,
      authenticator codes (TOTP) on, CAPTCHA on, sign-in rate limits lowered (README, "First-time
      setup of a real project").
- [ ] GitHub: the `production` environment requires approval; `backup-production` is filled in.
- [ ] Product sheet ready (about 100 rows): name, SKU, category, unit, selling price, cost,
      opening stock, reorder level.
- [ ] Staff list ready: name, email, role (Sales or Special Sales), 2 to 6 letter code, usual
      rest day.
- [ ] Store details ready: name, address, contact, TIN, receipt footer, VAT yes/no, GCash and
      Maya accounts (label and number), the discounts and deals the store runs.
- [ ] Senior citizen / PWD discounts and VAT checked with the store's accountant (SRS 8, open
      questions).

## Release

1. [ ] Claude opens the release pull request from `dev` to `main` (title like "Release v1.4.0:
       steps 7-11"), with the v1.4.0 section of [RELEASE-NOTES.md](RELEASE-NOTES.md). Claude
       never merges it.
2. [ ] The owner merges it once CI is green. Cloudflare Pages publishes `main` at once.
3. [ ] Right away, the owner creates the tag on `main`: GitHub > Releases > Draft a new release > tag `v1.4.0`, target `main` > Publish.
4. [ ] The owner approves the production deploy: GitHub > Actions > Deploy (the tag's run) >
       Review deployments > production > Approve. It applies the database migrations.
5. [ ] Check https://pos-duz.pages.dev: sign in as the Owner, open Settings and Sell.

Steps 3 and 4 follow step 2 straight away, so the new screens never run long against the old
database (README, "Release order").

## Production setup (in this order)

1. [ ] The Owner's account, and its authenticator code.
2. [ ] Settings > Store: details, VAT, cash rounding, return window, GCash/Maya accounts,
       discounts and deals.
3. [ ] Settings > Attendance: times, grace and deductions.
4. [ ] **Store location, set from a phone standing inside the store** with GPS on (Settings >
       Store, "Use my current location"). A laptop's location comes from Wi-Fi and can be far
       off. Radius 100 m unless the store needs more.
   - [ ] **Location check at the shop** (moved here from step 11 test part F, Nov 27, 2026): one
         staff clock-in from a phone **inside** the shop works with no location flag; one from
         **200 m or more away** is refused ("You're N m from the store..."), and nothing is
         recorded.
5. [ ] Staff accounts (each gets a one-time link to set a password), and their usual rest days.
6. [ ] Products, then the opening stock as a stock-in with costs.
7. [ ] **Each staff phone:** open the app, add it to the home screen, sign in, and on the first
       clock-in allow location **"Precise"** and **"Allow always / forever"** in the browser
       (Brave or Chrome asks once). Without precise location, clock-ins are flagged "location
       not verified". Do one test clock-in at the store.
8. [ ] The first manual production backup; then the repository variables `BACKUP_ENABLED` and
       `GO_LIVE` set to `true`.

## Trial week and switch

- [ ] One week running beside the store's current method, comparing stock, cash and
      attendance every day.
- [ ] Switch when the week matched.

## After go-live

Sale corrections, then the archive of old sales (by the end of January 2027), then build steps
12 to 15 (SRS 8).
