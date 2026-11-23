# Plan after go-live

The work after the switch (Mon Dec 7, 2026), in order: sale corrections, the archive of old
sales (by the end of January 2027), then build steps 12 to 15 (SRS 8). For each: what the SRS
already decides (built without asking), how it is split into pull requests, and the questions
only the owner can answer. Questions are never guessed: the parts that need them wait, and
the rest is built. Answers go into the SRS in the next pull request.

Until the switch, none of this is merged into `dev` (release freeze, CLAUDE.md).

## 1. Sale corrections (SRS POS-11, APPR-01, SHIFT-04, NFR-05)

**Decided by the SRS:** staff open a sale that was entered wrong, change items, quantities,
discount (a preset or deal only), payment method or customer, and send it to the Owner with a
reason; the Owner sees the original and the corrected sale side by side and approves or
rejects; the Owner can correct directly. Staff never type a price: the original lines keep
their price, added items take today's price. A higher total is collected, a lower one refunded
as a return (POS-10). The original sale is never edited: it is marked `corrected` and the new
sale points to it (`correction_of`). Every correction is audit-logged and on the drawer report
and its CSV.

**Pull requests:** (1) database: the correction request, approval and the new sale, with stock
movements for what changed; (2) the screens: "Correct this sale", the side-by-side approval,
My requests; (3) the drawer report and CSV lines.

**Questions for the owner (money):**

- C1. The difference collected or refunded: does it go into **today's** open drawer (as a
  return's refund does now)? Recommended: yes, today's drawer, and the report names the
  original sale.
- C2. How long after the sale can it be corrected: the return window (30 days by default), the
  sale's own drawer only, or another limit?
- C3. A sale that already had a return, or was corrected once: may it be corrected again?
  Recommended: one correction per sale, none after a return (then it's a return).
- C4. Changing the payment method (for example cash to GCash): the cash leaves the drawer and
  the GCash reference is typed; is that right, and who may do it (staff with approval, or the
  Owner only)?
- C5. "Customer" can be corrected only once credit customers exist (step 12). Recommended: the
  customer part comes with step 12.

## 2. Archive of old sales (SRS 7.1, "Archive plan"; by the end of January 2027)

**Decided by the SRS:** once a year, sales and their lines older than the period still open to
returns and corrections are exported into the backup, and the app keeps their daily totals so
reports stay whole. No sale gets its own audit line. The export and its restore are tested.

**Pull requests:** (1) a daily totals table and the function that fills it; (2) the yearly
archive run (export, check, remove), with a restore test on staging; (3) reports reading the
daily totals for archived days.

**Questions for the owner (data that can't be undone):**

- A1. The SRS says both "built right after go-live" and "built and tested before go-live" for
  the archive. Recommended: after go-live, by the end of January (the database has years of
  room), and the SRS sentence fixed.
- A2. How old must a sale be before it is archived? Recommended: older than 13 months, so a
  full year plus the return window stays in the app for comparisons.
- A3. Who runs it: the developer, once a year in January, with a backup made just before.
  Recommended: yes, never automatic.

## 3. Step 12: customer credit (utang) (SRS CRED-01 to CRED-05, APPR-01, SHIFT-04)

**Decided by the SRS:** credit customers (name, phone, address, credit limit, active); a
credit sale needs a chosen customer; a sale over the limit needs the Owner's approval;
payments against the balance (cash, GCash, Maya) with an on-screen acknowledgment; a ledger
with a running balance; aging (0-30, 31-60, 61-90, 90+ days); utang collected on the drawer
report.

**Pull requests:** (1) customers and the ledger (database); (2) customers screens; (3) credit
as a payment method in checkout, with the over-limit request; (4) payments and the
acknowledgment; (5) aging report and drawer report lines.

**Questions for the owner (utang terms, wait for the demo with the store owner):**

- U1. Who may sell on credit: Special Sales and Sales, or Special Sales only?
- U2. A default credit limit for a new customer, or always set by the Owner?
- U3. Any due date, interest or penalty? Recommended: none in the app (none in the SRS).
- U4. Can a sale be paid part cash, part utang?
- U5. Customers shared across future branches or per branch (SRS open question)?
  Recommended: per branch now (one store).
- U6. Paying utang by GCash or Maya: the reference is typed as for sales; does it count in a
  drawer? Recommended: cash payments go into today's drawer, GCash/Maya don't (as sales).

## 4. Step 13: Owner dashboard and reports (SRS REP-01 to REP-06)

**Decided by the SRS:** dashboard (today's sales, transactions, top items, low stock,
outstanding utang); sales by day, week, month and range, by salesperson and by payment method;
gross profit at the cost recorded with each sale (Owner only); best and slow sellers;
inventory value at cost and at selling price; CSV of any report.

**Pull requests:** (1) report functions in the database (computed on the server, small
answers, within the Free plan's egress); (2) dashboard; (3) sales and profit reports; (4)
sellers and inventory value; (5) CSV.

**Questions:** none needed to start. Utang on the dashboard waits for step 12.

## 5. Step 14: payroll (SRS PAY-01 to PAY-09, ATT-10)

**Decided by the SRS:** the Owner picks the period; one payslip per active staff member from
attendance (whole and half days × daily rate, minus late deductions); additions and
deductions with a note; cash advances (vale) deducted in the next run, in full or split;
warnings for pending attendance fixes and negative pay; finalizing locks the period, reopening
is Owner-only and logged; paid date, method and reference; payslip as an image or PDF; staff
see their own; history and CSV. Government contributions and withholding tax are not
computed.

**Pull requests:** (1) daily rates (Owner only) and cash advances; (2) the run and payslips;
(3) additions, deductions, warnings, finalize and reopen; (4) mark paid, payslip image/PDF,
staff view; (5) history and CSV.

**Questions for the owner (payroll rates, wait for the demo):**

- P1. Overtime: paid or not, and at what rate (the minutes are already recorded)?
- P2. Holiday pay: an addition typed by the Owner (SRS), or worked out from a holiday list?
  Recommended: typed by the Owner.
- P3. The flat late deduction amount, if the store uses one (ATT-06).
- P4. Each person's daily rate (entered by the Owner in the app; never in the repository).
- P5. Is a half day always half the daily rate?

## 6. Step 15: polish (SRS 8, Phase 5; docs/POLISH.md)

**Decided by the SRS:** held sales, a physical count (differences need the Owner's approval for
Special Sales, APPR-01), CSV import of products, the screens not yet restyled to the new look,
and the [POLISH.md](POLISH.md) list.

**Pull requests:** one per item; the POLISH.md list in small groups.

**Questions for the owner:**

- S1. Held sales: how long is a held sale kept, and may another salesperson finish it?
- S2. Physical count: a blind count (like the drawer) or showing the expected stock?
  Recommended: blind.
- S3. CSV import: the columns of the go-live product sheet (GO-LIVE.md) are used.

## Other open questions from the SRS (wait for the demo and the accountant)

- Senior citizen and PWD discounts (the law's 20% with VAT exemption, or 5% on basic
  necessities) and whether the store is VAT registered.
- If VAT registered: are unofficial slips enough (the accountant).
- Items sold in two units (per stick and per pack): two products for now.
- Sales written on paper when a phone is dead: how they are entered later.
