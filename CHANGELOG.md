# Change log — Delbros Leasing frontend v0.1.0

Temporary log of the correction and UI/UX work, newest first, so the team can follow what changed, why, and the result.
The same entries open from the sticky “Change log” button (bottom-right) on both sign-in pages while `app-config.json` has `"showChangeLog": true`.
Source of truth: `src/lib/shared/changelog.ts` — regenerate this file with `node scripts/changelog-md.mjs`.

## 11-Nov-2026

### Portal Contracts — the items marked “Not met” in the Contracts review `Feature`

**Why:** The Contracts review (CLT, CNC, BR-12, BR-14, BR-15, BR-18) marked these Not met: entitlement for all equipment types, the pre-termination fee and lock-in end date, rate history, minimum billing days and renewal notices, several contracts with status and detail views, the request form and its status, branches covered versus actual activity, and the 20ft flatbed rate order.

- Entitlement for every type: LTL-2026-0045 now sets a quantity for all eight types (20ft chassis 3, 40ft chassis 2, 40ft flatbed 2, 40ft super combo 2, 45ft chassis 1 = 10 units; 40ft combo, cane cage trailer and 20ft flatbed “Not entitled — on request”). Every unit on hire is of an entitled type. The table shows entitled, on hire, on open EWAs and what can still be requested — the same numbers New EWA enforces.
- Lock-in and BR-15: the lock-in end date (effective date + 12 months), and the pre-termination fee if ended today — the daily rates of the units on hire for the lock-in days left, capped at 30 days (proposed formula; the cap is a new pending System setting). No fee after the lock-in or without one.
- Rate history (BR-18): every version with its dates and reason; version 2 re-rated the 20ft flatbed ₱1,150 → ₱1,250 to the 2026 LTL rate card. A Rate card column shows the approved card rate next to each contract rate.
- Minimum billing days (1 day per release for LTL / SPL, 10 for QLP under BR-12 — proposed) and the renewal notices 3, 2 and 1 months before the end date, with the next one (DBL-CLT-011).
- Several contracts: a list with a status filter (Active, Expired, Terminated, Renewed) and a detail view for the selected one. ABC now also shows QLP-2025-0019 (Expired) and SPL-2025-0007 (Terminated, with the reason and date).
- Request form: Renewal (new term in months), Amendment (what to change) or Termination (end date, with the BR-15 fee estimate shown live). It returns a CRQ- reference, notifies the Account Executive and Sales Director, and every request is listed on the contract with its status and decision; one open request per kind.
- Branches covered = the branches enabled for the account (the same list New EWA uses). ABC’s now include Batangas, Clark and Cagayan de Oro, added by the approved amendment CRQ-000001; a table shows EWAs, releases and units on hire per branch, all inside the covered branches.
- 20ft flatbed rate order: kept as on the approved rate card and stated on the page; Delbros to confirm the card.
- Mock DB version 19: saved demo data reloads once. 7 new unit tests.

**Result:** All Contracts items are built. To confirm with Delbros: the BR-15 fee formula and cap, the minimum billing days, the entitlement numbers and the 2026 rate card (20ft flatbed above 45ft chassis). Known data issue: the demo lease invoices bill a sample unit mix (20ft flatbeds, cane cage trailer, 45ft chassis) rather than ABC’s actual on-hire units — they can be rebuilt from the on-hire units on request.

### Portal Invoices, E-wallet and top-up — the items marked “Not met” in the Invoice / E-wallet review `Feature`

**Why:** The Invoices & statement, E-wallet & cash bond and Request top-up review (FIN, EWL, BR-04, BR-05, BR-14, BR-15) marked these Not met: net / VAT per invoice, invoice detail and PDF, days overdue, credit memos and Official / Provisional receipts on the SOA, an SOA period, paging, proof of payment and disputes, the 28–31 Oct billing gap and the ₱5,040 on INV-MNL-00001118, the receipt row, the withdrawal dialog, Delbros bank details, top-up states, more ledger types, cash bond history and refund rules, ledger filters, the receipt series, direct Treasury postings, low-balance effects, and the top-up form fields, suggested amount, remarks, confirmation and resubmission.

- Invoices: total with net + VAT on every row, a Days overdue column (or “due in N d”), a View icon, and paging (8 rows). The details show how the amount is made up, each unit line with its from–to dates, the receipts that paid it (Official or Provisional, from which PR), credit memos applied, and Print / PDF.
- Billing gap: the missing weekly lease invoice INV-MNL-00001119 (the week after INV-MNL-00001102) is added, and a coverage line shows the lease weeks invoiced without gaps and when the current week is invoiced. Total due is now ₱125,320.00 (₱79,120 + ₱47,040 − ₱840 credit).
- INV-MNL-00001118 (₱5,040): a damage charge, not a lease bill — ₱4,500 for the tail lamp and wiring found at the MNL0881 Gate In (EIR-MNL-000181) + 12% VAT ₱540. Its “period” now reads “Repair · Gate In date”, and the dashboard’s returned-unit card shows the same ₱4,500.
- SOA: Credit Memo rows (CM-000010, withholding tax, now applied to INV-MNL-00001101), Official / Provisional receipt labels with the PR an OR came from and the invoice it paid, a From / To period with “Balance brought forward” and a period summary, paging, payments still awaiting clearance, and a note on the PR → OR rule.
- Proof of payment and disputes (proposed — Delbros to confirm scope): “Send proof of payment” (amount, date, method, bank, reference, one PDF / JPG / PNG up to 5 MB, remarks; duplicate references refused) and “Dispute” (reason, details, amount). Accounting, Treasury and the Account Executive are told; the invoice shows “Proof sent” or “Disputed”, and the details list each one with its status.
- Delbros bank details: “Pay to” bank, account name, account number and a reference to quote (EW- + account code) on the E-wallet page and in the top-up dialog, with copy buttons. Approved values come from app-config.json (releaseContacts.payee); until then a clearly marked demo placeholder shows and the package script warns.
- Top-up dialog: amount (₱500 to ₱5,000,000, centavos allowed), transfer date (not future, within 60 days), payment method, sending bank, reference (neutral example; duplicates refused), one proof file (PDF / JPG / PNG, max 5 MB, with errors), optional remarks, and suggested amounts — e.g. ₱548.80 to leave amber. After Submit: the TU- number, status Submitted, “Treasury will confirm”, and who was told (Treasury, AE, the client).
- Top-up requests: numbered, with the Submitted → Confirmed by Treasury → Posted steps and dates; a rejected request shows the reason and a Resubmit button that pre-fills the form (TU-000002 is a rejected sample). The Pending top-ups tile counts Submitted and Confirmed requests and their total.
- Ledger: every type named with its sign (top-up, rescue, repair, debit memo, contract-termination lease, refund, adjustment, reversal); a DM-000039 deduction and its reversal show the debit-memo and reversal types without changing the ₱11,951.20 balance. Type filter, From / To dates and paging (10 rows); deposits posted directly by Treasury (the opening deposit) are labelled as such; top-ups carry the Official Receipt.
- Cash bond: the refund breakdown lists every deduction — all unpaid invoices (not only overdue), negative e-wallet, debit memos awaiting approval and the BR-15 pre-termination fee (only when a contract ends inside its lock-in) — with the proposed rule stated. The Cash bond tab shows bond received, withdrawal requested, refunded and applied entries.
- Withdrawal: new demo client Bayside Haulage (finance@baysidehaulage.ph) — contract ended, nothing owed, ₱20,000 refundable — shows the eligible dialog and its result (workflow reference, approval steps, bond “Withdrawal pending”).
- Low balance: a panel explains what Near minimum, Below minimum and Negative mean for EWAs and rescues (proposed: warnings only, nothing blocked; a shortfall is collected by top-up or from the cash bond).
- Mock DB version 18: saved demo data reloads once. 8 new unit tests.

**Result:** All Invoice / E-wallet / top-up items are built. To confirm with Delbros: whether clients may send proof of payment and disputes online, the refund rule (all unpaid vs overdue only), the low-balance rule, the top-up amount limits and accepted methods, and the approved bank account (releaseContacts.payee in the deployed app-config.json). The totals reviewers reconciled (₱79,120) now read ₱125,320 because the missing weekly invoice and the CM-000010 credit are included.

### Portal EWA list and Rescue — the items marked “Not met” in the EWA / Rescue review `Feature`

**Why:** The EWA list and Roadside rescue review (GAT-001/002/003, BR-01, BR-04, BR-06, BR-11, BR-16, RES) marked these Not met: the extension flow and history, trucker / contract / created by in the list, Gate Pass and release time, client cancel, detail with print / share, date filter and paging, the blocked New EWA button, partly released EWAs, a time-zone label, the audit cross-check; and for rescue: problem types with Other, the pricing rule, Dispatched / In progress, the detail timeline, crew and ETA, the charge breakdown, cancel and its cut-off, the hold block, e-wallet behaviour, the submission confirmation, urgent / location / contact in the list, and two data conflicts (RSC-000040, RSC-000020).

- EWA extension: “Extend” on an expired EWA shows “Extension requested” in the list and the details say which approval step it is waiting for (manager, then IT revalidation). The valid-until time changes only after both approve, and the client is notified of the decision. Every request, decision, approver and valid-until change is kept in the EWA’s history (EU-000600 shows an approved one).
- EWA list: the EU number now carries the branch and contract; driver with licence; truck with trucker; equipment with released count, the Gate Pass number and release time; created date and who created it; valid until with “Extended ×n”; status with the cancellation reason. Search covers EU no., driver, plate, trucker and contract. A created-date range filter is added; the list pages at 8 rows.
- Cancel: the client can cancel an Active EWA before any unit is released, with a reason (row action and in the details); the branch and the Account Executive are told. After a release the client calls the branch; Delbros can cancel from the staff app.
- Details: full EWA details, the history timeline (created, extension requests and decisions, releases, cancellation, expiry), the email log, Print / PDF, Share (the device share sheet, or the details copied for the driver) and Copy EU no. A View icon on every row opens it.
- Blocked New EWA: on hold or with Allow Online off, the button is disabled and a “why?” link under it opens the reason and who to contact (BR-01).
- Partly released EWAs: “1/2 released · 1 remaining” while valid; at expiry the units not yet released lapse (“1 lapsed”) and the EWA shows Expired, with an explanation in the details (EU-000599). Partly used EWAs now expire like active ones.
- Time zone: the list and details say all times are Philippine time (PHT, UTC+8).
- Audit cross-check: the Audit log now has EU-000765 cancelled by the Manila branch and EU-000770 expired, matching the portal.
- Rescue problem types: flat / blown tire, brake, mechanical, electrical / lights, accident / collision and Other — Other needs a short description. Each type shows what is usually charged (proposed — Operations to confirm); the charge always uses the tires and parts actually used (BR-11).
- Rescue statuses and details: Requested → Verified → Confirmed → Dispatched → In progress → Completed with the time of each step; crew / vendor, rescue vehicle, driver and phone, and the dispatcher ETA (also in the list). RSC-000042 is a request on its way. Completed requests show the BR-11 breakdown (travel, tires, parts, subtotal, 10% service fee, 12% VAT, total) and the debit memo.
- Rescue cancel: a Cancel row action and button while the request is Requested (before Credit & Collection verifies it); after that the client calls the dispatcher.
- Hold block: for a client on hold the form is replaced by an explanation and contacts, and the API refuses the request instead of creating a Blocked record.
- E-wallet on the rescue page: balance, state and minimum. Proposed rule (Finance to confirm, BR-04): a rescue is never refused for a low balance; the charge is deducted afterwards and may take the balance below the minimum or negative.
- Submission: the reference number, “dispatcher notified”, and who was told — dispatchers (plus SMS when urgent), Credit & Collection, the branch, the Account Executive, and a confirmation to the client — each with status. The same list is in the request details; the client also gets an in-app notification.
- Rescue list: Urgent badge, location and scene contact under the unit, problem detail, ETA, and View / Cancel actions.
- Data: RSC-000040 now has its problem type (it was blank); requests made before the field was required show “Not recorded”. RSC-000020 is on the unit hired under MNL0880 (on hire 75 → 35 days ago), and every request shows the Gate Out it happened under.
- Mock DB version 17: saved demo data reloads once. 9 new unit tests.

**Result:** All EWA list and Rescue items are built. To confirm with Delbros: who may cancel an EWA (client before release, Delbros any time), the problem-type pricing notes, and whether rescue requests are allowed below the e-wallet minimum (allowed here). The audit cross-check is a verification task — recapture the Audit log in the staff app.

### Portal New EWA — the items marked “Not met” in the New EWA review `Feature`

**Why:** The New EWA review (GAT-001/002/003, BR-01, BR-06, Screen Inventory) marked these Not met: production contact details in the footer, the branch availability count and no-stock message, the contract → branch → equipment order, branch stock and contract entitlement limits, blocked states, the confirmation and the EWA email with its delivery status, several equipment types per EWA, truck OR/CR, equipment-type names, and the optional saved drivers / trucks and pickup notes.

- Blocked states inside the dialog: on hold (with the Credit & Collection officer and the Account Executive), not accredited, Allow Online off, no eligible pickup branch, and no active contract — each with what to do and who to contact. New EWA stays clickable so the reason is always visible.
- Order: contract → pickup branch → equipment. The equipment list opens only when both are chosen; until then it says why. Each branch shows how many units are free for the contract.
- Availability: every equipment type shows the units free at the branch (types with none free are disabled), plus what is left on the contract and the daily rate. When nothing is free, the dialog says so and lists the other enabled branches that have stock (one click to switch).
- Limits: quantity is a whole number ≥ 1, no more than the free units at the branch and no more than what is left on the contract — per type when the contract sets an entitled quantity, and in total against the contract’s unit quantity (units on hire and units still to be released on open EWAs count). The API enforces the same rules (ENTITLEMENT_EXCEEDED).
- Several equipment types per EWA (proposed — Delbros to confirm): “Add another equipment type”, one line per type; the EWA record and Gate Out already handle several lines.
- Validation: “Missing driver/truck info” in the form and from the API when the trucker, plate, driver or licence is blank; LTO plate and licence formats now checked by the API too.
- Truck OR/CR: optional in the portal; the yard still verifies the original at Gate Out. Shown on the confirmation, the EWA details and the printout (“Verified at Gate Out” when not given).
- Optional extras: drivers and trucks used before are suggested (picking one fills the licence, trucker and OR/CR when empty), an expected pickup time within the 24-hour validity, and remarks for the yard (300 characters).
- Confirmation (GAT-002): EU number, valid until, all details, and the EWA email log — each client and Delbros recipient (portal user, company email, branch generalists, Account Executive) with time and status, plus “Resend email”. The same log is on the EWA details. The client also gets an in-app notification that opens the EWA. The mock marks every send Sent; the mail service will supply the real status.
- Extension: the confirmation explains that an extension is requested from the EWA list once the EWA expires (manager approval and revalidation, BR-06).
- Production contact details: app-config.json takes “releaseContacts” (client and vendor support phone / email, DPO email). When set they replace the System-settings values everywhere — sign-in page, footer, restriction messages, privacy notice — without a rebuild. The footer now also shows Client Support. The package script warns while any of them is missing or still a demo value.
- Mock DB version 16: saved demo data reloads once. 7 new unit tests.

**Result:** All New EWA items are built. To confirm with Delbros: several equipment types per EWA, whether the portal collects OR/CR (optional here), the approved release contacts (fill releaseContacts in the deployed app-config.json), and Q-CLT-01 — the seven FRS equipment names versus the eight types on contract rates (the dialog, contracts and history all use the Equipment types master, so renaming there updates every screen).

### Portal dashboard — the items marked “Not met” in the dashboard review `Feature`

**Why:** The client portal dashboard review (ABC Logistics, C-00123) marked the dashboard items Not met: user menu contents, the hold / accreditation banner with blocked quick actions, overdue and aging, the e-wallet states, contract / rate / hire days / accrued charge per unit, a request-return action, return details with the cross-branch code (BR-16), hire duration, trucker and equipment type and the cancellation reason in the EWA history, repair and debit-memo charges, client feedback / rating, notifications, the withdrawal link when nothing is refundable, and the gate pass number format.

- User menu: My profile (name, sign-in email, role, company and account code, account status, Account Executive), Change password, Send feedback, Sign out.
- Account standing under the company name (“Accredited and in good standing” or “On hold”). On hold, the BR-01 banner lists what is blocked and who to call, and Create EWA / Request rescue are greyed out, no longer clickable, and say why (Allow Online = No and no rescue service also say why).
- Overdue: the Unpaid bills tile shows the overdue amount, the Oldest due tile gets an Overdue marker once the date passes, and a new “Balance by age” card shows the six aging buckets (same calculation as Aging and the SOA), with a red banner when anything is past due.
- E-wallet: four states — Healthy (125% of the minimum and above), Near minimum (amber), Below minimum (red, new — a positive balance under ₱10,000 was amber before) and Negative (red). The card shows the four ranges with the current one marked; the E-wallet page uses the same rule. Proposed, Finance to confirm (EWL-004).
- On-hire equipment: contract number, daily rate (contract snapshot), days on hire and the accrued charge for each unit, with the basis (days × rate before VAT, pickup day counts).
- Request return (proposed, Delbros to confirm clients may do this online): per unit on hire — return branch, preferred date (today to 60 days) and notes. A different branch shows the BR-16 cross-branch note. Creates an RTN- reference, notifies the branch and the Account Executive, and the unit then shows “Return requested”.
- Returned equipment: Gate Out and Gate In date and time, branches and gate passes, condition and chargeable damage, hire duration (40 days for the sample; 41 billable because pickup and return day both count), final charges before VAT (days × rate + damage) and the IT approval code for a cross-branch return. A second sample return (Cavite → Manila, code XB-7Q4K2M, ₱950 tail-lamp damage) shows the cross-branch case.
- EWA history: trucker, truck and equipment type columns; a Cancelled EWA shows when and why it was cancelled. EU numbers link to the EWA.
- Repair & debit memo charges: each debit memo and repair invoice with its source (rescue, job order, Park & Fix, Gate In) and how it was settled — deducted from the e-wallet (with the ledger entry and balance after), on an invoice with the amount due, awaiting approval, or posted and not yet settled — plus where the client sees the effect.
- Rate our service: 1 to 5 stars on a chosen service (overall, EWA and gate, rescue, repairs, billing, Account Executive, portal) with an optional comment, sent to the Account Executive with an FB- reference; recent feedback listed. “Send other feedback or a request” opens the existing form.
- Notifications: a bell in the portal header with the unread count. Each notification opens the related record (EWA, invoice, rescue, e-wallet, charges, returns); “Mark all as read”. Sample notifications seeded for ABC Logistics and Pacific Movers.
- Cash bond: the dashboard shows the refundable amount and offers “Request withdrawal” only when it is above ₱0; otherwise it says why (unpaid invoices, negative e-wallet or pending debit memos are deducted first, BR-14).
- Gate pass numbers now follow the FRS format: branch prefix + 4 digits (MNL0881, CAV0871), set by the branch gate-pass prefix and “Gate-pass number length” (Q-GAT-07). New passes continue each branch’s sequence.
- Mock DB version 15: saved demo data reloads once. 13 new unit tests.

**Result:** All dashboard items are built. To confirm with Delbros: whether clients may request returns online, the e-wallet state ranges, and the gate pass format (FRS GEN0001 style used). The contract end date and oldest due date the reviewer saw differ between captures because the demo data is dated relative to today; recapture the Contracts and Invoices pages in this build. The staff app needs the same shared-code change (gate pass numbers, seed) if its copy of src/lib is kept in step.

### Portal sign-in — the 11 items marked “Not met” in the sign-in review `Feature`

**Why:** The sign-in review (“Client portal” and “Client Portal sign” files) marked 11 sign-in items Not met: account states, lockout and session timeout, second factor, the reset flow, the access request form, the Data Privacy Act notice, support contacts, the hold state after sign-in, Allow Online = No, email identity / company uniqueness, and a vendor demo account.

- Account states: one message each for wrong email or password (never says which), locked (with the unlock time and a reset link), inactive user or company, company not yet accredited, access request still pending, and wrong portal tab. The account state is shown only after the right password, and the message names the Account Executive (clients) or Procurement (vendors).
- Lockout and session timeout: the account locks after the configured failed attempts (5 → 30 minutes, System settings). A portal session ends after 15 minutes without activity (new setting, proposed). A warning with “Stay signed in” appears one minute before, and the sign-in page then says the session expired. The timeout also applies after a page reload.
- Second factor: after the password, a 6-digit code is emailed (valid 5 minutes, 5 tries, resend after 30 seconds). The new setting “Portal second factor” can switch it off. The review demo box shows the code, because the mock cannot send email.
- Forgot password: request → “Check your email” (same answer for unknown emails) → reset link → new-password form with live rules (minimum length from System settings, upper / lower case, number, not the email name) → “Password updated”. Links work once, expire in 30 minutes (setting), and are replaced by a newer link. A reset also unlocks the account.
- Request portal access: client or vendor (same form, vendors reviewed by Procurement). Fields: company name, TIN, branch, address, contact person, phone, email, supporting documents (PDF / JPG / PNG, 5 MB each), password, and consent. The confirmation shows the PAR- reference, everything submitted, the next steps and the reviewer’s contact.
- Data Privacy Act: notice under the Sign in button, with a full Privacy notice (what, why, who sees it, retention, RA 10173 rights, DPO contact). The same notice is linked from the request form and the portal footer.
- Support contact: Client tab → Account Executive or Delbros Client Support; Vendor tab → Delbros Procurement (phone and email from new Portal settings, proposed values).
- Hold (BR-01): Pacific Movers signs in and sees a hold notice once. Dashboard, EWA and Rescue then show what is blocked (EWAs and chassis release, rescue, new services), what still works, and who to call (the Credit & Collection officer and the Account Executive). New EWA stays disabled.
- Allow Online = No: Southern Haulers signs in normally. The dashboard and the EWA page explain that EWAs cannot be created online and name the Account Executive to contact.
- Email identity: email is the sign-in ID on both tabs. It is compared case-insensitive, and the form says so. An email already used by any account, client contact or supplier, or a TIN already registered, is refused: one email and one TIN per company.
- Demo box (only when app-config.json has "showDemoLogins": true): one account per state, including vendor@tirepro.ph and two vendor error states. The package script warns if the setting is still on.
- Mock DB version 14: saved demo data reloads once. Unit tests cover every state above.

**Result:** All 11 items are built. Still to confirm with Delbros (proposed defaults in System settings): the session timeout, the second factor, the reset-link validity, the support phone / email and the DPO email. The staff app needs the same shared-code change if its copy of src/lib is kept in step.

## 02-Nov-2026

### Portal review 1.1 — sample data conflicts corrected `Fix`

**Why:** Client portal dashboard Review 1.1 found numbers and dates that did not agree across screens: EU-000770 shown Expired while the Audit log said cancelled, EU numbers out of date order, the same driver on every EWA, a ₱18,000 rescue charge that did not break down under BR-11 and was missing from the rescue list, overlapping billing periods, a cancelled invoice numbered out of order, and due / contract dates one day off.

- The cancelled EWA in the Audit log is now its own record, EU-000765 (Cancelled, with the reason); EU-000770 is a plain expired EWA. Old EWA numbers now follow their creation dates (oldest = EU-000600) and use four different drivers.
- RSC-000020 added as a completed rescue with a full BR-11 breakdown: travel 20 km × 2 × ₱50 = ₱2,000 + parts ₱12,650 = ₱14,650 + 10% ₱1,465 + 12% VAT ₱1,933.80 = ₱18,048.80. The e-wallet deduction and balance follow it: ₱30,000 − ₱18,048.80 = ₱11,951.20 (was ₱12,000).
- The cancelled duplicate invoice is renumbered INV-MNL-00001103 (same billing run as 00001102). The repair invoice INV-MNL-00001118 covers its gate-in day only, so no billing periods overlap.
- Date-only fields (invoice date, due date, billing period, contract dates) now use the Manila calendar day. They had been one day early before 08:00 Manila time. The due date is now the invoice date + 30 days, and the contract starts on the same day as the first top-up.
- RSC-000041 has its load status and photos. One ABC unit (DW-MNL-1001) was hired out and returned, so the return history has a real record.
- Mock DB version 13: saved demo data reloads once.

**Result:** The figures the reviewer checked reconcile, except the e-wallet, which now reads ₱11,951.20 by design. The staff app still has the old sample data until the same seed change is made there.

### Portal dashboard — gaps from review 1.1 `Feature`

**Why:** DBL-CLT-017 / RPT-009 items were missing from the dashboard: active contracts, service ticket status, equipment return history, the oldest-due amount, the account executive contact, and a way to reach the cash bond, feedback and password change.

- New Active contracts tile (count + nearest expiry). Oldest due now shows the amount and “due in / overdue N days”.
- New Open service requests card (open rescues with status and ETA) and Returned equipment card (hire date → return date, Gate In pass).
- E-wallet recent transactions: newest first, with category, reference and running balance. The amber rule is stated (amber below ₱12,500 = 125% of the minimum; red below ₱0) along with the cash bond held and a link to the withdrawal.
- EWA history adds truck plate and created date; Cancelled status shown. Menu label “E-wallet” → “E-wallet & bond”.
- Footer names the Account Executive with phone and email. The user name opens an account menu: Change password, Send feedback, Sign out (closes on outside click / Esc). The Change password fields have placeholder text: “Enter your current password”, “At least 10 characters, with A–Z, a–z and 0–9”, “Re-enter the new password”.
- Send feedback: category, subject, message and optional reference; the Account Executive is notified and the client gets an FB- reference number.

### Portal EWA — validation, confirmation, cancelled status, gate pass link `Feature`

**Why:** Review 1.1 (GAT-001/002/003): no format or quantity checks, no confirmation screen, no Cancelled status, rows not newest-first, and no trucker, equipment or gate pass on the list.

- New EWA: truck plate and driver licence format checks (proposed LTO formats NAB 5678 / N01-23-456789). Quantity must be a whole number no more than the units available at the branch. Equipment types limited to the contract’s rate card, each with its available count. A “Missing driver/truck info” banner appears if a driver or truck field is blank.
- After Create EWA, a confirmation shows the EU number, valid until, all details and the email recipients, with Copy and Print / PDF.
- List: newest first, Cancelled tab, branch filter, Equipment column (type + released / requested), 10 rows per page.
- Detail: Gate Pass no. + unit + time + truck OR/CR once used, cancellation reason, created via portal / Delbros, Print / PDF.

### Portal rescue, invoices, e-wallet, contracts — review 1.1 items `Feature`

**Why:** Review 1.1 asked for a rescue type, status timeline, charge breakdown and cancel action; VAT split, issue date, filters and PDF on invoices; receipt series and application on the SOA; clearer cash bond and top-up states; and contract terms.

- Rescue: required Problem type; unit list shows type and branch; PH phone number check; photos limited to images ≤ 5 MB; below-minimum e-wallet warning (requests still allowed, BR-04); detail with a status timeline, scene contact, ETA, photos and the BR-11 breakdown; client can cancel while still Requested (reason required, dispatcher notified).
- Invoices: Invoice date column, “N d overdue”, status filter (All / Unpaid / Partly paid / Overdue / Paid / Cancelled), search, newest first. Invoice view shows bill type, branch, terms, Net of VAT / VAT 12% / Total, cancellation reason, and Print / PDF. Payment terms stated in the page header.
- Statement: header shows client name, code and billing cycle. Receipts are labelled Official / Provisional and shown under the OR number with “From PR-… · applied to INV-…”.
- E-wallet: tile states the amber threshold; Top-up requests card always shown (with an empty state); cash bond row shows Bond − unpaid invoices − negative wallet − open DMs = refundable; ledger shows category (e.g. “Deduction · Rescue”), newest first, searchable.
- Contracts: lock-in, late interest, non-return and dishonored-check penalties, e-wallet minimum, units contracted, branches covered, signed / notarized dates, rates marked “exclusive of 12% VAT · effective …”, entitled quantity per type, units on hire under the contract, and a Request renewal / amendment / termination action.
- Vendor portal: the Paid tile is labelled “All time”.

**Result:** Typecheck, 36 unit tests and browser screenshots of every portal screen pass. The audit with before / after screenshots is in doc/audit-review-1.1/index.html.

## 25-Oct-2026

### Staff app — user menu closes when you click elsewhere `Fix`

**Why:** The user menu (Change password / Reset demo data / Sign out) only closed when the name was clicked again; clicking another control or anywhere on the page left it open.

- The menu now closes on a click anywhere outside it, on another header icon, and on Esc — and still when you pick a menu item or move to another page. Clicking the name still opens and closes it.

### Staff app and portal split into two standalone projects `Housekeeping`

**Why:** Requested: separate the two apps so each builds, runs and deploys on its own (backup taken first: 25-10-26final-backup-frontend.zip).

- The former frontend monorepo (apps + shared packages) is now two independent projects next to it: frontend-staff and frontend-portal.
- Each project has its own copy of the shared code under src/lib (ui components and theme, shared types / calculations / change log, mock API and sample data), its own package.json, libraries, tsconfig, scripts and README. No links between the two projects.
- Behaviour and screens are unchanged. Each project passes its own typecheck, 36 unit tests and production build with the no-CDN check; both were tested in the browser (sign-in, dashboard, lists, forms).
- Trade-off: a fix to shared code (src/lib) must now be made in both projects.

### Type-ahead fields — app-styled list instead of the browser’s `Fix`

**Why:** Fields with suggestions showed the browser’s own ▼ arrow on hover and a dark native popup (e.g. Create job order → Chassis / asset reference), which did not match the app.

- New shared type-ahead: an app-styled list under the field, filtered as you type, with a muted hint per option (e.g. chassis status “Available”, “On hire”); mouse or ↑ ↓ Enter / Esc; a new value can still be typed.
- Used for Create job order → Chassis / asset reference and Worker / laborer assignment, and Chassis form → Partner code. No browser suggestion lists remain in either app.

### Back button on every screen (both apps) `Feature`

**Why:** Requested: getting back to the previous screen was complicated (only the sidebar or the browser button).

- A “← Back” button at the left of the top bar returns to the previous screen. Same in the client / vendor portal header.
- Shown only on screens reached through a link inside a page — e.g. Clients list → client detail, Contracts → contract detail, a related record. Hidden on screens opened from the main navigation (sidebar, approvals / notifications icons, user menu, portal menu) and on the landing screen after every sign-in (also after signing out and in again, and in the portal).
- Detail panels that open through the page address (e.g. a registration record) count as a step too, so Back closes them first.

### Aging receivables — Print / PDF `Fix`

**Why:** Print / PDF printed the screen: cards split across pages, the filter toolbar printed, and the client table was cut off on the right.

- Print / PDF now opens a print preview of a proper landscape report: company header, report no. and date, the filters used (as-of date, branch, AE, status, stage, bucket), the six summary figures, portfolio buckets with %, buckets by branch, every filtered client (not just the first 10) with buckets, total and collection stage, and column totals.
- Checked as a real PDF: one landscape page, nothing cut off.

### Summary cards — long hint no longer overlaps the number `Fix`

**Why:** On cards with a long hint and a large peso amount (e.g. Executive dashboard “Billed (period)”), the hint text ran under the number.

- When the hint and the number do not fit on one line, the hint sits above and the number stays in the bottom-right corner. Checked by measuring every card on the Executive dashboard: no overlaps.

### Summary cards — number in the bottom-right corner `Fix`

**Why:** Requested: on every summary card the number should sit in the bottom-right corner, right-aligned.

- All KPI / summary cards in both apps (Allocation board, Executive dashboard, Compliance, Invoices, Aging, portal Invoices & SOA, etc.): label top-left, number bottom-right and right-aligned; any hint or trend (e.g. “Target 0”, “On hire ÷ fleet”) bottom-left on the same line.
- Cards in a row share the same height so the numbers line up. Dashboard fleet tiles follow the same layout (“View list” bottom-left, count bottom-right); Executive dashboard drill-down arrows moved to the top-right corner.

### Consolas replaced by Inter everywhere `Fix`

**Why:** Requested: wherever Consolas appeared it should use Inter, the app font.

- IDs and codes (EWA, job order, invoice, chassis, contract, OR / PR, SOA numbers…) and code snippets used the system monospace font, which is Consolas on Windows. They now use Inter in both apps and on printed documents.
- Digits stay fixed-width (tabular figures), so ID columns still line up. One change in the shared theme (src/lib/ui/theme.css).

### Dashboard — layout and icons `Fix`

**Why:** Requested: make the Dashboard look more polished — layout only, nothing added or removed.

- Fleet status tiles (Available, Allocated, On hire, In repair, Rescue, Breakdown, Parked) each have a coloured icon and a matching colour bar — the same colours as the Executive dashboard fleet chart — with a larger count; the whole tile opens the list.
- The Active EWAs, Open job orders and Open rescues panels have an icon in the header, even row heights and a row hover highlight; empty messages centred.

### Change log — full-page design `Housekeeping`

**Why:** Requested: the change log should open as a proper full page with a cleaner design instead of a side panel.

- The sticky “Change log” button on both sign-in pages now opens a full-page view: branded header with totals per type and the period covered, a sticky filter bar (All / Fix / Feature / Report / Housekeeping) with search, and a day-by-day timeline.
- Each change is a card with a colour-coded type, the reason (Why), the list of changes and a highlighted Result. Close or Esc returns to the sign-in page.

### Sample data — System Administrator approvals and notifications `Feature`

**Why:** Requested: the admin should see every tab of Notifications and My approvals filled, to review how the screens look.

- My approvals → Pending my action (4): user access for a new Cebu Accounting user, unlock account BG.CEB, EWA extension EU-000779 revalidation, cross-branch return code for DW-CEB-1046 — each waiting at an IT step, with earlier steps signed.
- Escalated (2): the EWA revalidation and the cross-branch return code are past their due time.
- Submitted by me (3): setting change e-wallet minimum ₱10,000 → ₱15,000 (pending Finance Manager), EWA validity 24 h → 48 h (approved), Treasury role for ACCTG (rejected by CHRO with a reason). History shows the decided ones.
- Notifications (10, 4 unread): approval needed, account locked, escalation that needs acknowledging, email delivery failure, setting changes, DCIR snapshot, audit hash check, new portal registration — each links to its screen.
- Approval drawers link to Users & roles / System settings for user and setting requests. Demo data reloads once (mock DB version 12).

### Admin always lands on the Dashboard after sign-in `Fix`

**Why:** Requested: every admin sign-in should open the Dashboard, not another page (it opened Users & roles, or the last page visited).

- System administrators now land on Dashboard after every sign-in, and when opening the app root.
- Other roles keep their role landing page (e.g. Executive dashboard for executives, Aging for Credit & Collection) and still return to a deep link they were sent from.

### Staff sign-in — Forgot password without a popup `Fix`

**Why:** Requested: the reset-password step should happen in the same sign-in section, not in a popup.

- “Forgot password?” (and “Reset password” on a locked-account message) switches the sign-in panel to “Reset your password”: user ID or email, Send reset link, ← Back to sign in.
- After sending, the same panel confirms “Check your email” (link valid 30 minutes) with a Back to sign in button. The portal already used its own reset page.

### Placeholder text in empty form fields (both apps) `Fix`

**Why:** Many free-entry fields were blank boxes (e.g. “What happened?”, “Contact at scene”, “Contact number” on the portal rescue request), so users had to guess the expected content or format.

- About 250 fields now show a short example or prompt; labels, validation and layout are unchanged. Formats follow the app’s real data (chassis DW-MNL-1001, contract LTL-2026-0045, invoice INV-MNL-00001101, OR7000000, client C-00123, asset AST-FL-007).
- Portal (16): rescue request — “Describe what happened — e.g. flat tire on the left rear axle”, contact “e.g. Juan Dela Cruz”, number “e.g. 0917 123 4567”; EWA trucker / driver / quantity; cash-bond withdrawal reason; vendor invoice no.; sign-in, registration and forgot-password fields.
- Admin, approvals and shared (64): change password; user editor (password “Leave blank to auto-generate”); settings value and change reason; every master-data field (branch, warehouse, equipment type, part, vendor, lists); rate and price dialogs; approval comments; notification-rule recipients, timers, email subject / body and SMS text; staff sign-in; inspection checklist branding / tread depth.
- Operations (55): trucker, driver, licence and plate on New EWA, Edit EWA, Gate Out, Gate In and Park & Fix; flat-tire count; cross-branch code; force-inbound chassis; unit-request quantity and notes; park-in trailer and plate; chassis, maintenance-log and asset forms; registration and renewal (OR / CR no., agency, follow-up).
- Rescue, repair, inventory, procurement (37): incident description, contacts, distance; job-order notes, laborer, hours, rate; physical count and variance reason; stock request and transactions; PR justification, PO terms, payee, receiving notes and quantities.
- Clients and finance (81): client registration, contacts / signatories, client edit, BICI evaluation (10 fields), sales activity; contract custom type, credit term, lock-in, amendment / termination / withdrawal reasons, cash-bond notes; payment check no., bank, transfer reference; memo and adjustment reasons; hold-lift arrangement, collection notes, SOA recipient and courier tracking; e-wallet bank and Treasury references.
- Amount fields show “0.00” and date fields “Select date” (shared components).

### Change log added `Housekeeping`

**Why:** To let the team follow the order and reasons of the changes during the correction phase.

- Sticky “Change log” button in the bottom-right corner of both sign-in pages (staff app and portal); it opens this log in a side panel. CHANGELOG.md in the project root has the same entries.
- Shown only while app-config.json has "showChangeLog": true — set it to false to hide it without a rebuild.

### Client portal — Print statement `Fix`

**Why:** Printing the Invoices & SOA page printed the screen itself: navigation, tiles and a cut-off invoice table with a scrollbar.

- Print statement now prints a proper Statement of Account: company header, SOA no. and as-of date, client details, aging row, every transaction with running balance, balance due, payment instructions and footer.
- Column headings repeat on each printed page; only the statement is printed.
- Company address / TIN / BIR permit / payee bank print once entered in Admin → System settings → Company.

**Result:** Checked as a real PDF: one clean page for ABC Logistics.

## 22-Oct-2026

### UI/UX report — score tile shows the current score only `Report`

**Why:** Requested: the summary tile should show the current score, not before → after.

- Average UI score tile now reads “4.98 — Current average UI score / 5”.

### High / Medium findings cleared — equipment names and company details `Fix`

**Why:** The last High and Medium audit items were placeholder data: “Equipment Type 1–8” and “to be confirmed” company address, TIN and bank details.

- Equipment types now carry their real names: 20ft chassis, 40ft chassis, 40ft flatbed, 40ft combo, 40ft super combo, 45ft chassis, cane cage trailer (DBL-CHS-001) and 20ft flatbed (legacy master database, 28-May-2026). Codes EQ1–EQ8 are unchanged, so existing records keep their links.
- New settings group Admin → System settings → Company: registered address, VAT Reg. TIN, BIR permit details, payee bank account.
- Invoices, receipts, EIRs, SOA and the portal top-up page show those values once entered; until then the line is left out (no more “to be confirmed” on client documents). Staff see a reminder above the print preview (screen only).
- UI/UX report summary tiles now separate UI defects from business decisions.

**Result:** Report: 0 High, 0 Medium; 23 Low (5 UI items, 18 business/data items). Finance still has to enter the four company values before go-live.

### Report library — Print `Fix`

**Why:** Print on a report printed the screen: search box, Export button, cut-off columns and only the current page of rows. Long documents also printed rows on top of each other.

- Print opens a print preview with a proper document: header, report name, filters used (period / branch / client), every row, money totals and footer. Wide reports print landscape.
- All print previews now print a clean copy in normal page flow: multi-page documents paginate, table headings repeat, headers / footers / signature blocks are never split.
- Report dates show as dd-Mon-yyyy on screen and on paper.

### DCIR print preview `Fix`

**Why:** The 22-column DCIR matrix was wider than a portrait page; the last columns were cut off behind a scrollbar.

- DCIR prints on a landscape Letter page with compact cells and wrapping headings — all 22 columns fit.

### File upload fields `Fix`

**Why:** Some uploads showed the browser’s raw “Choose Files / No file chosen” control.

- One styled picker (“Choose file(s)” button + selected file names) for OR/CR documents, invoice-adjustment evidence and the bin-card photo; the other uploads already used it.

### Follow-up on the independent re-audit `Fix`

**Why:** The re-audit after the Low-findings pass found 13 side effects (mostly labelled row buttons making tables wider than their cards).

- Clients: “Lift hold” is a compact link stacked above View. Compliance dashboard: whole row opens the record; Renew / Resend / Follow-up wrap two per line. Inventory: Create PR / Count stacked.
- Tables re-measure after tightening their padding, so the “more columns” fade only shows when columns really are hidden (checked on all 56 staff pages: none overflow at 1600 px).
- Sales performance month filter is an app dropdown (last 24 months); Aging “As of” date no longer truncated; vendor invoice date no longer repeated; permission-matrix bulk toggles look clickable; EIR and fleet legend say “On hire”.

### Low-severity UI findings (about 90) across all modules `Fix`

**Why:** Clear the remaining Low items of the UI/UX audit — UI only, no new business rules.

- Admin: permission matrix row / column bulk toggles; notification-rule field is a dropdown; branch region on one line; Visayas / Mindanao price labels; audit-log acronyms (EWA, EIR, PO…) and system reasons without rule codes; dashboard panel headers aligned.
- Operations: equipment select disabled until a contract is chosen; EWA Cancel styled as a danger action and “Valid until” above the date; Actions header and Transfer label on allocation; receipt buttons “In receipt / Out receipt”; asset and chassis forms show what is required before Save; Renew / Resend / Follow-up labelled; chassis detail IDs in mono.
- Rescue & repair, inventory, procurement: locations wrap; cards no longer stretched; rescue references are links; table titles and legend contrast; labelled row actions; duplicate prefixes (PO PO-…) removed; particulars column labels; “Final: …” approver chip; optional / required markers on job-order fields.
- Clients & finance: labelled hold-lift and History actions; reasons shown in full; contract header tidy; Withdraw disabled when nothing is refundable; held-lines label; invoice numbers as links; compact empty states; payment form says what is missing; “Created” date range; one colour for Escalated; executive dashboard captions.
- Portal: rescue references open a read-only detail; total-due tile centred; ledger references in mono; contract documents listed; vendor upload states the 10 MB limit (proposed — confirm); registration shows the same 4 password rules as Change password.
- Shared: tables tighten padding automatically instead of overflowing; chassis statuses in sentence case; approval steps not yet reached show “Not started” (amber kept for current / escalated); “(demo)” removed from all names; demo sign-in panel controlled by app-config showDemoLogins (off for production).

**Result:** Independent re-audit: open findings 133 → 55, then 39 after the follow-up.

### App-wide calendar (date picker) `Feature`

**Why:** Date fields used the browser’s native picker, whose look and format (mm/dd/yyyy) differed per browser and from the rest of the app.

- One calendar for every date and date-time field: shows dd-Mon-yyyy (HH:mm), month / year selects, Today / Now and Clear, min / max limits, keyboard support; works inside dialogs and drawers.
- Form values unchanged (YYYY-MM-DD), so no business logic changed.

### Reviewer UI remarks (High → Medium → Low) `Fix`

**Why:** Fix the important remarks from the two correction files, without adding or removing unnecessary content.

- EIR prints the checklist and the captured driver signature; signature lines aligned.
- Treasury sees a Review action on its pending late-encoding step; empty states with hints; links from held invoice lines and late-encoding memos.
- Sample data for a cash-bond withdrawal and an expired portal EWA so those states can be reviewed.

**Result:** 321 of 331 remarks resolved, 10 partly, 0 still present; 14 are business decisions.

### UI/UX fix passes 1 and 2 `Fix`

**Why:** Bring every screen to at least 4.5 / 5, High issues first, following the corrections only.

- Garbled characters repaired on the finance screens and printed invoice; internal requirement codes (BR-, DBL-, Q-, SCR-…) removed from user-facing text.
- Tables: IDs, dates and amounts never wrap; long text columns wrap; actions column not pinned over data; scroll cue only when more columns exist.
- Amounts scale inside KPI tiles; dialogs keep their buttons visible; switches sit before their own label; dropdowns no longer look disabled; charts render without animation glitches.

**Result:** Average score 3.11 → 4.67; all 87 screens at 4.5 or higher.

### UI/UX audit report and deep audit report `Report`

**Why:** Check every screen of both correction files and the whole app against the documents (reports only — no code change).

- Deep audit report (HTML, with screenshots) in “audit report”.
- UI/UX audit report (HTML, with before / now screenshots) in “ui-ux-audit” — updated after every fix pass.

### UI fixes requested from screenshots `Fix`

**Why:** Layout problems reported directly during the correction review.

- Dropdown arrow padding on every select.
- EWA list alignment; E-wallet segmented control no longer squashed.
- Stray scroll arrows removed app-wide.
- Gate In screen layout.
- Every side drawer at least 75% of the screen width.
- Park & Fix spacing and Rescue totals layout (spacing only — no content added or removed).

### Correction review — internal system and Client Self-Service Portal `Fix`

**Why:** Review “internal system.docx” and “Client Self-Service Portal.docx”, record the state before changes and fix all buildable items.

- Audit report of the state before the changes (Word): “Correction file\Audit Report - Correction Review - v0.1.0 - 2026-10-22.docx” — 947 reviewer items checked.
- Fixed per module: Admin 87 · Gate operations (EWA, Gate Out/In, EIR, late encoding) 55 · Allocation, DCIR, Park & Fix 36 · Rescue & repair 31 · Clients & sales 76 · Billing, invoices, receipts, memos 84 · E-wallet, client status, SOA, aging 54 · Assets & inventory 68 · Procurement, compliance & reports 81 · Client & vendor portal 11 — 583 fixed in total; 93 already in the build, 45 partly fixed, 104 open for a client decision, 122 needed no change.
- Aging buckets: one shared calculation now gives six buckets (Current, 1–30, 31–60, 61–90, 91–180, Over 180) on Aging, the Executive dashboard, the SOA and the portal; unit tests added.
- Sample data made consistent: every screen uses the same 60-unit chassis set; Park & Fix uses client-owned trailers; open-rescue counts exclude cancelled / completed requests.
- Screen headers cite the FRS requirement IDs; the report library uses one report-code scheme.
- “Thread depth” corrected to “Tread depth” on Gate Out, Gate In and the printed EIR.
- Notification rules N41–N49 (rescue dispatch, collection stages, accreditation stages, internal registration) now have the matching events.
- Only one client portal exists (the spec-complete design); findings against the older “MOD-XX” screens were closed.
- Mock database version stamped automatically so new sample data loads once and then persists.

**Result:** 583 of 947 items fixed; the rest were already present, partly fixed, need a client decision or needed no change.

### Backup before changes `Housekeeping`

**Why:** Safe restore point before the correction work.

- Dated zip of delbros-leasing-frontend v0.1.0.

---

## How to hide or remove the change log

- **Hide (no rebuild):** set `"showChangeLog": false` in `public/app-config.json` (or the deployed copies). The button disappears from both sign-in pages.
- **Remove completely:** search the code for `CHANGELOG-REMOVE` and delete those lines / files (`src/lib/shared/changelog.ts`, `src/lib/ui/ChangeLog.tsx` and its export, the `<ChangeLogLauncher />` line on each login page, this script and this file).
