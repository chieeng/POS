# Release notes

What each production release changes for the store, in plain words. The release pull request
(`dev` to `main`) copies its section. How to release is in [GO-LIVE.md](GO-LIVE.md),
"Release".

## v1.4.0: selling, cash drawer, returns and attendance (planned Fri Nov 28, 2026)

Production is on v1.3.0 (build steps 0 to 5: sign-in, users, settings, products, approvals,
stock-in, photos and CSV export). v1.4.0 adds build steps 7 to 11 and the new look. It is the
first release with selling.

### What the store gets

- **The new look** ("price card and peso note"): grey page, black text, bold peso amounts, in
  light and dark mode. Lime marks only the money buttons: Pay, Complete sale, Open drawer and
  Close drawer.
- **Installable app** (step 7): staff add the app to the phone's home screen. Products and
  prices are kept on the phone, so searching works offline.
- **Cash drawer** (step 8): open the drawer with the opening cash (a reason when it differs
  from the last count); cash in and cash out with a reason; a blind count by peso note and coin
  (P1,000 down to P1) to close; only the Owner or Special Sales close, only the Owner reopens,
  with a reason. A drawer forgotten open is closed as "not counted" the next day, or counted
  later ("Counted later") before the new drawer opens. Drawer report on laptop and phone.
- **Selling** (step 9): search, cart, kg and L to 3 decimals, cash (rounded to the peso, with a
  Rounding line), GCash and Maya with their reference, split payments, a digital slip (not an
  official receipt), preset discounts and package deals set by the Owner. Sales made offline
  wait on the phone and are sent when the connection is back; staff can't sign out while sales
  are unsent. A sale that arrives after its drawer closed joins the next drawer and is flagged.
- **Sales history, voids and returns** (step 10): look up past sales; void a sale while its
  drawer is open (the Owner approves or voids directly); returns and refunds after that, within
  the return window (Owner setting, 30 days by default), refunding the share actually paid;
  GCash and Maya refunds are sent by the Owner outside the app with a reference; damaged
  returns are written off at cost. Every void and return is in the audit log, the drawer report
  and its CSV.
- **Attendance** (step 11): staff clock in and out once a day on their own phone at the store
  (location checked within the set radius; a weak GPS reading is allowed but flagged); taps made
  offline are sent later, and a tap more than 24 hours old is refused and fixed by request.
  Staff clock in before their first sale. Late, half days, early out and overtime minutes are
  worked out by the server from the Owner's settings. Staff ask the Owner to fix a day; the
  Owner fixes days directly, marks Absent or Rest day, and sets each person's rest day. The
  Owner's Attendance page: Today, History, Summary and CSV. Pay is worked out later, in payroll
  (step 14).
- **A reliable Online/Offline badge**: the app checks that the internet really answers, not only
  that Wi-Fi is connected.

### What changes in production when it is released

- The database gets every migration since v1.3.0 (about 22 files: drawer, sales, returns,
  attendance and their settings). They only add tables, columns and functions; existing
  products, users and settings are kept.
- New settings start at their defaults until the Owner sets them (production setup in
  [GO-LIVE.md](GO-LIVE.md)): return window 30 days, attendance times 8:00 AM to 6:00 PM with a
  15-minute grace and no late deduction, VAT off, cash rounding on, no GCash/Maya accounts, no
  discounts or deals, and no store location (clock-ins are allowed but marked "store location
  not set" until it is set from a phone inside the store).
- Phones and laptops that already opened the app show an "update" banner; staff tap it once.

### Not in this release (after go-live)

Sale corrections and the archive of old sales, then build steps 12 (utang), 13 (dashboard and
reports), 14 (payroll) and 15 (polish, held sales, physical count, CSV import). Push
notifications (step 6) were dropped.

### Known and left as is

- The auto-close audit line says "was never counted" even after a reopen (on the polish list).
- Small wording and look findings are collected in [POLISH.md](POLISH.md) for step 15.
