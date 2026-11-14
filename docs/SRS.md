# Retail POS + Inventory System — SRS & ERD

Oct 1, 2026 · @Ritchie

## 1. Introduction

**Purpose.** This SRS defines a web-based POS and inventory system for a single retail store. It covers checkout, stock control, customer credit (utang), staff attendance, payroll and reporting for about 20 users. It is the reference for design, build and acceptance testing.

**Scope.** The system records sales at the counter, keeps stock levels accurate in real time, tracks customer credit balances, and gives the owner sales and profit reports. It runs in the browser on PCs and tablets, and keeps selling when the internet drops.

Out of scope for v1: online ordering, e-commerce, government contributions and withholding tax (SSS, PhilHealth, Pag-IBIG, BIR), accounting ledgers, integrated card or e-wallet payment APIs, and BIR-accredited official receipts.

**Definitions**

| Term | Meaning |
| --- | --- |
| POS | Point of sale: the checkout screen used by sales staff |
| SKU | Stock keeping unit: the product code, assigned manually by Special Sales |
| Utang | Goods sold on credit, paid later by the customer |
| Stock movement | Any change to a product's quantity: sale, stock-in, adjustment, return, void |
| Device | A user's own phone or laptop; there are no shared or dedicated terminals |
| Shift | The day's shared cash drawer session, from opening cash to closing count |
| Approval request | A change that needs the Owner's permission before it takes effect |
| Supabase | Hosted PostgreSQL with authentication, storage, Edge Functions and Row Level Security |
| RLS | Row Level Security: Postgres policies that decide which rows each user can read or write |
| Outbox | The device's local queue of sales and clock-ins made offline, sent when the connection returns |

**Assumptions**

- One store at launch. Every record carries a `branchId` so more branches can be added later without a data migration.
- Up to 20 user accounts, each signing in on their own phone or laptop; several may sell at the same time. No barcode scanners: items are found by name search, category, or a typed SKU.
- GCash and Maya are paid to the store's own number or QR; the salesperson enters the reference number. No payment API in v1.
- Receipts are shown on screen only. They are sales slips, never BIR official receipts (the owner's decision, Nov 1, 2026); every slip says "This is not an official receipt."
- The store has internet most of the time, with occasional outages.

## 2. Overall description

Three roles cover the store's 20 users: the Owner, a few Special Sales who also check in inventory, and Sales staff. Any edit or deletion of products or stock by Special Sales needs the Owner's approval.

| Role | Typical count | What they do |
| --- | --- | --- |
| Owner | 1 | Full access; manages users, prices and settings; approves requests; sees all reports, cost and profit |
| Special Sales | 1–3 | Everything Sales does, plus inventory check-in: add new products, assign SKUs, record stock-in from suppliers. Editing or deleting products and stock needs Owner approval |
| Sales | About 16 | Sells, collects payments and utang payments, clocks in, opens the day's drawer |

**Operating environment**

- Clients: each user's own Android/iOS phone or laptop, in Chrome, Edge or Safari (latest two versions); installable as a PWA.
- Peripherals: none required. No barcode scanner, dedicated terminal or printer.
- Notifications: none outside the app. The Owner sees new approval requests in the live Approvals list and the count badge on its menu item (no push notifications, by the owner's decision of Oct 31, 2026).
- Backend: Supabase (Postgres, Auth, Storage, Edge Functions, Realtime) on the Free plan, region Southeast Asia (Singapore). Both projects stay on the Free plan permanently.
- Frontend hosting: Cloudflare Pages (static single-page app).
- Source: GitHub repository https://github.com/chieeng/POS with Actions for CI and database migrations.

**Constraints**

- Supabase has no built-in offline writes. Offline selling and clock-in need a local outbox (IndexedDB) with client-generated ids so a resent record is never saved twice. All other actions require internet.
- The Supabase URL and anon key are public by design; security depends entirely on Row Level Security and database functions.
- The Supabase Free plan pauses a project after a period without activity, and has no backups the store can restore from and no point-in-time recovery. A heartbeat keeps both projects active: every 6 hours it runs a real, read-only query (`public.heartbeat()`, callable by anon, reading no table), and only a 2xx answer counts, because a request the database refuses does not count as activity. The database is backed up by the app's own encrypted backups (SYS-04). Features that need a paid plan are not used.
- Must comply with the Data Privacy Act of 2012 for customer names and phone numbers kept for utang.

## 3. Functional requirements

Requirements are numbered by module. Priority: **M** = must have for launch, **S** = should have, **C** = could have later.

### 3.1 Authentication and users (AUTH)

| ID | Requirement | Priority |
| --- | --- | --- |
| AUTH-01 | Users sign in with email and password through Supabase Auth on their own phone or laptop. | M |
| AUTH-02 | The Owner creates, edits, deactivates and reactivates users and assigns one role each: Owner, Special Sales or Sales. A new user gets a one-time link to set their own password; the Owner never sets or sees a password. User codes are 2 to 6 letters or digits, unique per branch. The Owner cannot demote or deactivate their own account. A reactivated user keeps their role, user code, history and password; if they forgot the password, the Owner makes a one-time reset link from the user's page, as for any active user. Users are never hard-deleted. | M |
| AUTH-03 | Role and active flag are stored in the profiles table and can be changed only through an Owner-only Edge Function or database function, never by direct table writes. | M |
| AUTH-04 | A user may be signed in on more than one of their own devices. The Owner can sign a user out of all devices (lost phone, staff leaving). | M |
| AUTH-05 | The app locks after 15 minutes idle (configurable) and asks for the user's password to resume. A staff PIN is not used. The lock works offline too: the password is checked against a slow salted hash kept on the device from the user's last online sign-in or unlock, never the password itself; a device with no hash yet says "Connect to the internet to unlock". The hash is PBKDF2-SHA-256 with 600,000 rounds and a random salt, for the signed-in user only; it is deleted on sign-out and when the server ends the session. After 5 wrong offline tries in a row it is deleted, and the device needs the internet to unlock. While the device says it is online but the server cannot be reached, the lock also checks the hash. | S |

### 3.2 Products and catalog (PROD)

| ID | Requirement | Priority |
| --- | --- | --- |
| PROD-01 | Products have: name, SKU, category, unit, selling price per unit, reorder level, active flag, photo. The unit is one of pc (default), pack, box, bottle, can, sachet, set, pair, roll, kg, L; the price and every quantity (stock-in, sale, count) are per that unit. Products in kg or L are "sold by weight or volume" and take up to 3 decimals; every other unit stays in whole numbers. A product holding a part of a unit cannot change to a whole-number unit. An item sold in two units (for example per stick and per pack) is two products, each with its own SKU, price and stock. | M |
| PROD-02 | Special Sales types the SKU manually when adding a product: 1 to 20 letters, digits or dashes, saved in capitals. SKUs are unique per branch whatever their case; duplicates are rejected. No barcodes. | M |
| PROD-03 | Special Sales and the Owner add products, categories and suppliers directly. Category and supplier names are trimmed and unique per branch whatever their case. Nothing is deleted: a deactivated category or supplier stays on existing products and history but cannot be chosen for new ones, and a category that still has active products cannot be deactivated ("Move or deactivate its N products first"). | M |
| PROD-04 | Edits and deactivation by Special Sales (name, SKU, category, unit, price, reorder level, deactivate or reactivate) go through an Owner approval request (SRS 3.9); the Owner edits directly. Categories and suppliers are changed by the Owner only, with no requests: Special Sales asks the Owner in person. | M |
| PROD-05 | Every price is logged in `price_changes` with old price, new price, who (and their name at the time), device and time, including the first price when a product is added. The product page shows its price history, newest first, to the Owner and Special Sales. | M |
| PROD-06 | Export the product list as CSV (Owner only): SKU, name, category, unit, price, reorder level, active, stock on hand, average cost. The file opens correctly in Excel: UTF-8 with a BOM (₱ and ñ intact), plain numbers without ₱ or thousands separators. Each export is in the audit log. SKUs of only digits and dashes are written so Excel keeps them as text, and text Excel would read as a formula starts with an apostrophe. Bulk import by CSV comes later (build step 15). | S |
| PROD-07 | A product has at most one photo. It is resized in the browser into a 200 px square for lists and an 800 px version for the product page (JPEG), stored at a path that never changes and cached by the browser for a year; a product without a photo shows a plain icon. The Owner adds, replaces and removes photos. Special Sales adds a photo when creating a product or to a product without one; replacing or removing it goes through "Request a change" (PROD-04). Sales see photos only. Files nothing uses any more are deleted. | S |

### 3.3 Point of sale (POS)

| ID | Requirement | Priority |
| --- | --- | --- |
| POS-01 | Find items by name search (partial, case-insensitive), by tapping a category and then the item, or by typing the SKU. Tapping an item adds it; tapping again increases its quantity. | M |
| POS-02 | Edit quantity and remove lines before payment. | M |
| POS-03 | Staff never type a discount (the owner's decision, Nov 1, 2026); there is no discount limit and no discount approval. The Owner defines preset discounts (name, % or fixed ₱ per unit or per kg/L, and every product, chosen categories or chosen products) and package deals (for example 3 for ₱100, repeating for 6 or 9, with extra units at the regular price; or a bundle of specific items at one price). The cart shows which deals apply and staff tap one; the app never adds a deal by itself. One deal per line, and a package cannot also take a preset discount. Deals are switched on or off, with no date ranges. In a package, each item stays its own line with the price split in proportion to the regular prices, so stock, cost and reports stay correct. The owner's decisions of Nov 12, 2026: a percent preset comes off the line total, rounded to the centavo (half up), before cash is rounded to the peso; a fixed ₱ preset is not offered on a product priced at or below its amount; there is no whole-sale discount (the design's "Add sale discount" is not built), and a preset may apply to every product instead. complete_sale works each discount out again from its preset; a sale keeps the discount it was given, and one that no longer matches the preset (changed or switched off since, or not covering that product) is flagged `discount_changed` for the Owner (POS-14). The drawer report shows the discounts given. Package deals, the owner's decisions of Nov 12, 2026: an "N for ₱" deal counts any mix of the products the Owner picks (2 Classic + 1 Cheese make a set; one product picked gives a plain "3 for ₱100"); a bundle lists specific items with a count each; both give as many full sets as the cart holds, and leftover units keep the regular price (in an "N for ₱" deal the leftovers are the lowest-priced units); products sold by kg or L are never in a deal. The cart offers a deal once it holds a full set, and staff tap Apply. The saving is split over the deal's lines in proportion to their regular prices in the sets, to the centavo, with any leftover centavo on the line with the biggest share. complete_sale works each deal's saving out again; one that no longer adds up (changed or switched off since, or not a full set) is kept and flagged `deal_changed`. | M |
| POS-04 | Accept Cash (compute change), GCash, Maya (reference number required), Credit/utang (customer required, build step 12), or a split of these. The Owner lists the store's payment accounts (GCash or Maya, label, number). With one account it is selected automatically; with several, staff pick which was paid; with none, the sale still records the reference. Each sale keeps the account's label as it was. When "Round cash totals to the nearest peso" is on (Owner setting, on by default), the cash part of a sale is rounded to the nearest peso, with exactly ₱0.50 rounded up (₱123.50 → ₱124.00, ₱123.49 → ₱123.00; the owner's decision, Nov 4, 2026), and the slip shows the rounding, because the drawer is counted in whole pesos; GCash and Maya stay exact. | M |
| POS-05 | Hold a sale and resume it later on the same device. | S |
| POS-06 | Complete a sale in one database transaction (the complete\_sale function): sale, lines, payments, stock decrement per line, stock movements, drawer totals. Offline, the sale goes to the device's outbox and is submitted when online; its client-generated id makes a resubmission safe. | M |
| POS-07 | After payment, show a digital slip on screen with store info, receipt number, items, totals, payment, salesperson, and "This is not an official receipt". The slip is not printed or shared (the owner's decision, Nov 1, 2026). When the Owner's "VAT registered" setting is on (off by default; rate 12% by default), the slip shows the VAT part of the VAT-inclusive total: total × rate ÷ (100 + rate), at the rate kept on the sale. | M |
| POS-08 | Receipt numbers are unique without a central counter: `<user code>-<YYYYMMDD>-<device tag>-<sequence kept on the device>`. | M |
| POS-09 | Warn when an item's stock would go below zero; allow the sale (the item is physically in hand) and flag it for Special Sales. | M |
| POS-10 | Void a completed sale (same day) or process a return/refund (any day) through an Owner approval request with a reason; stock is restored when approved. The owner's decisions of Nov 13, 2026: a void is possible only while the sale's drawer is still open; after that it is a return. Returns may be partial (some items or units); the refund is what the customer paid for those units after any discount, and for an item from a deal or bundle the share shown on the slip; the refund amount is shown before the request is sent. Each returned item is marked "Back to stock" or "Damaged"; damaged items go to a damaged/write-off record, not back to stock, and show on the report. Returns are allowed within a window set by the Owner (default 30 days); a defective item may be returned after it with the Owner's approval and a reason (consumer law). A cash refund comes out of today's open drawer and lowers its expected cash; a GCash or Maya refund is sent by the Owner outside the app and recorded with its reference. Every void, return and correction needs the Owner's approval, is audit-logged with its reason, and appears on the drawer report and its CSV. | M |
| POS-11 | Sale correction request: when a sale was entered wrong (item, quantity, price, discount, payment method or customer), the salesperson opens it, makes the fixes, and sends them to the Owner with a reason. The Owner sees the original and the corrected version side by side and approves or rejects. Staff never type a price (the owner's decision, Nov 13, 2026): the original lines keep their price, added items take today's price, and the discount is a preset or deal. If the corrected total is higher, staff collect the difference; if lower, it is refunded as in POS-10. | M |
| POS-12 | On approval, the original sale is marked "corrected" and a new sale with the fixes is created and linked to it. Stock, drawer totals and utang balances are adjusted by the difference. The original is never edited or deleted. | M |
| POS-13 | Duplicate reference check: a GCash or Maya reference number already used on another sale or utang payment is rejected while online. Offline, only that phone's own sales can be checked; sales made offline are checked when they sync, and a duplicate is flagged on both sales and shown to the Owner on the report and in the audit log. | M |
| POS-14 | A sale made offline is never rejected for what changed while it waited (the owner's decisions, Nov 1, 2026). It keeps the price and deal the customer paid, flagged for the Owner if they have changed since. If the drawer closed before it synced, it goes to the next drawer that opens; if none is open, it waits and attaches when one opens. The Owner's report flags it with its amount and both dates, because its cash may already be in the earlier count. Online, selling with no drawer open is allowed, with a banner and an Open button; the sale attaches the same way. | M |

### 3.4 Cash drawer (SHIFT)

| ID | Requirement | Priority |
| --- | --- | --- |
| SHIFT-01 | The store has one shared cash drawer; all cash payments go into it. Each day the first staff member enters the opening cash. The app pre-fills the last counted closing cash; if the amount entered differs, a reason is required and the difference is flagged for the Owner. Only one drawer session can be opened per day. A drawer left open on an earlier day is closed as "not counted" when today's drawer opens, and flagged for the Owner; a forgotten close never blocks selling. A closed drawer does not reopen the same day (later sales go to the next day's drawer); only the Owner can reopen the latest drawer, with a reason. A reopen does not erase the count: if nobody recounts, the next opening is pre-filled from the count taken before the reopen, and says so. A drawer left open overnight may be counted and closed the next morning, before today's drawer opens, by the Owner or a Special Sales with the same blind count (the owner's decision, Nov 13, 2026); the report says it was counted the next morning, and the result names any cash from today's sales made before the count. Once today's drawer opens, the earlier one can no longer be counted. | M |
| SHIFT-02 | Any staff member can record cash-in and cash-out with a reason (Supplier payment, Expense, Owner withdrawal, Change fund, Other) and an optional note (required for Other); each entry is logged with their name. Only the Owner sees "Expected cash after" while recording. | M |
| SHIFT-03 | At closing, the Owner or a Special Sales counts the drawer by denomination (₱1,000 down to ₱1). The count is blind: expected cash (opening + cash sales + cash utang payments + cash-ins − cash refunds − cash-outs) is shown only after the count is entered, and Special Sales and Sales never see expected cash before that. The system records the exact over/short (no tolerance) and an optional note for the Owner. | M |
| SHIFT-04 | Daily drawer report: sales by payment method and by salesperson, voids, corrections, refunds, utang collected, cash-in/out, every close and reopen (with the reason), over/short. The sales the Owner should check are listed with their flags: late (made on an earlier day; its cash may be in an earlier count), price or rounding/VAT setting different from the store's, product turned off, stock below zero, a GCash/Maya reference used on another sale, and the phone's clock ahead, a discount that no longer matched its preset, and a deal that no longer added up (POS-03, POS-09, POS-13, POS-14). It also shows the discounts and deals given. | M |

### 3.5 Inventory (INV)

| ID | Requirement | Priority |
| --- | --- | --- |
| INV-01 | Every quantity change writes a stock movement (append-only): sale, void, return, stock-in, stock-in reversal, adjustment, count correction. Stock-ins, adjustments and corrections never take stock below zero ("Only N in stock; this would leave −M"); only a sale may (POS-09). | M |
| INV-02 | Stock-in (Special Sales, Owner): search the product by name or SKU, type the quantity (whole units, or up to 3 decimals for kg and L) and unit cost (at least ₱0.01), with optional supplier and DR/invoice number. Each product once per stock-in ("Chips Classic is already on line 3"); active products and suppliers only; up to 100 lines. Applied immediately. The stock on the shelves at go-live is entered the same way, as a stock-in with the reference "Opening stock", no supplier, and an estimated unit cost (never ₱0). | M |
| INV-03 | A new product can be created during stock-in, with its SKU typed manually. | M |
| INV-04 | Adjustments (damage, loss, expiry, found, store use, other) and corrections or deletions of past stock-ins (quantity, unit cost, supplier, reference): Special Sales submits an Owner approval request with a reason, for their own stock-ins only; the Owner applies them directly. The original stock-in is never edited or deleted: a correction posts reversing and new movements and recomputes the cost. | M |
| INV-05 | Low-stock list of active products with a reorder level and stock at or below it: a card on the Owner's home and a "Low stock only" filter on Products. | M |
| INV-06 | Stock movement history per product, filterable by date and type, for the Owner and Special Sales; the cost per unit is shown to the Owner only. Sales see stock levels only. | M |
| INV-07 | Physical count: enter counted quantities; the differences are submitted together as one approval request. | S |
| INV-08 | Cost price updates on stock-in use weighted average cost: (stock on hand × average + quantity × unit cost) ÷ new stock, or the delivery's unit cost when nothing is on hand. A correction revalues only the units of that delivery still on hand (at most its quantity) from the old to the corrected cost; units already sold keep the cost recorded with the sale, so past profit never changes. Costs are visible to the Owner only, except that whoever recorded a stock-in sees the unit costs they typed on it. | S |

### 3.6 Customers and credit (CRED)

| ID | Requirement | Priority |
| --- | --- | --- |
| CRED-01 | Manage credit customers: name, phone, address, credit limit, active flag. | M |
| CRED-02 | A credit sale needs a selected customer; sales beyond the credit limit need a Owner approval. | M |
| CRED-03 | Record payments against a customer's balance (cash, GCash, Maya), with an on-screen acknowledgment. | M |
| CRED-04 | Each customer has a ledger of charges and payments with a running balance. | M |
| CRED-05 | Aging report: balances grouped by 0–30, 31–60, 61–90 and 90+ days. | S |

### 3.7 Reports and dashboard (REP)

| ID | Requirement | Priority |
| --- | --- | --- |
| REP-01 | Dashboard: today's sales, transaction count, top items, low stock, outstanding utang. | M |
| REP-02 | Sales by day, week, month, and custom range; by salesperson; by payment method. | M |
| REP-03 | Gross profit (sales minus cost at time of sale), visible to Owner only. | M |
| REP-04 | Best and slow sellers by quantity and amount. | S |
| REP-05 | Inventory valuation at cost and at selling price. | S |
| REP-06 | Export any report to CSV. | S |

### 3.8 Settings and audit (SYS)

| ID | Requirement | Priority |
| --- | --- | --- |
| SYS-01 | Store settings (Owner only): name, address, contact, TIN, receipt footer, VAT registered and VAT rate, cash rounding, payment accounts, preset discounts and package deals, the return window (default 30 days), idle lock time, and the store's location and clock-in radius (ATT-02). The Owner sets the location with "Use my current location" (browser geolocation, while standing in the store) or by typing the coordinates, for example copied from Google Maps; the radius defaults to 100 m. Until a location is set, Store settings shows a reminder. Every change is audit-logged with old and new values. | M |
| SYS-02 | Each browser creates a 4-character device tag on first sign-in, stored locally and registered in the devices table, used in receipt numbers and the audit log. The Owner can see each user's active devices. | M |
| SYS-03 | Audit log of sensitive actions: sign-in, user and role changes, price changes, approval requests and decisions, voids, refunds, stock adjustments, slip re-shares. Read-only. | M |
| SYS-04 | Encrypted backups of the whole database (including user accounts) made by a GitHub Actions workflow, never in the browser. The **developer who maintains the system** makes and keeps them; the store's Owner has no GitHub access. **Manual:** at least every 7 days the developer runs it, downloads the file (kept on GitHub for 1 day) and saves it to their PC and Google Drive. **Nightly:** production only, kept on GitHub for 7 days as a safety net. Files are encrypted to a key the developer keeps offline. The developer is emailed when the last manual production backup is more than 7 days old (after go-live) or a nightly run fails. The app shows the Owner the last backup date, read-only, and a calm note on their home screen when a backup is overdue ("Your system administrator has been notified"), with no steps to follow. | M |

### 3.9 Owner approvals (APPR)

| ID | Requirement | Priority |
| --- | --- | --- |
| APPR-01 | These actions by non-Owners create an approval request instead of applying: product edit or deactivation, stock adjustment, correcting or deleting a stock-in, physical count differences, sale correction, void, return/refund, credit sale over limit. | M |
| APPR-02 | A request stores what changes (the requested fields as they were then, and as requested), the reason (required), the requester and the time. Nothing changes until the Owner approves. A requester has at most one pending request per item, and may withdraw it while it is pending (status "withdrawn", audit-logged). Requests do not expire. | M |
| APPR-03 | The Owner sees new requests in the live Approvals list, with a count badge on its menu item, and approves or rejects with an optional note. There are no push notifications. | M |
| APPR-04 | On approval, the database applies the change exactly as requested in one transaction, with the same checks as the Owner's own edit, writes the stock movement if any, and logs it. If the item changed after the request was made (any requested field differs from the value then), the request is **outdated**: it shows the current, original and requested values, cannot be approved, only rejected, and the requester makes a new one. The Owner approves as requested or rejects; there is no "approve with changes". | M |
| APPR-05 | The requester sees the status of their requests (pending, approved, rejected, withdrawn, outdated) and the Owner's note, live, under My requests. | M |

Build step 3 delivers the requests and the product edit type. Stock adjustments and stock-in corrections followed in step 4. The other types in APPR-01 arrive with the features they change: physical counts (step 15), voids, returns and sale corrections (step 10), credit over the limit (step 12). Discounts need no approval: staff pick only what the Owner defined (POS-03). Push notifications (step 6) were dropped by the owner's decision (Oct 31, 2026); the live list and its count badge are how the Owner learns of new requests.

### 3.10 Attendance (ATT)

Staff clock in once a day on their own device, with no clock-out, and the store's location decides whether it counts. The defaults follow the attendance policy already used for pos-erag; every value is a setting the Owner can change, because the store's own times and rules are confirmed only at handover.

| ID | Requirement | Priority |
| --- | --- | --- |
| ATT-01 | Each staff member (Special Sales and Sales) clocks in once per day with one tap from their own device. There is no clock-out. A second clock-in on the same day is refused. The Owner does not clock in, unless the Owner turns on "Owner clocks in too" in attendance settings (off by default). | M |
| ATT-02 | At clock-in the app reads the device location (browser Geolocation API, high accuracy) and checks its distance from the store's set coordinates against the radius set by the Owner (default 100 m). Until the Owner sets the store's location (SYS-01), the location check is off: clock-ins are allowed and recorded as "store location not set". | M |
| ATT-03 | Inside the radius: allowed. Location found with good accuracy but outside the radius: blocked, showing how far away the user is. | M |
| ATT-04 | Location not detected (permission denied, GPS off, timeout, or accuracy worse than the radius): allowed with a warning; the record is flagged "location not verified" for the Owner to review. | M |
| ATT-05 | Location is captured only at the moment of clock-in (latitude, longitude, accuracy, distance). It is never tracked in the background. | M |
| ATT-06 | Late rule: a clock-in after the shift's clock-in time plus the grace period is late, and the minutes late are counted from the clock-in time. Lateness is always recorded (late count, minutes late). What it costs is the Owner's choice of **late deduction**: **None** (default); **Pay for the minutes late only**: daily rate ÷ paid minutes per day (default 480) × minutes late; or **Flat amount** per late day (default ₱0). The shift is matched by the clock-in time. Defaults: morning 6:00 AM, afternoon 1:00 PM, 15-minute grace. *Note:* under Philippine labor rules, deductions from wages are restricted (Labor Code Art. 113), and a flat fine larger than the pay for the time actually missed may not be allowed, while not paying for the minutes not worked generally is. The store owner decides which rule to use, ideally after checking with their accountant or DOLE; the app does not give legal advice. | M |
| ATT-07 | Attendance settings screen (Owner only): the clock-in time for each shift, the grace period in minutes, the late deduction (none, minutes late, or flat amount) with its amount or paid minutes per day, whether a day that starts with the afternoon shift counts as a full or half day (default half), and whether the Owner clocks in too (default off). | M |
| ATT-08 | The Owner can give a staff member their own clock-in time, which replaces the shift time for that person only. | S |
| ATT-09 | A settings change applies from the next clock-in onward. Each record stores the clock-in time, grace, late rule and amounts used, so past records and pay never change. Every change is audit-logged with old and new values. | M |
| ATT-10 | Pay for a day = daily rate × day credit (1 for a day starting with the morning shift; 0.5 by default for a day starting with the afternoon shift, or 1 if the Owner sets it to a full day) minus the late deduction (ATT-06). No hours or overtime are computed. Daily rates are visible to the Owner only. | M |
| ATT-11 | Forgot to clock in, or wrongly flagged: the staff member submits a correction request with a reason, or the Owner adds or edits the record directly with a reason. | M |
| ATT-12 | Clock-in works offline: device time and location are saved locally and synced later. The server time is recorded on sync, and a gap of more than 5 minutes is flagged. | M |
| ATT-13 | The clock\_in database function computes distance, lateness, penalty and day credit on the server for every record, so a tampered client cannot change them. | M |
| ATT-14 | Attendance board for the Owner: who has clocked in today, who is late, flagged, or not yet in. Per-person summary for any date range: days present, late count, penalties, computed pay; CSV export. | M |
| ATT-15 | Staff see their own clock-in time, attendance history and penalties. | S |
| ATT-16 | Staff must be clocked in before they can make a sale. | S |

Browser location can be faked with mock-location apps on some phones. Flags, server time checks and the Owner's review reduce this risk but cannot rule it out.

### 3.11 Payroll (PAY)

A lightweight payroll turns attendance into payslips each pay period. Government contributions and withholding tax are not computed.

| ID | Requirement | Priority |
| --- | --- | --- |
| PAY-01 | No fixed pay schedule. When starting a run, the Owner picks the period with a date range picker (start and end date). The start date is pre-filled with the day after the last run's end; a range that overlaps a finalized run is refused. | M |
| PAY-02 | The Owner starts a payroll run for the chosen date range. The system drafts one payslip per active staff member from attendance: full and half days, daily rate, gross pay, late penalties. | M |
| PAY-03 | Before finalizing, the Owner can add per-person additions (bonus, allowance, holiday pay, other) and deductions (cash advance, shortage, other), each with an amount and a note. | M |
| PAY-04 | Cash advances (vale): the Owner records an advance at any time, with an amount and note. It is deducted automatically in the next payroll run, in full or split across runs. | S |
| PAY-05 | The run warns about pending attendance corrections in the period and about any payslip with negative net pay. | M |
| PAY-06 | Finalizing locks the period's attendance and payslips. Reopening a finalized run is Owner-only and audit-logged. | M |
| PAY-07 | Mark each payslip paid with date, method (cash or GCash) and reference. | M |
| PAY-08 | Payslip shows period, days, daily rate, gross, each addition and deduction, and net pay. It can be shared as an image or PDF. Staff see only their own finalized payslips. | M |
| PAY-09 | Payroll history per period and per person, with totals and CSV export. | M |

## 4. Non-functional requirements

| ID | Category | Requirement |
| --- | --- | --- |
| NFR-01 | Performance | Name search shows results as the user types, under 300 ms for 10,000 products, by filtering the locally cached product list (so search also works offline). A sale completes locally in under 1 s. |
| NFR-02 | Offline | Checkout, clock-in and product search work with no internet: sales and clock-ins wait in the device outbox and sync automatically within 1 minute of reconnecting. Stock-in, approvals, payroll, reports and settings need internet. A visible indicator shows online/offline and pending-sync count. Approval requests wait until online. Offline, buttons for actions that need the server are disabled with a "Needs internet" hint. A user cannot sign out while their own outbox items are unsent ("N sales haven't been sent yet. Connect to the internet first."). An item the server refuses for good is never dropped: it stays on the device as "needs attention" and is reported to the Owner in the audit log (`report_unsent`). |
| NFR-03 | Availability | Frontend on Cloudflare Pages, backend on Supabase; the app shell loads from the PWA cache even when the host is unreachable. |
| NFR-04 | Security | All access enforced by Row Level Security and database functions, never by UI alone. HTTPS only. No secrets in the repository. Personal devices are untrusted: no data beyond the user's role is ever sent to them. |
| NFR-05 | Data integrity | Sales and stock movements are append-only; corrections are new records, never edits or deletes. |
| NFR-06 | Auditability | Every sensitive action is traceable to a user, device tag and time. |
| NFR-07 | Backup | A restore loses everything since the backup used: up to 7 days with weekly manual backups, less while a nightly file is still on GitHub. The developer makes extra backups before payroll and big stock counts. A restore is tested once on staging before launch, following docs/RESTORE.md. |
| NFR-08 | Usability | Mobile-first: every screen works on a 360 px wide phone; touch targets at least 44 px; a new salesperson can complete a sale after 15 minutes of training. |
| NFR-09 | Scalability | Supports 20 users signed in on up to 30 devices, 10,000 products and 500 sales per day without design changes. |
| NFR-10 | Cost | No running costs: both Supabase projects on the Free plan, Cloudflare Pages within its free tier, GitHub Actions free for a public repository, backups saved to the developer's PC and Google Drive's free storage. Nothing is set up that can bill without a cap. |
| NFR-11 | Privacy | Customer data limited to name, phone and address; visible only to roles that need it (Data Privacy Act of 2012). |
| NFR-12 | Maintainability | TypeScript, ESLint and Prettier; RLS policies and database functions covered by pgTAP tests in CI. |

## 5. Data model

About 25 PostgreSQL tables in the `public` schema, with `branch_id` on store-level data so branches can be added later. Money is `numeric(12,2)`; times are `timestamptz` stored in UTC and shown in Asia/Manila. Sale lines copy name, price and cost at the time of sale, so later edits never change past receipts. RLS is enabled on every table. The diagram shows the main tables and their links.

&#91;embedded content: ERD · 13 collections and their links\]

A sale links its shift, salesperson and optional customer, and spawns stock movements, credit charges and returns. Products gain stock only through receipts and approved adjustments, both logged as movements; approval requests record who asked for each change.

### 5.1 Tables

| Table | Key columns | Written by |
| --- | --- | --- |
| `branches` | name, address, contact, tin, receipt\_footer, vat\_registered, vat\_rate, round\_cash, idle\_lock\_minutes, store\_lat, store\_lng, radius\_m, morning\_clock\_in, afternoon\_clock\_in, grace\_minutes, late\_deduction, late\_penalty, paid\_minutes\_per\_day, afternoon\_day\_credit, owner\_clocks\_in | Read by the branch's active users; written by the Owner through `update_branch_settings` |
| `profiles` | id (= auth user id), display\_name, role (owner, special\_sales, sales), user\_code, branch\_id, active, clock\_in\_override, created\_at | Owner-only Edge Function / function |
| `devices` | user\_id, device\_tag, label, push\_subscription (unused: push was dropped), last\_seen\_at | The user (own rows) |
| `pay_rates` | user\_id, daily\_rate, effective\_from, updated\_by | Owner only (read and write) |
| `categories` | branch\_id, name (unique per branch, case-insensitive), active | Read by the branch; created by Special Sales and the Owner, changed by the Owner, through functions |
| `suppliers` | branch\_id, name (unique per branch, case-insensitive), contact\_person, phone, address, active | Owner and Special Sales read; created by both, changed by the Owner, through functions |
| `products` | branch\_id, sku (unique per branch), name, category\_id, unit, sold\_by\_measure (follows the unit: kg and L), sell\_price, stock\_qty, reorder\_level, photo\_key (the current photo, PROD-07), active, updated\_at | create\_product, update\_product, set\_product\_photo and approved requests; `stock_qty` only via stock functions |
| `price_changes` | product\_id, old\_price, new\_price, source (created, owner\_edit, approval, import), changed\_by, changed\_by\_name, device\_tag, created\_at | Functions only; append-only; Owner and Special Sales read |
| `product_costs` | product\_id, cost\_price (weighted average, 4 decimals), updated\_at | Functions only; Owner-only read |
| `customers` | branch\_id, name, phone, address, credit\_limit, balance, active | Sales (create), Owner (edit); `balance` only via functions |
| `drawer_sessions` | branch\_id, business\_date (unique per branch, Asia/Manila), status (open, closed, not\_counted), opened\_by, opening\_cash, prefill\_cash, prefill\_difference, opening\_reason, closed\_by, counts (by denomination), counted\_cash, expected\_cash, over\_short, closing\_note | open\_drawer, close\_drawer and reopen\_drawer functions; the Owner reads them; staff get today's state through drawer\_today, without expected cash |
| `drawer_entries` | session\_id, type (cash\_in, cash\_out), amount, reason (supplier\_payment, expense, owner\_withdrawal, change\_fund, other), note, user\_id, user\_name, created\_at | record\_drawer\_entry; append-only; the Owner reads them |
| `sales` | id (client-generated UUID), receipt\_no (unique per branch), branch\_id, session\_id (null while it waits for a drawer, POS-14), salesperson\_id, salesperson\_name, device\_tag, subtotal, discount\_total, rounding, total, vat\_rate and vat\_amount (null when not VAT registered on the device), change, status (completed, voided, corrected), flags (price\_changed, settings\_changed, product\_inactive, stock\_negative, duplicate\_reference, late, clock\_ahead, discount\_changed, deal\_changed), made\_offline, created\_at (made, by the device's clock), synced\_at; customer\_id (step 12) and correction\_of, voided\_by, void\_reason (step 10) join later | complete\_sale and approval functions only; append-only; the Owner reads the branch's sales, staff their own |
| `sale_items` | sale\_id, line\_no, product\_id, name, sku, unit, qty, unit\_price (what the customer paid), list\_price (the server's price when it differs), unit\_cost, discount, discount\_id and discount\_name (the preset used) or deal\_id and deal\_name (the deal, POS-03), line\_total (after the discount) | complete\_sale only; the Owner reads them (they carry the cost) |
| `sale_payments` | sale\_id, line\_no, method (cash, gcash, maya; credit in step 12), amount (cash: what stayed in the drawer), reference (without spaces, in capitals), account\_id, account\_label (a copy) | complete\_sale only; duplicate GCash/Maya references checked; the Owner reads them |
| `payment_accounts` | branch\_id, provider (gcash, maya), label (unique per branch, case-insensitive), number, active | Read by the branch (staff pick which account was paid); created and changed by the Owner through functions; deactivated, never deleted; the provider never changes (POS-04) |
| `discounts` | branch\_id, name (unique per branch, case-insensitive), kind (percent, fixed), value, applies\_to (all, categories, products), category\_ids, product\_ids, active | Read by the branch (staff pick one per line); created and changed by the Owner through `create_discount` and `update_discount`, audit-logged; switched off, never deleted (POS-03) |
| `deals` | branch\_id, name (unique per branch, case-insensitive), kind (quantity, bundle), price (of one set), set\_size (quantity), product\_ids, qtys (bundle: a count per item), active | Read by the branch (the cart offers them); created and changed by the Owner through `create_deal` and `update_deal`, audit-logged; whole-unit products only; the kind never changes; switched off, never deleted (POS-03) |
| `returns` | sale\_id, items (jsonb), refund\_amount, refund\_method, reason, approval\_id, created\_at | Approval function |
| `stock_receipts`, `stock_receipt_items` | supplier\_id, reference, received\_by, received\_by\_name, device\_tag, created\_at, corrects\_receipt\_id (a correction replaces one earlier stock-in, at most once), is\_deletion, corrected\_by, corrected\_by\_name; line\_no, product\_id (once per receipt), qty, unit\_cost | record\_stock\_in and correction functions; never edited or deleted; the Owner reads all, the receiver reads their own (with costs), including corrections of them |
| `stock_movements` | product\_id, type (stock\_in, stock\_in\_reversal, adjustment, sale, void, return, count), qty\_change, stock\_after, unit\_cost, ref\_type, ref\_id, user\_id, user\_name, device\_tag, created\_at | Functions only; append-only; Owner reads directly, Special Sales through product\_stock\_history (no cost) |
| `stock_adjustments` | product\_id, type (damage, loss, expiry, found, store\_use, other), qty\_change, reason, unit\_cost (average at the time), created\_by, created\_by\_name, approval\_id, device\_tag, created\_at | adjust\_stock (Owner) or an approved request; append-only; Owner-only read |
| `credit_ledger` | customer\_id, type (charge, payment), amount, sale\_id, method, reference, user\_id, created\_at | Functions only; append-only |
| `approval_requests` | type (product\_edit, stock\_adjustment, stock\_in\_correction; later steps add theirs), target\_type (product, stock\_receipt), target\_id, before (jsonb), after (jsonb), reason, requested\_by, status (pending, approved, rejected, withdrawn), decided\_by, decided\_at, owner\_note, created\_at | Created by request functions (one pending per type, item and requester); withdraw\_request (requester); decide\_approval (Owner only) |
| `attendance` | user\_id, work\_date (unique per user), shift\_slot, device\_at, server\_at, lat, lng, accuracy\_m, distance\_m, location\_status, scheduled\_clock\_in, grace\_minutes, late\_minutes, late\_deduction, day\_credit, flags, edited\_by, edit\_reason | clock\_in function; Owner edits with reason |
| `payroll_runs` | period\_start, period\_end, status (draft, finalized), totals, finalized\_by, finalized\_at; finalized ranges may not overlap | Owner only |
| `payslips` | run\_id, user\_id, full\_days, half\_days, daily\_rate, gross\_pay, late\_penalties, additions (jsonb), deductions (jsonb), net\_pay, paid\_at, paid\_method, paid\_reference | Drafted by function; Owner edits until finalized; staff read own finalized |
| `cash_advances` | user\_id, amount, advance\_date, note, remaining, status (open, deducted) | Owner only |
| `audit_logs` | action, actor\_id, device\_tag, target\_type, target\_id, before, after, reason, created\_at | Functions and triggers only; append-only |

Reports are SQL views and functions (for example `report_sales(from, to)`), so no pre-computed summary tables are needed. Views that show cost or profit are restricted to the Owner.

### 5.2 Checkout (one transaction, offline-safe)

1. The app builds the sale with a client-generated UUID and receipt number and calls `complete_sale(payload)`. Offline, the payload is stored in the device outbox (IndexedDB) and sent when the connection returns.
2. In one transaction the function checks the caller (active; the clock-in check joins in build step 11) and recomputes the totals from the quantities, prices and settings the device used. A sale that does not add up is refused. A price, cash-rounding or VAT setting that differs from the server's now is kept and flagged (POS-14). No drawer is needed: the sale joins today's open drawer, or waits and joins the next one that opens, flagged late if it was made on an earlier day.
3. It inserts the sale, its items (copying `unit_cost` from `product_costs`) and payments. A reused GCash or Maya reference is rejected online; for a sale made or first sent offline it is saved, flagged on both sales, and written to the audit log.
4. It decrements `stock_qty` (below zero if need be, flagged, POS-09) and writes `stock_movements`; for credit (build step 12) it adds a `credit_ledger` charge and updates the customer balance. The drawer's expected cash includes the sale's cash payment. No audit line is written for an ordinary sale.
5. If the same UUID arrives twice, the function returns the existing sale instead of creating a second one.

Clock-in follows the same pattern through `clock_in(payload)`, keyed by user and date.

### 5.3 Indexes

- `products`: unique (branch\_id, sku); (branch\_id, active, name); trigram index on name for server-side search
- `sales`: (branch\_id, created\_at desc); (salesperson\_id, created\_at desc); (session\_id)
- `sale_payments`: (method, reference) for the duplicate check
- `stock_movements`: (product\_id, created\_at desc)
- `credit_ledger`: (customer\_id, created\_at desc)
- `approval_requests`: (status, created\_at desc); (requested\_by, created\_at desc)
- `attendance`: unique (user\_id, work\_date); (work\_date)

## 6. Security and permissions

Role and active flag live in `profiles`. RLS policies check them through small helper functions (`current_role()`, `is_active()`) that read `profiles` live, so a role change or deactivation takes effect immediately. Clients never write directly to anything that moves money, stock or pay: they call security-definer database functions that check the caller, validate input and write the audit log in the same transaction. Anything that needs the Owner's permission is saved as an approval request; only `decide_approval`, callable by the Owner, applies it.

### 6.1 Permission matrix

| Action | Owner | Special Sales | Sales |
| --- | --- | --- | --- |
| Clock in (own, at the store) | Only if "Owner clocks in too" is on (off by default) | Yes | Yes |
| Request an attendance correction | No | Yes | Yes |
| View own attendance, penalties and finalized payslips | Yes | Yes | Yes |
| View and edit everyone's attendance; set store location, schedule and daily rates; approve corrections; run payroll, record cash advances, mark payslips paid | Yes | No | No |
| Sell, hold | Yes | Yes | Yes |
| Open the day's drawer, record cash-in/out | Yes | Yes | Yes |
| Count and close the drawer | Yes | Yes | No |
| Reopen a closed drawer, see expected cash before the count | Yes | No | No |
| Pick a preset discount or package deal | Yes | Yes | Yes |
| Define preset discounts, package deals and payment accounts | Yes | No | No |
| Credit sale over limit | Yes | Needs approval | Needs approval |
| Correct or void a sale, process return | Yes | Needs approval | Needs approval |
| Add credit customer, record utang payment | Yes | Yes | Yes |
| Edit customer, credit limit | Yes | No | No |
| View products and stock levels | Yes | Yes | Yes |
| Add products, categories, suppliers; assign SKU | Yes | Yes | No |
| Stock-in from supplier | Yes | Yes | No |
| Edit or deactivate products, change price | Yes | Needs approval | No |
| Stock adjustment, correct or delete a stock-in, physical count | Yes | Needs approval | No |
| Sales reports | All | Own sales (sales history: the last 30 days) | Own sales (sales history: the last 30 days) |
| Cost and profit figures | Yes | No | No |
| Users, roles, settings, decide approvals | Yes | No | No |
| Audit log | Yes | No | No |

### 6.2 Row Level Security principles

- Default deny: RLS is enabled on every table; a table with no policy for a role gives that role nothing. The `anon` role gets no access to any table.
- Clients write through database functions only, including creating categories, suppliers and approval requests. The exceptions are managing their own `devices` rows and uploading or deleting product photos in Storage (SEC-09); each of these policies checks role, active flag, own `user_id` and `branch_id`.
- `sales`, `sale_items`, `sale_payments`, `stock_movements`, `credit_ledger`, `drawer_entries` and `audit_logs` have no UPDATE or DELETE grants for API roles. Corrections are new rows.
- On `products`, UPDATE on `stock_qty` and `sell_price` is revoked from the `authenticated` role (column privileges); only functions change them.
- `product_costs`, `pay_rates`, `payroll_runs`, `cash_advances` and cost/profit views are readable by the Owner only. Staff read only their own finalized `payslips`. Non-Owners read sale lines through a view without `unit_cost`.
- Every security-definer function sets a fixed `search_path`, checks `auth.uid()`, role and active flag, and validates its input. Internal functions are not executable by `anon` or `authenticated`.
- Owner-only data and functions also require a two-factor session (`aal2` in the JWT).
- Policies and functions are tested with pgTAP against a local Supabase in CI; a failing test blocks the merge.

### 6.3 Hardening: no way in except a valid, active account with the right role

The Supabase project URL and anon key are public by design, so anyone can call the API without the app. Security therefore rests on server-side checks only: Auth settings, RLS, database functions and Edge Functions. Every control below is a launch requirement.

| ID | Area | Control |
| --- | --- | --- |
| SEC-01 | Sign-up | "Allow new users to sign up" is off in Supabase Auth. Accounts are created only by an Owner-only Edge Function using the service role on the server. Supabase's default lets anyone with the public anon key sign up, so this closes the biggest backdoor. |
| SEC-02 | Accounts | Policies require an active `profiles` row with a valid role. A user with no profile, or an inactive one, can read and write nothing. |
| SEC-03 | First Owner | The first Owner is created once by a local script run with the service role key from the developer's machine (never committed), which refuses to run if an Owner exists and is deleted after use. No default credentials, hard-coded admins or hidden setup pages. |
| SEC-04 | Deactivation | Deactivating sets `active = false`, bans the Auth user and signs out all sessions in one Edge Function call. Because RLS reads `active` live, access ends immediately. Reactivating sets `active = true` and lifts the ban in one Edge Function call, by an active Owner of the same branch with the second step (SEC-05), and is written to the audit log. |
| SEC-05 | Owner login | The Owner account requires TOTP two-factor; Owner-only data requires an `aal2` session. Staff passwords: minimum 10 characters. Supabase's leaked-password protection needs a paid plan, so the app checks a new password against Have I Been Pwned's Pwned Passwords range API before saving it: only the first 5 characters of its SHA-1 hash leave the device, and a password found in a breach is refused. If the service cannot be reached, the password is accepted. This check runs in the browser, so it guards against careless choices, not a user who bypasses the app. |
| SEC-06 | Bots and abuse | CAPTCHA (Cloudflare Turnstile) on sign-in and password reset; Supabase Auth rate limits tightened; Edge Functions verify the caller's JWT. |
| SEC-07 | Policy depth | Column privileges, CHECK constraints (positive amounts, valid statuses) and input validation in every function. Only the needed schemas are exposed through the API, and GraphQL is disabled if unused. Sales see only what their screens need. |
| SEC-08 | Functions | Every database function and Edge Function checks auth, role, active flag and input. No unauthenticated endpoints. |
| SEC-09 | Storage | One `product-images` bucket, public to read (product photos are not sensitive, and fixed links keep egress low): JPEG only, at most 1 MB a file, at `products/<product>/<key>-200.jpg` and `-800.jpg`. Uploaded only by the Owner and Special Sales, for their branch's products; never overwritten; deleted by the Owner, or by the uploader for their own files, and never while a product or a pending request uses them. A photo shows only once `set_product_photo` or an approved request points the product at it. |
| SEC-10 | Keys and access | The service role key and database password live only in Supabase secrets and GitHub environment secrets (production deploys need manual approval). Never in the frontend, repository or chat. Only the Owner is an owner of the Supabase organization; two-factor on Supabase, GitHub and Cloudflare accounts. |
| SEC-11 | Repository | The repository is public: no secrets, keys, passwords, customer data or real store details in code, commit history, issues, pull requests or Actions logs; keys live only in GitHub environment secrets, Supabase and Cloudflare settings. Protected `main` (PR review and passing CI required), secret scanning and Dependabot on, `npm audit` in CI. No debug, test or seed routes in production builds; `seed.sql` is for local development only. |
| SEC-12 | Web headers | The host sends Content-Security-Policy (own origin plus the Supabase project URL), HSTS, X-Frame-Options DENY, X-Content-Type-Options and a strict Referrer-Policy. No `dangerouslySetInnerHTML`. |
| SEC-13 | Lost device | The Owner can sign a user out everywhere without deactivating them. The idle lock limits what a found, unlocked phone can do. |
| SEC-14 | Monitoring | Alerts to the Owner on role changes, a new device on the Owner account, many voids or corrections by one user in a day, repeated failed sign-ins, function errors and usage spikes. |
| SEC-15 | Recovery | Encrypted backups (SYS-04): the repository is public, so a backup on GitHub is downloadable while it is kept and is protected only by its encryption; the private key never goes into GitHub. A restore is rehearsed on staging before launch. |
| SEC-16 | Verification | Before go-live: pgTAP tests cover every table and role, including anon, no profile, deactivated, wrong role and Owner without two-factor; the Supabase security advisor shows no warnings; an OWASP Top 10 review; and a manual attempt to read and write data with the anon key from outside the app, which must fail. |

Residual risks: a staff member's unlocked phone acts with that person's role until it locks or is signed out; someone who can read the browser's storage on a signed-in device (developer tools on an unlocked laptop, a rooted phone) can copy the offline-unlock hash and guess the password away from the app, which the slow hash, the 10-character minimum and the breached-password check (SEC-05) only slow down; a password changed on another device still unlocks this device offline until its next online unlock; browser location can be faked; the Owner's own account is the single most valuable target, hence 2FA.

## 7. Architecture, repository and deployment

A React PWA talks to Supabase through `supabase-js`. Reads go through RLS; anything that moves money, stock or pay calls a Postgres function. Edge Functions handle only what needs the service role or an outside service: user administration. Sales and clock-ins made offline wait in a local outbox.

### 7.1 Stack

| Layer | Choice |
| --- | --- |
| Frontend | React 18 + TypeScript, Vite, React Router |
| UI | React + Tailwind v4 + shadcn/ui-style Radix components, themed to the approved "price card and peso note" look (7.2; lucide-react, strokeWidth 2.75); responsive layouts for phone, tablet and laptop |
| Data | `supabase-js` through a small live-list hook (`useLiveRows`: load the rows, then load them again when Supabase Realtime reports a change) for live stock and approvals; Zustand for cart and session |
| Forms | React Hook Form + Zod |
| Offline / install | `vite-plugin-pwa`; IndexedDB (Dexie) for the cached product list and the outbox of sales and clock-ins. The cached product and category lists belong to the signed-in user and are cleared on sign-out, deactivation and "sign out everywhere" (never cost prices) |
| Product search | Client-side filtering of the cached product list (a plain text match on name and SKU; a fuzzy matcher only if the store needs one) |
| Location | Browser Geolocation API (`enableHighAccuracy`, 10 s timeout); distance computed again in `clock_in` |
| Receipts | On-screen slip only |
| Database | Supabase Postgres (Singapore): SQL migrations, RLS, security-definer functions, pg\_cron for scheduled jobs |
| Edge Functions | Deno + TypeScript: `admin-users` (create, role, deactivate, reactivate, sign out everywhere, password reset link) |
| Auth | Supabase Auth: email and password, TOTP two-factor, Turnstile CAPTCHA |
| Hosting | Cloudflare Pages (static SPA), headers in `apps/web/public/_headers`; fonts are bundled with the app, so nothing loads from Google |
| Testing | Vitest, pgTAP (`supabase test db`), Playwright for the checkout flow |

**Free plan.** The system runs on the Supabase Free plan permanently, so every design is checked against its quotas (as listed on supabase.com/pricing in October 2026): database 500 MB, file storage 1 GB, egress 5 GB plus cached egress 5 GB a month, Realtime 200 concurrent connections and 2 million messages a month, Edge Functions 500,000 invocations a month, no server-side image transformations, and a pause after a week without user database activity (the heartbeat workflow prevents it with a query every 6 hours; GitHub Actions minutes are free in a public repository). Product photos are resized in the browser and cached for a year at paths that never change, which keeps their egress to a few hundred MB a month.

**Must fix before checkout (build step 9) goes live:** `useLiveRows` loads a whole list again on every change. For the product list (about 100 KB for 500 products) that is fine while only stock-ins and edits change products, but once every sale changes `stock_qty`, 500 sales a day on 20 phones would be about 1 GB of egress a day, and the Realtime messages would approach the monthly quota. Build step 7 changes it to apply only the changed row from the Realtime message, and the Realtime message count is checked again then. *Done:* step 7 applies the changed row, and step 9 (Nov 2026) keeps the product list live only on Sell and the Products screens; every other screen, including the Owner's low-stock card, loads it once when it opens. Each sale line changes one product, and each device watching products gets one message for it: at 500 sales a day of 3 lines on 20 devices, about 30,000 messages a day, roughly 0.9 million a month (45% of the 2 million); at 150 sales a day on 10 devices, about 0.14 million. The Owner's drawer report also watches that drawer's sales while it is open (one message a sale). Each device holds one Realtime connection (20 of the 200).

**Archive plan, required before go-live:** sales are what can fill the 500 MB database. Measured with complete\_sale (Nov 2026): about 1.9 KB a sale with 3 lines, its payment, its 3 stock movements and every index; with 20% allowed for dead rows and growth, about 2.2 KB. With about 470 MB free: at 150 sales a day, about 10 MB a month, so roughly 46 months (almost 4 years) until 500 MB; at 500 sales a day, about 34 MB a month, roughly 14 months. Once a year, sales and their lines older than the period still open to returns and corrections are exported into the backup, and the app keeps their daily totals so reports stay whole. No sale gets an audit log line of its own, because the sale is already the record. The exact period, the export and its restore check are built and tested before go-live.

### 7.2 UI design

The UI reference is the design canvas **POS redesign proposal** (a private claude.ai artifact in the developer's account; the link is not published here because the repository is public). The owner approved its look on Nov 13, 2026; it replaces the first look, the **Organic** design system of the Claude Design project **POS checkout and navigation design**, which stays only as the record of what each screen holds. UI stack: React + Tailwind v4 + shadcn/ui-style Radix components, themed with the tokens in `apps/web/src/styles/index.css` (lucide-react, strokeWidth 2.75). The app ports the canvas's tokens and rebuilds its components; it never loads the canvas's files.

**The look, "price card and peso note".** A cool shelf-grey page, black ink and white panels; one lime "price card" colour, used only for actions that move money (Pay, Complete sale, Open drawer, Close drawer: the `money` button); peso-bill colours (₱1000 blue, ₱500 yellow, ₱200 green, ₱100 mauve, ₱50 red, ₱20 orange) only where cash is counted or handed over; selected tabs and menu items are ink, and good states (Online, saved, approved) use a status green, which is not lime; one typeface, Archivo (bundled), wide and heavy for headings and amounts; corners of 6 to 12 px instead of pills; light for the shop floor, dark for evenings.

**Rule.** This SRS and the build order decide *what* the app does; the design decides *how it looks*. Where a design shows different behavior, the app follows the SRS and styles it with the design.

- **Design-only features are not built** unless the developer adds them to this SRS: email two-step codes and "trust this device", staff PIN unlock, approving from the notification, the live attendance map, photos on adjustment requests, drawer over/short tolerance, a default credit limit, signing out one device, keyboard shortcuts, the Light/Dark/Auto setting, offline stock-ins, the tablet rail's "expand menu" toggle, the Notifications settings tab and the "Date received" field on stock-in.
- **What the app has and the design lacks is kept:** backups, add user, password reset link, the stock-in list, receipt, corrections and history, the photo panel, CSV export, product edit, withdrawing a request, and Sign out in the menu.
- Product list rows show the product photo when there is one, otherwise the category icon. Every list loads in pages and ends with "Load more" and "Showing N of M" (the count comes with the first page; a slow list such as stock history may use an estimated count).
- Order: the build order above. The shared tokens and components took the new look in one change (Nov 2026); each screen is then restyled to its canvas board when a step touches it, and the rest in step 15.
- Navigation: items a role can't use, or that aren't built yet, are hidden. On phones the bottom bar shows up to five items; past five it keeps the role's four most-used (Owner: Home, Sell, Approvals, Inventory; Special Sales: Sell, Inventory, Sales, Customers; Sales: Sell, Sales, Customers, Drawer) plus More, which holds the rest and Sign out. Products and Stock-in stay separate menu items until the Inventory screens are restyled, then become one Inventory item. Sales keeps Products in the menu (6.1: Sales views products and stock), although the design hides it.
- The connection indicator shows Online, Offline, or the number of changes waiting to sync. "Working locally" wording waits for the offline outbox (the first part of build step 9).

**Standard values.** Where the screens disagree, the app uses these:

| Item | Standard |
| --- | --- |
| Dialogs and sheets | Page background (`--color-bg`), not surface; scrim black at 55% in both themes; dialog radius 12 px, bottom sheet top radius 20 px |
| Field labels | 13 px |
| Inputs on phone and tablet forms | 48 px tall, 15 px text, 12 px radius |
| Buttons | 44 px for row and toolbar actions, 56 px for the main action at the bottom of a phone screen; 12 px radius; the main action is ink, except money actions, which are lime |
| Filter chips | 40 px, 10 px radius; the chosen chip is ink |
| Status badges | 12 px bold, 3 × 10 px padding, 6 px radius, icon and words together; pending is pending-bg / pending-fg |
| Tags (role, Draft) | 11 px bold, 6 px radius |
| Cards | 12 px radius for list cards, panels and tables |
| Amounts | Archivo wide and heavy (`font-heading`), tabular figures |
| Empty and error states | 110 px icon circle on a full page, 96 px inside a panel |
| Loading placeholders | Static bars: neutral-300 and neutral-200 on cards, surface and neutral-200 on the page |
| Dark mode | The canvas's dark palette (in `index.css`), following the device setting |

The canvas boards, by screen: Sell, cart, payment and slip (phone and laptop); cash drawer (open, blind count, result, laptop); dashboard; phone navigation by role and the More sheet; sign-in and the Owner's code; my sales and sale detail; inventory and the product page; customers and the ledger; approvals; reports; settings (discounts and deals). Each is drawn light and dark. Not drawn yet: utang payment, stock-in, attendance and clock-in, payroll, users and devices; until they are, those screens follow the drawn ones.

The first look's screen files (Organic) and the build step each belongs to, kept as the record of what each screen holds:

| Screen file | Build step |
| --- | --- |
| `Sign-in.dc.html`, `Nav.dc.html`, `Settings.dc.html` | Foundation and 1 (built) |
| `Inventory.dc.html` | 2, 4 and 5 (built: products, stock) |
| `Approvals.dc.html` | 3 (built) |
| `Stock-in.dc.html` | 4 (built) |
| `Cash Drawer.dc.html` | 8 |
| `POS Index.dc.html`, `POS Checkout.dc.html`, `POS Payment.dc.html` | 9 |
| `Sales History.dc.html` | 9 and 10 |
| `Clock-in.dc.html`, `Attendance.dc.html` | 11 |
| `Customers.dc.html` | 12 |
| `Dashboard.dc.html`, `Reports.dc.html` | 13 (the home page until then) |
| `Payroll.dc.html` | 14 |

Where a design shows something this SRS leaves out or has dropped (for example barcode scanning or CSV import before step 15), the SRS wins and the screen is built without it.

The shared components that carry these values live in `apps/web/src/components/ui/` (Button, Input, Label, Tag, Alert, Dialog, Sheet, Card, Table, StatusBadge, Stepper, Switch, Checkbox, FilterChips, EmptyState, Skeleton, LoadMore, ConnectionPill); screens use them rather than restating the values.

### 7.3 Repository layout (monorepo)

```
POS/
  apps/web/              React PWA
    src/features/        auth, users, audit, settings, store, backups, catalog, approvals, stock, home
                         (pos, drawer, customers, attendance, payroll, reports come with their steps)
    src/lib/supabase.ts
    src/lib/outbox.ts
  supabase/
    migrations/          schema, RLS policies, functions (SQL)
    functions/           Edge Functions (admin-users)
    tests/               pgTAP tests
    seed.sql             local development data only
    config.toml
  scripts/bootstrap-owner.ts
  .github/workflows/     ci.yml, deploy.yml, heartbeat.yml
```

### 7.4 Environments and deployment

| Environment | Supabase | Frontend | Deployed from |
| --- | --- | --- | --- |
| Local | `supabase start` (Docker) | Vite dev server | Developer machine |
| Staging | `pos-staging` project | Cloudflare Pages preview branch `dev` | The `dev` branch |
| Production | `pos-prod` project | Cloudflare Pages production | `main` branch; database changes after a tagged release |

- Branching: feature branches → PR into `dev` → release PR into `main`. `main` is protected and needs passing CI.
- CI on every PR: lint, type-check, unit tests, `supabase db reset` plus pgTAP tests on a local Supabase, build.
- Deploy: GitHub Actions applies migrations with `supabase db push` and deploys Edge Functions with `supabase functions deploy`, using secrets in a GitHub environment that requires manual approval for production. Cloudflare Pages deploys the frontend from the same branches.
- Config: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` per environment. The service role key never reaches the frontend.

### 7.5 Migration from the Firebase build

Phase 0 was first built on Firebase. The UI, design tokens, routing and app shell carry over unchanged; the backend layer is replaced, and all Firebase code, config and dependencies are removed.

| Firebase build | Supabase replacement |
| --- | --- |
| `lib/firebase.ts`, `VITE_FIREBASE_*` | `lib/supabase.ts`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Firebase Auth email + password, TOTP second factor | Supabase Auth email + password, TOTP MFA (`aal2`) |
| Custom claims (role, branchId, active) | `profiles` table read live by RLS helpers; no token-expiry gap after a role change or deactivation |
| Blocking `beforeUserSignedIn` (refuse accounts without claims, log sign-ins) | Sign-in proceeds, then the app loads the profile and signs out users with no active profile; RLS denies them anyway. Sign-ins are logged by a `record_sign_in` function called after sign-in, plus Supabase Auth logs |
| Callable functions `createUser`, `updateUser`, `setUserRole`, `deactivateUser`, `signOutEverywhere`, `createPasswordResetLink` | Edge Function `admin-users` with the same actions plus `reactivate` (AUTH-02), same Zod schemas and the same Owner-only guard (JWT, role, active, `aal2`) |
| Shared guard incl. App Check | Same guard minus App Check; Turnstile CAPTCHA on sign-in and password reset instead |
| `users/{uid}`, `users/{uid}/devices/{tag}`, `auditLogs` | `profiles`, `devices`, `audit_logs` tables |
| `firestore.rules`, `storage.rules` and rules tests | RLS policies and storage policies in migrations, with pgTAP tests porting the same cases |
| Emulator Suite with relaxed rules copy | `supabase start` locally; MFA can be tested for real, so no relaxed copy is needed |
| `scripts/bootstrap-owner.ts` with ADC | Same script using the service role key from the local environment only |
| Firebase Hosting headers in `firebase.json` | Cloudflare Pages headers in `apps/web/public/_headers` |
| `deploy.yml` with Workload Identity Federation | `deploy.yml` with `supabase db push` and `supabase functions deploy`, secrets in a protected GitHub environment |
| Firestore offline cache | Dexie (IndexedDB) product cache and outbox, built with the POS in Phase 2 |

## 8. Release phases and open questions

The store can start selling after Phase 2; each later phase ships on its own.

1. **Phase 0 – Foundation.** Repo, CI/CD, staging and production Supabase projects, local Supabase, Supabase migrations, auth with roles in profiles, user management, device tags, settings.
2. **Phase 1 – Catalog, inventory and approvals.** Products with manual SKUs, categories, suppliers, photos, CSV export, stock-in, movement history, low-stock list, approval requests with a live list and count badge for the Owner.
3. **Phase 2 – POS and attendance (go-live gate).** Checkout by name search, category or SKU; cash, GCash and Maya; digital slips; daily cash drawer with closing count; offline mode; voids and returns through approval; audit log. Attendance with location check, late deductions and correction requests, and the Owner's attendance board. Gate: one week of parallel run against the store's current method with zero stock, cash or attendance discrepancies traced to the system.
4. **Phase 3 – Credit.** Customers, credit sales, utang payments, ledger, aging report.
5. **Phase 4 – Reports.** Dashboard, report views, sales and profit reports, attendance summaries, payroll runs with payslips and cash advances, CSV export, backups verified.
6. **Phase 5 – Polish.** Held sales, physical count, CSV import of products.

### Build order

The phases above are built in this order, one step (one or a few pull requests) at a time:

1. Store settings: details, location for clock-in, attendance rules (**done**)
2. Product catalog: categories, suppliers, products with manual SKU, price log (**done**)
3. Owner approval requests (**done**)
4. Stock-in, stock movements, low stock, cost; adjustments and stock-in corrections (**done**)
5. Product photos and CSV export
6. ~~Push notifications to the Owner~~ (**dropped by the owner's decision (Oct 31, 2026)**)
7. Installable app, offline product list (the offline queue moved to step 9)
8. Cash drawer
9. Checkout: the offline queue (outbox) first, then decimal quantities, payment settings, search, cart, payments, digital slip, offline unlock, preset discounts and package deals
10. Voids, returns, sale corrections
11. Attendance with location check and late rules, then **one week running beside the store's current method before go-live** (the Phase 2 gate)
12. Customer credit (utang)
13. Owner dashboard and reports
14. Payroll
15. Polish: held sales, physical count, CSV import of products

### Open questions

- [x] Does the owner need BIR-registered receipts? *No: the app never issues official receipts (Nov 1, 2026).*
- [x] Are GCash and Maya paid to one store number or QR, or to each salesperson's phone? *To the owner's accounts, possibly more than one: an Owner setting lists them (POS-04).*
- [x] Is VAT applicable (VAT-registered or non-VAT)? *Unknown: an Owner setting, off by default (POS-07).*
- [ ] Should credit customers be shared across future branches or kept per branch?
- [x] Are digital slips enough, or does the store want paper slips from a printer? *Yes: on screen only, no printing (Nov 1, 2026).*
- [x] Should SKUs follow a pattern so the app can suggest the next free one? *Not known yet: SKUs are free-form (PROD-02); "suggest the next number" can be added later.*
- [x] What are this store's coordinates and allowed radius? *Set by the Owner at handover in Store settings; radius 100 m by default; location check off until set.*
- [x] Do this store's shift start times and late deduction match pos-erag? *Not known yet: defaults 6:00 AM / 1:00 PM / 15-minute grace, editable; late deduction none by default, with "minutes late" or a flat amount (₱0 by default) as Owner choices (ATT-06).*
- [x] Does a day that starts with the afternoon shift count as a full day or a half day of pay? *Half day by default, editable by the Owner.*
- [x] Does the Owner clock in too, or only staff? *Staff only by default; the Owner can turn on "Owner clocks in too".*
- [ ] Is there an existing product list (spreadsheet) to import, and roughly how many items? *To find out at handover; products are entered by hand until CSV import (build step 15).*
- [x] Does the store sell anything by weight or length (kg, g, L, m)? *Yes: kg and L, up to 3 decimals (PROD-01).*
- [ ] Does the store sell the same item in two units (for example per stick and per pack)? For now that is two products, each with its own SKU, price and stock.
- [ ] Senior citizen and PWD discounts: required by Philippine law (20% + VAT exemption, or 5% on basic necessities); confirm with the owner before go-live. Not in build step 9: a 20% preset would not handle the VAT exemption or record the customer's ID.
- [ ] If the store turns out to be VAT-registered, the owner should check with an accountant whether unofficial slips are enough.
- [ ] Paper is the backup only when the phone itself is dead. How those paper sales get entered later is not decided and is not in build step 9.
