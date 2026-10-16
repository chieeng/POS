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
- Receipts are shown on screen and can be shared or printed; they are sales slips, not BIR official receipts, unless the owner decides otherwise (see Open questions).
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
- Peripherals: none required. No barcode scanner or dedicated terminal. A printer is optional for slips.
- Notifications: standard Web Push to the Owner's devices for approval requests, sent by a Supabase Edge Function.
- Backend: Supabase (Postgres, Auth, Storage, Edge Functions, Realtime) on the Free plan, region Southeast Asia (Singapore). Both projects stay on the Free plan permanently.
- Frontend hosting: Cloudflare Pages (static single-page app).
- Source: GitHub repository https://github.com/chieeng/POS with Actions for CI and database migrations.

**Constraints**

- Supabase has no built-in offline writes. Offline selling and clock-in need a local outbox (IndexedDB) with client-generated ids so a resent record is never saved twice. All other actions require internet.
- The Supabase URL and anon key are public by design; security depends entirely on Row Level Security and database functions.
- The Supabase Free plan pauses a project after a period without activity, and has no backups the store can restore from and no point-in-time recovery. A daily heartbeat keeps both projects active, and production is backed up by the app's own nightly encrypted backup (SYS-04). Features that need a paid plan are not used.
- Must comply with the Data Privacy Act of 2012 for customer names and phone numbers kept for utang.

## 3. Functional requirements

Requirements are numbered by module. Priority: **M** = must have for launch, **S** = should have, **C** = could have later.

### 3.1 Authentication and users (AUTH)

| ID | Requirement | Priority |
| --- | --- | --- |
| AUTH-01 | Users sign in with email and password through Supabase Auth on their own phone or laptop. | M |
| AUTH-02 | The Owner creates, edits, deactivates users and assigns one role each: Owner, Special Sales or Sales. A new user gets a one-time link to set their own password; the Owner never sets or sees a password. User codes are 2 to 6 letters or digits, unique per branch. The Owner cannot demote or deactivate their own account. Users are never hard-deleted. | M |
| AUTH-03 | Role and active flag are stored in the profiles table and can be changed only through an Owner-only Edge Function or database function, never by direct table writes. | M |
| AUTH-04 | A user may be signed in on more than one of their own devices. The Owner can sign a user out of all devices (lost phone, staff leaving). | M |
| AUTH-05 | The app locks after 15 minutes idle (configurable) and asks for the user's password to resume. A staff PIN is not used. | S |

### 3.2 Products and catalog (PROD)

| ID | Requirement | Priority |
| --- | --- | --- |
| PROD-01 | Products have: name, SKU, category, selling price per piece, reorder level, active flag, photo. | M |
| PROD-02 | Special Sales types the SKU manually when adding a product. SKUs are unique per branch; duplicates are rejected. | M |
| PROD-03 | Special Sales and the Owner add products, categories and suppliers directly. | M |
| PROD-04 | Edits and deactivation by Special Sales (name, SKU, price, category, unit) go through an Owner approval request; the Owner edits directly. | M |
| PROD-05 | Every price change is logged with old price, new price, user and time. | M |
| PROD-06 | Bulk import and export products by CSV (Owner only). | S |

### 3.3 Point of sale (POS)

| ID | Requirement | Priority |
| --- | --- | --- |
| POS-01 | Find items by name search (partial, case-insensitive), by tapping a category and then the item, or by typing the SKU. Tapping an item adds it; tapping again increases its quantity. | M |
| POS-02 | Edit quantity and remove lines before payment. | M |
| POS-03 | Apply a line or whole-sale discount (amount or %). Discounts above the sales limit need Owner approval; the sale waits as held until approved. | M |
| POS-04 | Accept Cash (compute change), GCash, Maya (reference number required), Credit/utang (customer required), or a split of these. | M |
| POS-05 | Hold a sale and resume it later on the same device. | S |
| POS-06 | Complete a sale in one database transaction (the complete\_sale function): sale, lines, payments, stock decrement per line, stock movements, drawer totals. Offline, the sale goes to the device's outbox and is submitted when online; its client-generated id makes a resubmission safe. | M |
| POS-07 | After payment, show a digital slip with store info, receipt number, items, totals, payment, salesperson, and "This is not an official receipt" unless configured otherwise. The slip can be shared as an image or PDF, or printed if the device has a printer. Re-sharing is logged. | M |
| POS-08 | Receipt numbers are unique without a central counter: `<user code>-<YYYYMMDD>-<device tag>-<sequence kept on the device>`. | M |
| POS-09 | Warn when an item's stock would go below zero; allow the sale (the item is physically in hand) and flag it for Special Sales. | M |
| POS-10 | Void a completed sale (same day) or process a return/refund (any day) through an Owner approval request with a reason; stock is restored when approved. | M |
| POS-11 | Sale correction request: when a sale was entered wrong (item, quantity, price, discount, payment method or customer), the salesperson opens it, makes the fixes, and sends them to the Owner with a reason. The Owner sees the original and the corrected version side by side and approves or rejects. | M |
| POS-12 | On approval, the original sale is marked "corrected" and a new sale with the fixes is created and linked to it. Stock, drawer totals and utang balances are adjusted by the difference. The original is never edited or deleted. | M |
| POS-13 | Duplicate reference check: a GCash or Maya reference number already used on another sale or utang payment is rejected while online. Sales made offline are checked when they sync; a duplicate is flagged on both sales and the Owner is notified. | M |

### 3.4 Cash drawer (SHIFT)

| ID | Requirement | Priority |
| --- | --- | --- |
| SHIFT-01 | The store has one shared cash drawer; all cash payments go into it. Each day the first staff member enters the opening cash. The app pre-fills yesterday's counted closing cash; if the amount entered differs, the difference is flagged for the Owner. Only one drawer session can be open per day. | M |
| SHIFT-02 | Any staff member can record cash-in and cash-out (change fund, petty expense) with a reason; each entry is logged with their name. | M |
| SHIFT-03 | At closing, the Owner or a Special Sales counts the drawer. The system shows expected cash (opening + cash sales + cash utang payments − cash refunds − cash-outs) and records the over/short. | M |
| SHIFT-04 | Daily drawer report: sales by payment method and by salesperson, voids, corrections, refunds, utang collected, cash-in/out, over/short. | M |

### 3.5 Inventory (INV)

| ID | Requirement | Priority |
| --- | --- | --- |
| INV-01 | Every quantity change writes a stock movement: sale, void, return, stock-in, adjustment, count correction. | M |
| INV-02 | Stock-in (Special Sales, Owner): search the product by name or SKU, type the quantity and unit cost, with optional supplier and DR/invoice number. Applied immediately. | M |
| INV-03 | A new product can be created during stock-in, with its SKU typed manually. | M |
| INV-04 | Adjustments (damage, loss, expiry, found items) and corrections or deletions of past stock-ins: Special Sales submits an Owner approval request with a reason; the Owner applies them directly. | M |
| INV-05 | Low-stock list of products at or below reorder level, shown on the dashboard. | M |
| INV-06 | Stock movement history per product, filterable by date and type. | M |
| INV-07 | Physical count: enter counted quantities; the differences are submitted together as one approval request. | S |
| INV-08 | Cost price updates on stock-in use weighted average cost. | S |

### 3.6 Customers and credit (CRED)

| ID | Requirement | Priority |
| --- | --- | --- |
| CRED-01 | Manage credit customers: name, phone, address, credit limit, active flag. | M |
| CRED-02 | A credit sale needs a selected customer; sales beyond the credit limit need a Owner approval. | M |
| CRED-03 | Record payments against a customer's balance (cash, GCash, Maya), with a printed acknowledgment. | M |
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
| SYS-01 | Store settings: name, address, contact, TIN, receipt footer, sales discount limit, idle lock time. | M |
| SYS-02 | Each browser creates a 4-character device tag on first sign-in, stored locally and registered in the devices table, used in receipt numbers and the audit log. The Owner can see each user's active devices. | M |
| SYS-03 | Audit log of sensitive actions: sign-in, user and role changes, price changes, approval requests and decisions, voids, refunds, stock adjustments, slip re-shares. Read-only. | M |
| SYS-04 | Nightly encrypted backup of the production database to a private Cloudflare R2 bucket, within R2's free tier, with an alert to the Owner if a backup fails. | M |

### 3.9 Owner approvals (APPR)

| ID | Requirement | Priority |
| --- | --- | --- |
| APPR-01 | These actions by non-Owners create an approval request instead of applying: product edit or deactivation, stock adjustment, correcting or deleting a stock-in, physical count differences, sale correction, void, return/refund, discount over limit, credit sale over limit. | M |
| APPR-02 | A request stores what changes (before and after), the reason, the requester and the time. Nothing changes until the Owner approves. | M |
| APPR-03 | The Owner gets a push notification and a pending list, and approves or rejects with an optional note. | M |
| APPR-04 | On approval, the decide\_approval database function applies the change in one transaction, writes the stock movement if any, and logs it. | M |
| APPR-05 | The requester sees the status of their requests and the Owner's note. | M |

### 3.10 Attendance (ATT)

Staff clock in once a day on their own device, with no clock-out, and the store's location decides whether it counts. The rules follow the attendance policy already used for pos-erag; every value is a setting the Owner can change.

| ID | Requirement | Priority |
| --- | --- | --- |
| ATT-01 | Each user clocks in once per day with one tap from their own device. There is no clock-out. A second clock-in on the same day is refused. | M |
| ATT-02 | At clock-in the app reads the device location (browser Geolocation API, high accuracy) and checks its distance from the store's set coordinates against a radius set by the Owner. | M |
| ATT-03 | Inside the radius: allowed. Location found with good accuracy but outside the radius: blocked, showing how far away the user is. | M |
| ATT-04 | Location not detected (permission denied, GPS off, timeout, or accuracy worse than the radius): allowed with a warning; the record is flagged "location not verified" for the Owner to review. | M |
| ATT-05 | Location is captured only at the moment of clock-in (latitude, longitude, accuracy, distance). It is never tracked in the background. | M |
| ATT-06 | Late rule: clocking in after the set clock-in time plus the grace period records the late penalty. Defaults from pos-erag: morning 6:00 AM, afternoon 1:00 PM, 15-minute grace, ₱50 penalty. The shift is matched by the clock-in time. | M |
| ATT-07 | Attendance settings screen (Owner only): set the clock-in time for each shift, the grace period in minutes, and the late penalty amount in pesos. | M |
| ATT-08 | The Owner can give a staff member their own clock-in time, which replaces the shift time for that person only. | S |
| ATT-09 | A settings change applies from the next clock-in onward. Each record stores the clock-in time, grace and penalty used, so past records and pay never change. Every change is audit-logged with old and new values. | M |
| ATT-10 | Pay for a day = daily rate (a day starting with the afternoon shift counts as a full or half day, per Owner setting) minus any late penalty. No hours or overtime are computed. Daily rates are visible to the Owner only. | M |
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
| NFR-02 | Offline | Checkout, clock-in and product search work with no internet: sales and clock-ins wait in the device outbox and sync automatically within 1 minute of reconnecting. Stock-in, approvals, payroll, reports and settings need internet. A visible indicator shows online/offline and pending-sync count. Approval requests wait until online. |
| NFR-03 | Availability | Frontend on Cloudflare Pages, backend on Supabase; the app shell loads from the PWA cache even when the host is unreachable. |
| NFR-04 | Security | All access enforced by Row Level Security and database functions, never by UI alone. HTTPS only. No secrets in the repository. Personal devices are untrusted: no data beyond the user's role is ever sent to them. |
| NFR-05 | Data integrity | Sales and stock movements are append-only; corrections are new records, never edits or deletes. |
| NFR-06 | Auditability | Every sensitive action is traceable to a user, device tag and time. |
| NFR-07 | Backup | Nightly encrypted backup to Cloudflare R2 (SYS-04); at most one day of data can be lost. A restore is tested once on staging before launch, following the written restore steps. |
| NFR-08 | Usability | Mobile-first: every screen works on a 360 px wide phone; touch targets at least 44 px; a new salesperson can complete a sale after 15 minutes of training. |
| NFR-09 | Scalability | Supports 20 users signed in on up to 30 devices, 10,000 products and 500 sales per day without design changes. |
| NFR-10 | Cost | No running costs: both Supabase projects on the Free plan, Cloudflare Pages and R2 within their free tiers, GitHub Actions within the free minutes. Nothing is set up that can bill without a cap. |
| NFR-11 | Privacy | Customer data limited to name, phone and address; visible only to roles that need it (Data Privacy Act of 2012). |
| NFR-12 | Maintainability | TypeScript, ESLint and Prettier; RLS policies and database functions covered by pgTAP tests in CI. |

## 5. Data model

About 25 PostgreSQL tables in the `public` schema, with `branch_id` on store-level data so branches can be added later. Money is `numeric(12,2)`; times are `timestamptz` stored in UTC and shown in Asia/Manila. Sale lines copy name, price and cost at the time of sale, so later edits never change past receipts. RLS is enabled on every table. The diagram shows the main tables and their links.

&#91;embedded content: ERD · 13 collections and their links\]

A sale links its shift, salesperson and optional customer, and spawns stock movements, credit charges and returns. Products gain stock only through receipts and approved adjustments, both logged as movements; approval requests record who asked for each change.

### 5.1 Tables

| Table | Key columns | Written by |
| --- | --- | --- |
| `branches` | name, address, contact, tin, receipt\_footer, sales\_discount\_limit, idle\_lock\_minutes, store\_lat, store\_lng, radius\_m, morning\_clock\_in, afternoon\_clock\_in, grace\_minutes, late\_penalty, afternoon\_day\_credit | Owner |
| `profiles` | id (= auth user id), display\_name, role (owner, special\_sales, sales), user\_code, branch\_id, active, clock\_in\_override, created\_at | Owner-only Edge Function / function |
| `devices` | user\_id, device\_tag, label, push\_subscription, last\_seen\_at | The user (own rows) |
| `pay_rates` | user\_id, daily\_rate, effective\_from, updated\_by | Owner only (read and write) |
| `categories` | branch\_id, name, active | Special Sales (create), Owner |
| `suppliers` | branch\_id, name, contact\_person, phone, address, active | Special Sales (create), Owner |
| `products` | branch\_id, sku (unique per branch), name, category\_id, sell\_price, stock\_qty, reorder\_level, image\_path, active, updated\_at | Special Sales (create), Owner (edit); `stock_qty` only via functions |
| `product_costs` | product\_id, cost\_price (weighted average), updated\_at | Functions only; Owner-only read |
| `customers` | branch\_id, name, phone, address, credit\_limit, balance, active | Sales (create), Owner (edit); `balance` only via functions |
| `drawer_sessions` | branch\_id, business\_date (unique per branch), opened\_by, opening\_cash, prefill\_difference, closed\_by, counted\_cash, expected\_cash, over\_short, status | open\_drawer / close\_drawer functions |
| `drawer_entries` | session\_id, type (cash\_in, cash\_out), amount, reason, user\_id, created\_at | Function; append-only |
| `sales` | id (client-generated UUID), receipt\_no (unique), branch\_id, session\_id, salesperson\_id, device\_tag, customer\_id, subtotal, discount\_total, total, change, status (completed, voided, corrected), correction\_of, voided\_by, void\_reason, flags, created\_at, synced\_at | complete\_sale and approval functions only; append-only |
| `sale_items` | sale\_id, product\_id, name, sku, qty, unit\_price, unit\_cost, discount, line\_total | complete\_sale only |
| `sale_payments` | sale\_id, method (cash, gcash, maya, credit), amount, reference | complete\_sale only; duplicate GCash/Maya references checked |
| `returns` | sale\_id, items (jsonb), refund\_amount, refund\_method, reason, approval\_id, created\_at | Approval function |
| `stock_receipts`, `stock_receipt_items` | supplier\_id, reference, received\_by, created\_at; product\_id, qty, unit\_cost | record\_stock\_in function |
| `stock_movements` | product\_id, type (sale, void, return, stock\_in, adjustment, count), qty\_change, unit\_cost, ref\_type, ref\_id, user\_id, device\_tag, created\_at | Functions only; append-only |
| `credit_ledger` | customer\_id, type (charge, payment), amount, sale\_id, method, reference, user\_id, created\_at | Functions only; append-only |
| `approval_requests` | type, target\_type, target\_id, before (jsonb), after (jsonb), reason, requested\_by, status (pending, approved, rejected), decided\_by, decided\_at, owner\_note, created\_at | Requester creates pending; decide\_approval (Owner only) |
| `attendance` | user\_id, work\_date (unique per user), shift\_slot, device\_at, server\_at, lat, lng, accuracy\_m, distance\_m, location\_status, scheduled\_clock\_in, grace\_minutes, late\_minutes, late\_penalty, day\_credit, flags, edited\_by, edit\_reason | clock\_in function; Owner edits with reason |
| `payroll_runs` | period\_start, period\_end, status (draft, finalized), totals, finalized\_by, finalized\_at; finalized ranges may not overlap | Owner only |
| `payslips` | run\_id, user\_id, full\_days, half\_days, daily\_rate, gross\_pay, late\_penalties, additions (jsonb), deductions (jsonb), net\_pay, paid\_at, paid\_method, paid\_reference | Drafted by function; Owner edits until finalized; staff read own finalized |
| `cash_advances` | user\_id, amount, advance\_date, note, remaining, status (open, deducted) | Owner only |
| `audit_logs` | action, actor\_id, device\_tag, target\_type, target\_id, before, after, reason, created\_at | Functions and triggers only; append-only |

Reports are SQL views and functions (for example `report_sales(from, to)`), so no pre-computed summary tables are needed. Views that show cost or profit are restricted to the Owner.

### 5.2 Checkout (one transaction, offline-safe)

1. The app builds the sale with a client-generated UUID and receipt number and calls `complete_sale(payload)`. Offline, the payload is stored in the device outbox (IndexedDB) and sent when the connection returns.
2. In one transaction the function checks the caller (active, clocked in, drawer open), recomputes totals from server prices and limits, and flags any difference from what the device showed (possible after an offline price change).
3. It inserts the sale, its items (copying `unit_cost` from `product_costs`) and payments. A reused GCash or Maya reference is rejected online; for an offline sale it is saved and flagged so no sale is lost.
4. It decrements `stock_qty` and writes `stock_movements`; for credit it adds a `credit_ledger` charge and updates the customer balance; it updates the drawer totals and writes the audit log.
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
| Clock in (own, at the store) | Optional | Yes | Yes |
| Request an attendance correction | No | Yes | Yes |
| View own attendance, penalties and finalized payslips | Yes | Yes | Yes |
| View and edit everyone's attendance; set store location, schedule and daily rates; approve corrections; run payroll, record cash advances, mark payslips paid | Yes | No | No |
| Sell, hold, share slip | Yes | Yes | Yes |
| Open the day's drawer, record cash-in/out | Yes | Yes | Yes |
| Discount within limit | Yes | Yes | Yes |
| Discount over limit, credit sale over limit | Yes | Needs approval | Needs approval |
| Correct or void a sale, process return | Yes | Needs approval | Needs approval |
| Add credit customer, record utang payment | Yes | Yes | Yes |
| Edit customer, credit limit | Yes | No | No |
| View products and stock levels | Yes | Yes | Yes |
| Add products, categories, suppliers; assign SKU | Yes | Yes | No |
| Stock-in from supplier | Yes | Yes | No |
| Edit or deactivate products, change price | Yes | Needs approval | No |
| Stock adjustment, correct or delete a stock-in, physical count | Yes | Needs approval | No |
| Sales reports | All | Own sales | Own sales |
| Cost and profit figures | Yes | No | No |
| Users, roles, settings, decide approvals | Yes | No | No |
| Audit log | Yes | No | No |

### 6.2 Row Level Security principles

- Default deny: RLS is enabled on every table; a table with no policy for a role gives that role nothing. The `anon` role gets no access to any table.
- Clients write through database functions only, except: creating categories, suppliers and customers, creating their own pending approval requests, and managing their own `devices` rows. Each of these policies checks role, active flag, own `user_id` and `branch_id`.
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
| SEC-04 | Deactivation | Deactivating sets `active = false`, bans the Auth user and signs out all sessions in one Edge Function call. Because RLS reads `active` live, access ends immediately. |
| SEC-05 | Owner login | The Owner account requires TOTP two-factor; Owner-only data requires an `aal2` session. Staff passwords: minimum 10 characters, leaked-password protection on where the plan allows. |
| SEC-06 | Bots and abuse | CAPTCHA (Cloudflare Turnstile) on sign-in and password reset; Supabase Auth rate limits tightened; Edge Functions verify the caller's JWT. |
| SEC-07 | Policy depth | Column privileges, CHECK constraints (positive amounts, valid statuses) and input validation in every function. Only the needed schemas are exposed through the API, and GraphQL is disabled if unused. Sales see only what their screens need. |
| SEC-08 | Functions | Every database function and Edge Function checks auth, role, active flag and input. No unauthenticated endpoints. |
| SEC-09 | Storage | One `product-images` bucket: images under 2 MB, uploaded only by the Owner and Special Sales, via storage policies. |
| SEC-10 | Keys and access | The service role key and database password live only in Supabase secrets and GitHub environment secrets (production deploys need manual approval). Never in the frontend, repository or chat. Only the Owner is an owner of the Supabase organization; two-factor on Supabase, GitHub and Cloudflare accounts. |
| SEC-11 | Repository | The repository is public: no secrets, keys, passwords, customer data or real store details in code, commit history, issues, pull requests or Actions logs; keys live only in GitHub environment secrets, Supabase and Cloudflare settings. Protected `main` (PR review and passing CI required), secret scanning and Dependabot on, `npm audit` in CI. No debug, test or seed routes in production builds; `seed.sql` is for local development only. |
| SEC-12 | Web headers | The host sends Content-Security-Policy (own origin plus the Supabase project URL), HSTS, X-Frame-Options DENY, X-Content-Type-Options and a strict Referrer-Policy. No `dangerouslySetInnerHTML`. |
| SEC-13 | Lost device | The Owner can sign a user out everywhere without deactivating them. The idle lock limits what a found, unlocked phone can do. |
| SEC-14 | Monitoring | Alerts to the Owner on role changes, a new device on the Owner account, many voids or corrections by one user in a day, repeated failed sign-ins, function errors and usage spikes. |
| SEC-15 | Recovery | Nightly encrypted backups (SYS-04), with an alert if one fails; a restore is rehearsed on staging before launch. |
| SEC-16 | Verification | Before go-live: pgTAP tests cover every table and role, including anon, no profile, deactivated, wrong role and Owner without two-factor; the Supabase security advisor shows no warnings; an OWASP Top 10 review; and a manual attempt to read and write data with the anon key from outside the app, which must fail. |

Residual risks: a staff member's unlocked phone acts with that person's role until it locks or is signed out; browser location can be faked; the Owner's own account is the single most valuable target, hence 2FA.

## 7. Architecture, repository and deployment

A React PWA talks to Supabase through `supabase-js`. Reads go through RLS; anything that moves money, stock or pay calls a Postgres function. Edge Functions handle only what needs the service role or an outside service: user administration and push notifications. Sales and clock-ins made offline wait in a local outbox.

### 7.1 Stack

| Layer | Choice |
| --- | --- |
| Frontend | React 18 + TypeScript, Vite, React Router |
| UI | Tailwind CSS + shadcn/ui, responsive layouts for phone, tablet and laptop |
| Data | `supabase-js` with TanStack Query; Supabase Realtime for live stock and approvals; Zustand for cart and session |
| Forms | React Hook Form + Zod |
| Offline / install | `vite-plugin-pwa`; IndexedDB (Dexie) for the cached product list and the outbox of sales and clock-ins |
| Product search | Client-side filtering of the cached product list (Fuse.js) |
| Location | Browser Geolocation API (`enableHighAccuracy`, 10 s timeout); distance computed again in `clock_in` |
| Receipts | On-screen slip rendered to image or PDF and shared with the Web Share API; browser print as a fallback |
| Notifications | Web Push (VAPID) sent by an Edge Function when an approval request is created |
| Database | Supabase Postgres (Singapore): SQL migrations, RLS, security-definer functions, pg\_cron for scheduled jobs |
| Edge Functions | Deno + TypeScript: `admin-users` (create, role, deactivate, sign out everywhere), `notify` (push) |
| Auth | Supabase Auth: email and password, TOTP two-factor, Turnstile CAPTCHA |
| Hosting | Cloudflare Pages (static SPA), headers in `apps/web/public/_headers` |
| Testing | Vitest, pgTAP (`supabase test db`), Playwright for the checkout flow |

### 7.2 Repository layout (monorepo)

```
POS/
  apps/web/              React PWA
    src/features/        auth, pos, inventory, customers, attendance, payroll, reports, settings
    src/lib/supabase.ts
    src/lib/outbox.ts
  supabase/
    migrations/          schema, RLS policies, functions (SQL)
    functions/           Edge Functions (admin-users, notify)
    tests/               pgTAP tests
    seed.sql             local development data only
    config.toml
  scripts/bootstrap-owner.ts
  .github/workflows/     ci.yml, deploy.yml, heartbeat.yml
```

### 7.3 Environments and deployment

| Environment | Supabase | Frontend | Deployed from |
| --- | --- | --- | --- |
| Local | `supabase start` (Docker) | Vite dev server | Developer machine |
| Staging | `pos-staging` project | Cloudflare Pages preview branch `dev` | The `dev` branch |
| Production | `pos-prod` project | Cloudflare Pages production | `main` branch; database changes after a tagged release |

- Branching: feature branches → PR into `dev` → release PR into `main`. `main` is protected and needs passing CI.
- CI on every PR: lint, type-check, unit tests, `supabase db reset` plus pgTAP tests on a local Supabase, build.
- Deploy: GitHub Actions applies migrations with `supabase db push` and deploys Edge Functions with `supabase functions deploy`, using secrets in a GitHub environment that requires manual approval for production. Cloudflare Pages deploys the frontend from the same branches.
- Config: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` per environment. The service role key never reaches the frontend.

### 7.4 Migration from the Firebase build

Phase 0 was first built on Firebase. The UI, design tokens, routing and app shell carry over unchanged; the backend layer is replaced, and all Firebase code, config and dependencies are removed.

| Firebase build | Supabase replacement |
| --- | --- |
| `lib/firebase.ts`, `VITE_FIREBASE_*` | `lib/supabase.ts`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Firebase Auth email + password, TOTP second factor | Supabase Auth email + password, TOTP MFA (`aal2`) |
| Custom claims (role, branchId, active) | `profiles` table read live by RLS helpers; no token-expiry gap after a role change or deactivation |
| Blocking `beforeUserSignedIn` (refuse accounts without claims, log sign-ins) | Sign-in proceeds, then the app loads the profile and signs out users with no active profile; RLS denies them anyway. Sign-ins are logged by a `record_sign_in` function called after sign-in, plus Supabase Auth logs |
| Callable functions `createUser`, `updateUser`, `setUserRole`, `deactivateUser`, `signOutEverywhere`, `createPasswordResetLink` | Edge Function `admin-users` with the same actions, same Zod schemas and the same Owner-only guard (JWT, role, active, `aal2`) |
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
2. **Phase 1 – Catalog, inventory and approvals.** Products with manual SKUs, categories, suppliers, CSV import, stock-in, movement history, low-stock list, approval requests with push notifications to the Owner.
3. **Phase 2 – POS and attendance (go-live gate).** Checkout by name search, category or SKU; cash, GCash and Maya; digital slips; daily cash drawer with closing count; offline mode; voids and returns through approval; audit log. Attendance with location check, late deductions and correction requests, and the Owner's attendance board. Gate: one week of parallel run against the store's current method with zero stock, cash or attendance discrepancies traced to the system.
4. **Phase 3 – Credit.** Customers, credit sales, utang payments, ledger, aging report.
5. **Phase 4 – Reports.** Dashboard, report views, sales and profit reports, attendance summaries, payroll runs with payslips and cash advances, CSV export, backups verified.
6. **Phase 5 – Polish.** Held sales, physical count, Bluetooth thermal printing if the owner wants paper slips.

### Open questions

- [ ] Does the owner need BIR-registered receipts? If yes, the system needs BIR accreditation or must work beside an accredited POS/receipt booklet.
- [ ] Are GCash and Maya paid to one store number or QR, or to each salesperson's phone?
- [ ] Is VAT applicable (VAT-registered or non-VAT)? This changes receipt fields and price display.
- [ ] Should credit customers be shared across future branches or kept per branch?
- [ ] Are digital slips enough, or does the store want paper slips from a printer?
- [ ] Should SKUs follow a pattern (for example a category prefix plus a number) so the app can suggest the next free one?
- [ ] What are this store's coordinates and allowed radius (suggested starting point: 100 m, or whatever pos-erag uses)?
- [ ] Do this store's shift start times (6:00 AM, 1:00 PM) and ₱50 late deduction match pos-erag, or do they differ?
- [ ] Does a day that starts with the afternoon shift count as a full day or a half day of pay?
- [ ] Does the Owner clock in too, or only staff?
- [ ] Is there an existing product list (spreadsheet) to import, and roughly how many items?
