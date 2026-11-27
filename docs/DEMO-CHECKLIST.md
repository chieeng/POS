# Demo checklist: the store owner, Sat Dec 5 - Sun Dec 6, 2026

For the owner, to show the app to the store owner on staging (https://dev.pos-duz.pages.dev)
right after "Round 3 done", and to bring back their answers. Use the test data already on
staging; don't reset it (the restore rehearsal comes later, on Wed Dec 9). No passwords or
private links belong in this file (the repository is public).

Bring: a laptop signed in as the Owner, and a phone signed in as a staff member (Test Special 5
or Test Two). Write each answer down as it is given; send them all to Claude in one message
afterwards.

## 1. What to show (about 30 minutes)

Show it as a normal day, in this order:

1. **Morning, staff phone:** clock in at the store (the location check). Sell shows "Clock in
   first" until then.
2. **Open the drawer:** the opening cash is pre-filled from the last count.
3. **Sell:** find items by name, by category and by SKU; change a quantity; apply a package deal
   or a preset discount (staff never type a discount); pay by cash (change and peso rounding),
   then one by GCash with its reference; show the on-screen slip ("This is not an official
   receipt").
4. **Offline:** turn on Airplane mode, make a sale, turn it off: the sale is sent by itself.
5. **Cash in and cash out** with a reason (for example a supplier payment).
6. **Return and void:** a staff member asks to return an item (back to stock or damaged); the
   Owner sees the request in Approvals and approves it.
7. **Stock-in** of a delivery, and the low-stock list.
8. **Closing, staff phone (Special Sales):** the blind count by denomination; the expected cash
   shows only after the count, with over or short.
9. **Owner laptop:** Today (sales, drawer, who clocked in, who is late), the drawer report, the
   attendance board and its Summary CSV, the audit log, Store settings.
10. **Staff phone:** clock out (My attendance), and ask to fix a day.

Not built yet, so not shown: utang (step 12), full reports (step 13), payroll (step 14), sale
corrections (right after go-live). Say they come after go-live.

## 2. Questions to ask

Write the answer next to each one.

1. **Shift times:** what time should staff be in (morning, and the afternoon start)? What time
   does the store close? How many minutes of grace before someone is late (the app's default is
   15)?
2. **Late rule and amount:** when someone is late, is anything deducted? Choose one: nothing
   (the default), pay only for the minutes late, or a flat amount per late day (how much?).
   Note: a flat fine larger than the pay for the time missed may not be allowed under the Labor
   Code (Art. 113); check with the accountant or DOLE.
3. **Overtime pay (P1):** is time after closing paid? If yes, at what rate (the same as the
   normal rate, or more)?
4. **Overtime only on a whole day (P7):** should overtime count only when the person worked a
   whole day (recommended), and not on a short or half day?
5. **Who approves when the Owner is away:** voids, returns and stock changes wait for the
   Owner. Is that OK, or should someone else be able to approve (for example a Special Sales
   staff member)?
6. **Items sold in two units** (for example per piece and per pack): which ones? For now each is
   two products, each with its own price and stock. Is that OK?
7. **Switch date:** Mon Dec 21 (the week before Christmas, a busy week) or Mon Jan 4, 2027?
   The trial week (Mon Dec 14 - Sun Dec 20) runs beside the current method either way.

If there is time:

- **Daily rates** of each staff member, and holiday pay (needed for payroll, step 14).
- **Utang:** who may buy on credit, credit limits, when they pay (U1 to U6 in
  [PLAN-AFTER-GO-LIVE.md](PLAN-AFTER-GO-LIVE.md)).
- **The product list:** about 100 products; who types them in, and when?
- **For the accountant:** Senior citizen and PWD discounts, VAT, and whether unofficial slips
  are enough.
- **Change requests:** anything the store owner wants different. Note each one; Claude sorts them
  into "before the release" (money, stock, daily work) and "after go-live".

## 3. After the demo

Send Claude all the answers in one message by Sun Dec 6. They go into the SRS, the production
setup ([GO-LIVE.md](GO-LIVE.md)) and the plan after go-live, before the release on Thu Dec 10.
