# Go-live checklist

The steps to take the app from staging to the store, in order. No secrets, links to private
projects or passwords belong in this file (the repository is public).

## Before the release (staging)

- [ ] Every step up to step 11 tested on staging.
- [ ] Restore rehearsal done on staging (see [RESTORE.md](RESTORE.md), "Restore rehearsal on
      staging").
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

## Release

- [ ] The developer opens the release pull request from `dev` to `main`; the Owner merges it,
      creates the version tag and approves the production deploy.

## Production setup (in this order)

1. [ ] The Owner's account, and its authenticator code.
2. [ ] Settings > Store: details, VAT, cash rounding, return window, GCash/Maya accounts,
       discounts and deals.
3. [ ] Settings > Attendance: times, grace and deductions.
4. [ ] **Store location, set from a phone standing inside the store** with GPS on (Settings >
       Store, "Use my current location"). A laptop's location comes from Wi-Fi and can be far
       off. Radius 100 m unless the store needs more.
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
