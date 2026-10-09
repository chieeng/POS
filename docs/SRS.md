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
| Firestore | Firebase's NoSQL document database |

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
- Notifications: Firebase Cloud Messaging push to the Owner's devices for approval requests.
- Backend: Firebase (Auth, Firestore, Hosting, Cloud Functions, Cloud Messaging, Storage) on the Blaze plan, region `asia-southeast1` (Singapore).
- Source: GitHub repository with Actions for build and deploy.

**Constraints**

- Firestore has no joins or ad-hoc aggregation; reports rely on pre-computed summary documents.
- Firestore transactions fail offline; checkout must use batched writes that queue locally.
- Cloud Functions need the Blaze plan and a billing account with a budget alert.
- Must comply with the Data Privacy Act of 2012 for customer names and phone numbers kept for utang.

## 3. Functional requirements

Requirements are numbered by module. Priority: **M** = must have for launch, **S** = should have, **C** = could have later.

### 3.1 Authentication and users (AUTH)

| ID | Requirement | Priority |
| --- | --- | --- |
| AUTH-01 | Users sign in with email and password through Firebase Auth on their own phone or laptop. | M |
| AUTH-02 | The Owner creates, edits, deactivates users and assigns one role each: Owner, Special Sales or Sales. Users are never hard-deleted. | M |
| AUTH-03 | Role is stored as a Firebase custom claim, set only by a Cloud Function called by the Owner. | M |
| AUTH-04 | A user may be signed in on more than one of their own devices. The Owner can sign a user out of all devices (lost phone, staff leaving). | M |
| AUTH-05 | The app locks after 15 minutes idle (configurable) and asks for the user's password or PIN to resume. | S |

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
| POS-06 | Complete a sale in one batched write: sale document, stock decrement per line, stock movements, drawer totals. Works offline. | M |
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
| SYS-02 | Each device creates a short device tag on first sign-in, used in receipt numbers and the audit log. The Owner can see each user's active devices. | M |
| SYS-03 | Audit log of sensitive actions: sign-in, user and role changes, price changes, approval requests and decisions, voids, refunds, stock adjustments, slip re-shares. Read-only. | M |
| SYS-04 | Daily automatic Firestore export to Cloud Storage, kept 30 days. | M |

### 3.9 Owner approvals (APPR)

| ID | Requirement | Priority |
| --- | --- | --- |
| APPR-01 | These actions by non-Owners create an approval request instead of applying: product edit or deactivation, stock adjustment, correcting or deleting a stock-in, physical count differences, sale correction, void, return/refund, discount over limit, credit sale over limit. | M |
| APPR-02 | A request stores what changes (before and after), the reason, the requester and the time. Nothing changes until the Owner approves. | M |
| APPR-03 | The Owner gets a push notification and a pending list, and approves or rejects with an optional note. | M |
| APPR-04 | On approval, a Cloud Function applies the change, writes the stock movement if any, and logs it. | M |
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
| ATT-13 | A Cloud Function recomputes distance, lateness, penalty and day credit on the server for every record, so a tampered client cannot change them. | M |
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
| NFR-01 | Performance | Name search shows results as the user types, under 300 ms for 10,000 products, by filtering the locally cached product list (Firestore has no full-text search). A sale completes locally in under 1 s. |
| NFR-02 | Offline | Checkout, shift operations and product search work with no internet; queued writes sync automatically within 1 minute of reconnecting. A visible indicator shows online/offline and pending-sync count. Approval requests wait until online. |
| NFR-03 | Availability | Hosted on Firebase; the app shell loads from the PWA cache even when Firebase Hosting is unreachable. |
| NFR-04 | Security | All access enforced by Firestore Security Rules and Cloud Functions, never by UI alone. HTTPS only. No secrets in the repository. Personal devices are untrusted: no data beyond the user's role is ever sent to them. |
| NFR-05 | Data integrity | Sales and stock movements are append-only; corrections are new records, never edits or deletes. |
| NFR-06 | Auditability | Every sensitive action is traceable to a user, device tag and time. |
| NFR-07 | Backup | Daily Firestore export kept 30 days; restore tested once before launch. |
| NFR-08 | Usability | Mobile-first: every screen works on a 360 px wide phone; touch targets at least 44 px; a new salesperson can complete a sale after 15 minutes of training. |
| NFR-09 | Scalability | Supports 20 users signed in on up to 30 devices, 10,000 products and 500 sales per day without design changes. |
| NFR-10 | Cost | Monthly Firebase cost stays within the Blaze free allowance at launch volume; budget alert set at PHP 500. |
| NFR-11 | Privacy | Customer data limited to name, phone and address; visible only to roles that need it (Data Privacy Act of 2012). |
| NFR-12 | Maintainability | TypeScript, ESLint and Prettier; security rules covered by emulator tests in CI. |

## 5. Data model

Twenty-one top-level Firestore collections, each document carrying `branchId`. Sale line items and payments are embedded in the sale, with name, price and cost copied at the time of sale, so later edits never change past receipts.

&#91;embedded content: ERD · 13 collections and their links\]

A sale links its shift, salesperson and optional customer, and spawns stock movements, credit charges and returns. Products gain stock only through receipts and approved adjustments, both logged as movements; approval requests record who asked for each change.

### 5.1 Collections

| Collection | Key fields | Written by |
| --- | --- | --- |
| `branches` | name, address, contact, tin, receiptFooter, salesDiscountLimit, idleLockMinutes; attendance settings {storeLat, storeLng, radiusM, clockInTimes {morning, afternoon}, graceMinutes, latePenalty, afternoonDayCredit} | Owner |
| `users` | uid (doc id), displayName, email, role (owner, specialSales, sales), userCode, branchId, active, clockInOverride?, createdAt; subcollection `devices` {deviceTag, label, fcmToken, lastSeenAt} | Cloud Function (user fields); the user (own devices) |
| `payRates` | userId (doc id), dailyRate, effectiveFrom, updatedBy | Owner only; readable by the Owner only |
| `payrollRuns` | periodStart, periodEnd (picked by the Owner), status (draft, finalized), totals {gross, additions, deductions, net}, finalizedBy?, finalizedAt? | Owner only |
| `payslips` | runId, userId, fullDays, halfDays, dailyRate, grossPay, latePenalties, additions\[\] {type, amount, note}, deductions\[\] {type, amount, note}, netPay, paidAt?, paidMethod?, paidReference? | Drafted by Cloud Function; Owner edits until finalized; staff read own finalized payslips |
| `cashAdvances` | userId, amount, date, note, remaining, status (open, deducted) | Owner only |
| `categories` | name, branchId, active | Special Sales (create), Owner |
| `suppliers` | name, contactPerson, phone, address, active | Special Sales (create), Owner |
| `products` | sku, name, nameLower, categoryId, sellPrice, stockQty, reorderLevel, imageUrl, active, updatedAt | Special Sales (create), Owner (edit); `stockQty` only via stock operations |
| `customers` | name, phone, address, creditLimit, balance, active | Sales (create), Owner (edit) |
| `attendance` | userId, date, shiftSlot (morning, afternoon), clockIn {deviceAt, serverAt, lat, lng, accuracyM, distanceM, locationStatus}, scheduledClockIn, graceMinutes, lateMinutes, latePenalty, dayCredit (full, half), flags\[\] (location not verified, time mismatch), editedBy?, editReason? | User creates own clock-in; computed fields by Cloud Function only |
| `shifts` | id `<branchId>_<YYYYMMDD>` (one per day), openedBy, openedAt, openingCash, cashIn\[\], cashOut\[\], closedBy?, closedAt?, countedCash, expectedCash, overShort, totals {cash, gcash, maya, credit}, status | Any staff (open, cash-in/out); Owner or Special Sales (close) |
| `sales` | receiptNo, deviceTag, shiftId, salespersonId, customerId?, items\[\] {productId, name, sku, qty, unitPrice, unitCost, discount, lineTotal}, subtotal, discountTotal, total, payments\[\] {method, amount, reference}, change, status (completed, voided, corrected), correctionOf?, correctedBy?, voidedBy?, voidReason?, createdAt | Salesperson (create); void via Cloud Function |
| `returns` | saleId, items\[\], refundAmount, refundMethod, reason, approvalId, createdAt | Cloud Function |
| `stockReceipts` | supplierId?, reference?, items\[\] {productId, qty, unitCost}, totalCost, receivedBy, createdAt | Special Sales, Owner |
| `stockMovements` | productId, type (sale, void, return, stock-in, adjustment, count), qtyChange, unitCost, refType, refId, userId, deviceTag, createdAt | Same batch as its source; append-only |
| `creditLedger` | customerId, type (charge, payment), amount, saleId?, method?, reference?, userId, createdAt | Same batch as sale or payment; append-only |
| `approvalRequests` | type (includes attendance correction), targetType, targetId, before, after, reason, requestedBy, status (pending, approved, rejected), decidedBy?, decidedAt?, ownerNote?, createdAt | Requester (create, pending only); decided by Owner via Cloud Function |
| `dailySummaries` | id `<branchId>_<YYYYMMDD>`, salesTotal, costTotal, txnCount, byMethod {}, bySalesperson {}, voidsTotal, refundsTotal | Cloud Function trigger only |
| `auditLogs` | action, actorId, deviceTag, targetType, targetId, before?, after?, reason?, createdAt | Cloud Function or same batch; append-only |

Plus `productCosts/{productId}` with costPrice (weighted average) and updatedAt, written by stock-in and readable by the Owner only. Sales staff never see cost; the Cloud Function on each new sale fills `unitCost` in its lines.

Plus `paymentRefs/{method}_{reference}`, written with each GCash or Maya sale or utang payment, so a reused reference number is caught. Online, the app checks it before completing the sale; for offline sales, a Cloud Function checks on sync and flags duplicates instead of rejecting the sale, so no sale is lost.

### 5.2 Checkout write (one batch, offline-safe)

1. Create `sales/{id}` with status `completed`.
2. For each line: `products/{id}.stockQty` decremented with `increment(-qty)`.
3. For each line: create a `stockMovements` record of type `sale`.
4. If any payment is credit: create a `creditLedger` charge and `increment` the customer's `balance`.
5. `increment` the day's drawer totals for each payment method.

A Cloud Function triggered on the new sale then updates `dailySummaries` when the write reaches the server.

### 5.3 Indexes

- `sales`: branchId + createdAt desc; salespersonId + createdAt desc; shiftId + createdAt
- `stockMovements`: productId + createdAt desc
- `creditLedger`: customerId + createdAt desc
- `approvalRequests`: status + createdAt desc; requestedBy + createdAt desc
- `attendance`: date + userId; userId + date desc; flags (array-contains) + date desc
- `products`: branchId + active + nameLower; sku (equality lookup for typed SKUs and the uniqueness check)

## 6. Security and permissions

Roles live in Firebase custom claims (`role`, `branchId`), so Security Rules check them without an extra read. Anything that needs the Owner's permission is written as an approval request; only a Cloud Function, called when the Owner approves, applies the change and writes the audit log.

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

### 6.2 Rule principles

- Default deny: every collection is closed unless a rule opens it.
- Clients may create `sales`, `stockMovements` (sale or stock-in only), `creditLedger` and `approvalRequests` (status `pending` only), but never update or delete them.
- On `products`, Sales and Special Sales writes may change only `stockQty` and `updatedAt`, as part of a sale or stock-in. Other fields are set only on create (Special Sales) or by the Owner.
- SKU uniqueness: creating a product also creates `skuIndex/{branchId}_{sku}` in the same batch; the rule refuses it if that document already exists.
- On `attendance`, a user may create only their own clock-in for today, writing only the raw `clockIn` fields; the document id `<uid>_<YYYYMMDD>` makes a second clock-in impossible. Lateness, deduction, day credit and flags are written only by the Cloud Function; edits after that are Owner-only.
- `payRates`, computed pay, `payrollRuns` and `cashAdvances` are readable by the Owner only. Staff can read only their own finalized `payslips`.
- Only the Owner, through a Cloud Function, decides approval requests. `users`, `returns`, `dailySummaries`, voids and approved changes are written only by Cloud Functions (Admin SDK).
- Firestore cannot hide single fields, so cost lives in a separate `productCosts` collection readable by the Owner only. The sale trigger copies `unitCost` into each sale line on the server.
- Every write must carry the caller's own `branchId` and `uid` where the schema has them.
- Rules are tested in the Firebase Emulator in CI; a failing rules test blocks the merge.

### 6.3 Hardening: no way in except a valid, active account with the right role

The Firebase web config (API key, project id) is public by design, so anyone can call Firebase directly without the app. Security therefore rests on server-side checks only: Auth settings, Security Rules, App Check and Cloud Functions. Every control below is a launch requirement.

| ID | Area | Control |
| --- | --- | --- |
| SEC-01 | Sign-up | Public sign-up is disabled (Identity Platform "allow sign-up" off). Accounts are created only by the Owner through a Cloud Function. Firebase's default allows anyone with the public API key to create an account, so this closes the biggest backdoor. |
| SEC-02 | Accounts | Rules require both a valid `role` custom claim and `active == true`. An account without claims, even if one is ever created, can read and write nothing. |
| SEC-03 | First Owner | The first Owner is created once by a one-time admin script run from the developer's machine, then the script is removed. No default credentials, no hard-coded admin, no hidden setup page. |
| SEC-04 | Deactivation | Deactivating a user disables the Auth account, removes claims and revokes refresh tokens in one Cloud Function, so access ends within minutes on every device. |
| SEC-05 | Owner login | The Owner account requires two-factor authentication (TOTP app). Staff passwords: minimum 10 characters; email enumeration protection on; Firebase's built-in sign-in throttling stays on. |
| SEC-06 | App Check | App Check (reCAPTCHA Enterprise) is enforced on Firestore, Storage and Functions, so requests from scripts or tools outside the real app are refused. |
| SEC-07 | Rules depth | Every write is validated field by field: allowed keys only (`hasOnly`), types, positive amounts, own `uid` and `branchId`, server timestamps. No collection allows unrestricted `list` reads; Sales see only what their screens need. |
| SEC-08 | Functions | Every callable function checks auth, role, active flag and App Check, and validates its input with a schema before doing anything. No HTTP endpoints without authentication. |
| SEC-09 | Storage | Uploads limited to images under 2 MB, by Owner and Special Sales only, into product paths only. |
| SEC-10 | Cloud access | No service account key files anywhere. GitHub Actions deploys through Workload Identity Federation with a deploy-only role. Only the Owner's Google account has project Owner rights; 2FA required on the Google and GitHub accounts. |
| SEC-11 | Repository | Private repo, protected `main` (PR review and passing CI required), secret scanning and Dependabot on, `npm audit` in CI. No debug, test or seed routes in production builds. |
| SEC-12 | Web headers | Hosting sends Content-Security-Policy, HSTS, X-Frame-Options DENY, X-Content-Type-Options and a strict Referrer-Policy. No `dangerouslySetInnerHTML`. |
| SEC-13 | Lost device | Owner can sign a user out everywhere (SEC-04 without deactivating). The idle lock limits what a found, unlocked phone can do. |
| SEC-14 | Monitoring | Alerts to the Owner on: role changes, new devices on the Owner account, many voids/corrections by one user in a day, repeated failed sign-ins, Functions errors, and billing spikes (a sign of abuse). |
| SEC-15 | Recovery | Firestore point-in-time recovery (7 days) on, plus the daily exports. A restore is rehearsed before launch. |
| SEC-16 | Verification | Before go-live: rules tests cover every collection and role, including attempts from no account, a deactivated account and the wrong role; a checklist review against OWASP Top 10; a manual attempt to read and write data with the public config from outside the app, which must fail. |

Residual risks: a staff member's unlocked phone acts with that person's role until it locks or is signed out; browser location can be faked; the Owner's own account is the single most valuable target, hence 2FA.

## 7. Architecture, repository and deployment

A React PWA talks straight to Firestore through the Firebase SDK, with its local cache as the offline queue. Cloud Functions handle only what the client must not be trusted with.

### 7.1 Stack

| Layer | Choice |
| --- | --- |
| Frontend | React 18 + TypeScript, Vite, React Router |
| UI | Tailwind CSS + shadcn/ui, responsive layouts for phone, tablet and laptop |
| State | Zustand for cart and session; Firestore `onSnapshot` for live data |
| Forms | React Hook Form + Zod |
| Offline / install | Firestore `persistentLocalCache` with multi-tab manager; `vite-plugin-pwa` |
| Product search | Client-side filtering of the cached product list (Fuse.js for typo-tolerant name search) |
| Location | Browser Geolocation API (`enableHighAccuracy`, 10 s timeout); haversine distance on both client and server |
| Receipts | On-screen slip rendered to image or PDF and shared with the Web Share API; browser print as a fallback |
| Notifications | Firebase Cloud Messaging web push for approval requests |
| Backend | Cloud Functions (Node 22, TypeScript): user admin, approval decisions, void/refund, sale trigger, attendance computation, payroll drafting, daily backup |
| Testing | Vitest, Firebase Emulator Suite, `@firebase/rules-unit-testing`, Playwright for checkout flow |

### 7.2 Repository layout (monorepo)

```
pos-inventory/
  apps/web/            React PWA
    src/features/      auth, pos, inventory, customers, reports, settings
    src/lib/firebase.ts
  functions/           Cloud Functions
  firestore.rules
  firestore.indexes.json
  storage.rules
  firebase.json
  .github/workflows/   ci.yml, deploy.yml
```

### 7.3 Environments and deployment

| Environment | Firebase project | Deployed from |
| --- | --- | --- |
| Local | Emulator Suite | Developer machine |
| Staging | `pos-staging` | Pull request preview channels + `dev` branch |
| Production | `pos-prod` | `main` branch, after a tagged release |

- Branching: feature branches → PR into `dev` → release PR into `main`. `main` is protected and needs passing CI.
- CI on every PR: lint, type-check, unit tests, rules tests in the emulator, build.
- Deploy: GitHub Actions deploys Hosting, rules, indexes and Functions through Workload Identity Federation, with no key files (SEC-10).
- Config: `VITE_FIREBASE_*` values per environment in `.env.staging` and `.env.production`; App Check enabled in production.

## 8. Release phases and open questions

The store can start selling after Phase 2; each later phase ships on its own.

1. **Phase 0 – Foundation.** Repo, CI/CD, staging and production projects, emulator, auth with custom claims, user management, device tags, settings.
2. **Phase 1 – Catalog, inventory and approvals.** Products with manual SKUs, categories, suppliers, CSV import, stock-in, movement history, low-stock list, approval requests with push notifications to the Owner.
3. **Phase 2 – POS and attendance (go-live gate).** Checkout by name search, category or SKU; cash, GCash and Maya; digital slips; daily cash drawer with closing count; offline mode; voids and returns through approval; audit log. Attendance with location check, late deductions and correction requests, and the Owner's attendance board. Gate: one week of parallel run against the store's current method with zero stock, cash or attendance discrepancies traced to the system.
4. **Phase 3 – Credit.** Customers, credit sales, utang payments, ledger, aging report.
5. **Phase 4 – Reports.** Dashboard, daily summaries, sales and profit reports, attendance summaries, payroll runs with payslips and cash advances, CSV export, backups verified.
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
