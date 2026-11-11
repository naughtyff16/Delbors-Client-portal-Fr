// Configuration keys (docs/05-business-rules.md §Configuration keys). Defaults only — runtime values
// come from system_settings and are editable in SUP-05 without a deploy (NFR-006).
export interface SettingDef {
  key: string; label: string; group: string; type: 'number' | 'money' | 'percent' | 'text' | 'json' | 'boolean'; value: unknown; rule: string; pending?: boolean;
  /** SUP-05 edit-dialog metadata (see SETTING_META): unit, allowed range, whole-number flag, choice list, help text. */
  unit?: string; min?: number; max?: number; integer?: boolean; options?: { value: string; label: string }[]; help?: string;
  /** Open decision reference for pending values (docs/10); sensitive = hold/tier/threshold/security values (second approver pending Q-ADM-02). */
  decision?: string; sensitive?: boolean;
  /** Runtime only — stamped by the API on save. */
  updatedBy?: string; updatedAt?: string; effectiveFrom?: string;
  /** A future-dated change waiting for its effective date (BR-18: never rewrites values already stamped on documents). */
  scheduled?: { value: unknown; from: string; by: string; reason: string };
}

export const DEFAULT_SETTINGS: SettingDef[] = [
  { key: 'cnc.hold_threshold_days', label: 'Auto-hold ageing threshold (days)', group: 'Credit & Collection', type: 'number', value: 30, rule: 'BR-02' },
  { key: 'cnc.hold_age_basis', label: 'Ageing measured from', group: 'Credit & Collection', type: 'text', value: 'acknowledgment', rule: 'DBL-CNC-005 (Q-CNC-03)', pending: true },
  { key: 'cnc.tier1_max', label: 'Hold-lift Tier 1 max (Officer 1)', group: 'Credit & Collection', type: 'money', value: 100000, rule: 'BR-03' },
  { key: 'cnc.tier2_max', label: 'Hold-lift Tier 2 max (Officer 1 + Finance Mgr)', group: 'Credit & Collection', type: 'money', value: 500000, rule: 'BR-03' },
  { key: 'cnc.tier3_min', label: 'Hold-lift Tier 3 min (Officers 1, 2, 3)', group: 'Credit & Collection', type: 'money', value: 1000000, rule: 'BR-03' },
  { key: 'cnc.gap_policy', label: 'Policy for ₱500k–₱1M gap', group: 'Credit & Collection', type: 'text', value: 'use_tier3', rule: 'BR-03 (Q-CNC-02)', pending: true },
  { key: 'cnc.first_reminder_days', label: '1st reminder after SOA (days)', group: 'Credit & Collection', type: 'number', value: 5, rule: 'UC-09' },
  { key: 'cnc.second_reminder_days', label: '2nd reminder after SOA (days)', group: 'Credit & Collection', type: 'number', value: 10, rule: 'Q-CNC-04', pending: true },
  { key: 'cnc.demand_letter_days', label: 'Demand letter after SOA (days)', group: 'Credit & Collection', type: 'number', value: 20, rule: 'Q-CNC-04', pending: true },
  { key: 'ewl.min_balance', label: 'E-wallet minimum balance', group: 'E-Wallet', type: 'money', value: 10000, rule: 'BR-04 (Q-001)' },
  { key: 'gat.late_encoding_auto_days', label: 'Late encoding auto-correct window (days)', group: 'Gate Operations', type: 'number', value: 7, rule: 'BR-05' },
  { key: 'gat.ewa_validity_hours', label: 'EWA validity (hours)', group: 'Gate Operations', type: 'number', value: 24, rule: 'BR-06' },
  { key: 'gat.cross_branch_code_ttl_hours', label: 'Cross-branch code validity (hours)', group: 'Gate Operations', type: 'number', value: 72, rule: 'BR-16' },
  { key: 'prc.po_tier_threshold', label: 'PO approval threshold (CEO + CHRO above)', group: 'Procurement', type: 'money', value: 250000, rule: 'BR-09' },
  { key: 'fin.pcv_max', label: 'Petty cash maximum (RFP above)', group: 'Finance', type: 'money', value: 4000, rule: 'BR-10' },
  { key: 'fin.pcv_fund_float', label: 'Petty cash fund float (per entity)', group: 'Finance', type: 'money', value: 20000, rule: 'BR-10 (Q-PRC-PCF)', pending: true },
  { key: 'reg.renewal_cost_default', label: 'Default registration renewal cost (budget forecast)', group: 'Regulatory', type: 'money', value: 1800, rule: 'DBL-REG-005 (Q-REG-COST)', pending: true },
  { key: 'fin.vat_pct', label: 'VAT rate', group: 'Finance', type: 'percent', value: 0.12, rule: 'BR-11' },
  { key: 'fin.adjustment_approval_threshold', label: 'Billing adjustment approval threshold', group: 'Finance', type: 'money', value: 5000, rule: 'Q-FIN-01', pending: true },
  // SCR-34..37 correction pass — proposed defaults pending Finance decisions.
  { key: 'fin.billable_day_rule', label: 'Billable-day count rule', group: 'Finance', type: 'text', value: 'Pickup and return day both count; never more than the period days', rule: 'SR-004 (Q-FIN-02)', pending: true },
  { key: 'fin.billing_cycles', label: 'Billing cycles offered in the billing run', group: 'Finance', type: 'text', value: 'Weekly,Monthly', rule: 'DBL-FIN-001 (Q-FIN-04: Semi-monthly?)', pending: true },
  { key: 'fin.payment_instructions', label: 'Payment instructions printed on invoices', group: 'Finance', type: 'text', value: 'Check payable to DELBROS LEASING · Bank transfer to the Delbros payee account · Client e-wallet top-up via the portal', rule: 'DBL-FIN-006 (Q-FIN-05)', pending: true },
  // Company details printed on invoices, receipts, EIRs, SOAs and shown on the portal top-up page. Empty until Finance enters them — documents then simply omit the line.
  { key: 'co.registered_address', label: 'Company registered address (printed documents)', group: 'Company', type: 'text', value: '', rule: 'DBL-FIN-006 (docs/12 §9)', pending: true },
  { key: 'co.tin', label: 'Company VAT Reg. TIN incl. branch code (printed documents)', group: 'Company', type: 'text', value: '', rule: 'DBL-FIN-006 (docs/12 §9)', pending: true },
  { key: 'co.bir_permit', label: 'BIR permit / CAS acknowledgment details (document footer)', group: 'Company', type: 'text', value: '', rule: 'RSK-008 (docs/12 §9)', pending: true },
  { key: 'co.payee_bank', label: 'Payee bank and account for client payments / top-ups', group: 'Company', type: 'text', value: '', rule: 'DBL-FIN-006 (Q-FIN-05)', pending: true },
  { key: 'fin.receipt_cancel_role', label: 'Receipt cancel / reverse allowed for', group: 'Finance', type: 'text', value: 'Accounting with reason (audit logged)', rule: 'DBL-FIN-012 (Q-FIN-06)', pending: true },
  { key: 'res.service_charge_pct', label: 'Rescue service charge', group: 'Rescue', type: 'percent', value: 0.1, rule: 'BR-11' },
  { key: 'res.rate_per_km', label: 'Rescue standard rate per km', group: 'Rescue', type: 'money', value: 50, rule: 'BR-11 (value TBD)', pending: true },
  { key: 'res.sla_amber_hours', label: 'Rescue SLA amber after (hours, request → completion)', group: 'Rescue', type: 'number', value: 2, rule: 'DBL-RES-007 (proposed)', pending: true },
  { key: 'res.sla_red_hours', label: 'Rescue SLA red after (hours, request → completion)', group: 'Rescue', type: 'number', value: 4, rule: 'DBL-RES-007 (proposed)', pending: true },
  { key: 'rm.hours_per_laborer_week', label: 'Laborer hours per week (headcount planning)', group: 'Repair', type: 'number', value: 48, rule: 'DBL-RM-006 (proposed)', pending: true },
  { key: 'rm.shift_hours', label: 'Shift windows (morning / afternoon / evening)', group: 'Repair', type: 'text', value: 'Morning 06:00–14:00 · Afternoon 14:00–22:00 · Evening 22:00–06:00', rule: 'DBL-RM-007 (Q-RM-02)', pending: true },
  { key: 'ast.pm_due_soon_days', label: 'Non-chassis PM “due soon” flag (days before Next PM)', group: 'Assets & Inventory', type: 'number', value: 7, rule: 'BO-APS-04 (proposed default)', pending: true },
  { key: 'inv.count_cycle_days', label: 'Cycle count due after (days since last count)', group: 'Assets & Inventory', type: 'number', value: 30, rule: 'DBL-INV-004 (monthly cycle)' },
  { key: 'inv.recount_variance_qty', label: 'Variance needing recount (± units)', group: 'Assets & Inventory', type: 'number', value: 5, rule: 'DBL-INV-004 (proposed default)', pending: true },
  { key: 'clt.cash_bond_default', label: 'Default cash bond', group: 'Client & Contract', type: 'money', value: 20000, rule: 'BR-14' },
  { key: 'clt.rate_variance_tolerance_pct', label: 'Contract rate variance vs template needing approval (%)', group: 'Client & Contract', type: 'number', value: 10, rule: 'DBL-ALO-001 / SCR-08 (proposed)', pending: true },
  { key: 'clt.renewal_amber_days', label: 'Contract “expiring soon” flag (days before expiry)', group: 'Client & Contract', type: 'number', value: 90, rule: 'DBL-CLT-011 (3/2/1-month notices)' },
  { key: 'clt.pretermination_cap_days', label: 'Pre-termination fee — days of rent charged at most (inside the lock-in)', group: 'Client & Contract', type: 'number', value: 30, rule: 'BR-15 (Q-CLT-PTF)', pending: true },
  { key: 'sal.target_new_accreditations', label: 'Monthly target per AE — new accreditations', group: 'Sales targets', type: 'number', value: 2, rule: 'DBL-CLT-015 (proposed)', pending: true },
  { key: 'sal.target_combined_calls', label: 'Monthly target per AE — combined calls (calls + visits)', group: 'Sales targets', type: 'number', value: 40, rule: 'DBL-CLT-015 (proposed)', pending: true },
  { key: 'sal.target_weekly_visits', label: 'Weekly target per AE — client visits', group: 'Sales targets', type: 'number', value: 3, rule: 'DBL-CLT-015 (proposed)', pending: true },
  { key: 'sal.target_tracker_compliance_pct', label: 'Target per AE — tracker-update compliance (%)', group: 'Sales targets', type: 'number', value: 90, rule: 'DBL-CLT-015 (definition Q-CLT-03)', pending: true },
  { key: 'sal.tracker_logging_days', label: 'Tracker update counts as on time if logged within (days)', group: 'Sales targets', type: 'number', value: 1, rule: 'DBL-CLT-015 (definition Q-CLT-03)', pending: true },
  { key: 'wf.escalation_hours', label: 'Approval escalation timer — global fallback (hours)', group: 'Workflow', type: 'number', value: 48, rule: 'DBL-NOT-005' },
  // SUP-05 per-approval-type escalation timers (baseline 1–2 days, configurable per type). Read by core startWorkflow/decide.
  ...([['PAYMENT_REQUEST', 'RFP / PCV'], ['PR_PO', 'PR / PO'], ['JOB_ORDER', 'Job order confirmation'], ['HOLD_LIFT', 'Hold-to-Active'], ['CONTRACT_SIGNATURE', 'Contract signature'], ['ACCREDITATION', 'Accreditation'], ['MEMO', 'Credit / debit memo']] as const)
    .map(([t, l]): SettingDef => ({ key: `wf.escalation_hours.${t}`, label: `Escalation timer — ${l} (hours)`, group: 'Workflow', type: 'number', value: 48, rule: 'DBL-NOT-005' })),
  // SUP-05 configurable items added after review (gate-pass, registration, pricing, eligibility, scoring, routing)
  { key: 'gat.gatepass_seq_digits', label: 'Gate-pass number length (digits after branch prefix)', group: 'Gate Operations', type: 'number', value: 4, rule: 'DBL-GAT-007 (Q-GAT-07)', pending: true },
  { key: 'reg.notice_days', label: 'Registration renewal notices (days before expiry)', group: 'Regulatory', type: 'text', value: '90,30,14', rule: 'DBL-REG-003' },
  { key: 'reg.renewal_cycle_months', label: 'Registration renewal cycle (months, LTO rules)', group: 'Regulatory', type: 'number', value: 12, rule: 'DBL-REG-001 (Q-REG-02)', pending: true },
  { key: 'prc.pr_routing', label: 'PR / PO approval routing gates', group: 'Procurement', type: 'text', value: 'DEPT_HEAD>APS_MANAGER>APS_OFFICER', rule: 'DBL-PRC-002' },
  { key: 'fin.rfp_funding_route', label: 'RFP funding route', group: 'Procurement', type: 'text', value: 'treasury', rule: 'DBL-FIN-014 (Q-FIN-03)', pending: true },
  { key: 'prc.branch_parts_multiplier', label: 'Branch parts markup multiplier (default)', group: 'Procurement', type: 'number', value: 1, rule: 'DBL-PRC-006 (Should)' },
  { key: 'prc.rescue_parts_uplift_pct', label: 'Rescue parts uplift over standard cost', group: 'Procurement', type: 'percent', value: 0.15, rule: 'DBL-PRC-004 (Q-005)', pending: true },
  { key: 'prc.price_rounding', label: 'Price rounding rule', group: 'Procurement', type: 'text', value: 'half_up_peso', rule: 'DBL-PRC-005 (Q-005)', pending: true },
  { key: 'inv.low_stock_default', label: 'Low-stock threshold (default per part)', group: 'Assets & Inventory', type: 'number', value: 5, rule: 'DBL-RPT-004' },
  { key: 'clt.default_allow_lt', label: 'Default eligibility — Allow Long-Term', group: 'Client & Contract', type: 'boolean', value: true, rule: 'DBL-CLT-004' },
  { key: 'clt.default_allow_st', label: 'Default eligibility — Allow Short-Term', group: 'Client & Contract', type: 'boolean', value: true, rule: 'DBL-CLT-004' },
  { key: 'clt.default_allow_online', label: 'Default eligibility — Allow Online (portal EWA)', group: 'Client & Contract', type: 'boolean', value: false, rule: 'DBL-CLT-004' },
  { key: 'clt.default_allow_rescue', label: 'Default eligibility — Allow Rescue', group: 'Client & Contract', type: 'boolean', value: true, rule: 'DBL-CLT-004' },
  { key: 'clt.default_allow_special', label: 'Default eligibility — Allow Special', group: 'Client & Contract', type: 'boolean', value: false, rule: 'DBL-CLT-004' },
  { key: 'clt.credit_score_model', label: 'Accreditation credit-scoring model (weights + pass mark)', group: 'Client & Contract', type: 'json', value: '{"yearsInOperation":25,"financials":35,"tradeReferences":25,"bankReferences":15,"passMark":70}', rule: 'DBL-CLT-006 (Q-CLT-04)', pending: true },
  { key: 'not.urgent_repeat_minutes', label: 'Urgent SMS repeat interval (minutes)', group: 'Workflow', type: 'number', value: 15, rule: 'DBL-NOT-003' },
  { key: 'auth.max_failed_logins', label: 'Max failed logins before lock', group: 'Security', type: 'number', value: 5, rule: 'SCR-01' },
  { key: 'auth.lockout_minutes', label: 'Lockout duration (minutes)', group: 'Security', type: 'number', value: 30, rule: 'SCR-01' },
  { key: 'auth.password_min_length', label: 'Password minimum length', group: 'Security', type: 'number', value: 10, rule: 'SCR-02' },
  // Portal sign-in review (2026-11-11): session timeout, second factor, reset link and support contacts — proposed defaults, confirm with Delbros.
  { key: 'auth.portal_session_timeout_minutes', label: 'Portal session timeout after inactivity (minutes)', group: 'Security', type: 'number', value: 15, rule: 'SCR-01 (Q-SEC-02)', pending: true },
  { key: 'auth.portal_second_factor', label: 'Portal second factor at sign-in', group: 'Security', type: 'text', value: 'email_otp', rule: 'SCR-01 (Q-SEC-03)', pending: true },
  { key: 'auth.reset_link_minutes', label: 'Password reset link validity (minutes)', group: 'Security', type: 'number', value: 30, rule: 'US-ADM-004 (Q-SEC-01)', pending: true },
  { key: 'portal.client_support_phone', label: 'Portal — client support phone (sign-in page)', group: 'Portal', type: 'text', value: '+63 2 8000 1000', rule: 'Portal sign-in (Q-PTL-01)', pending: true },
  { key: 'portal.client_support_email', label: 'Portal — client support email (sign-in page)', group: 'Portal', type: 'text', value: 'clientcare@demo.delbros.local', rule: 'Portal sign-in (Q-PTL-01)', pending: true },
  { key: 'portal.vendor_support_phone', label: 'Portal — Procurement contact phone (vendor sign-in)', group: 'Portal', type: 'text', value: '+63 2 8000 2000', rule: 'Portal sign-in (Q-PTL-01)', pending: true },
  { key: 'portal.vendor_support_email', label: 'Portal — Procurement contact email (vendor sign-in)', group: 'Portal', type: 'text', value: 'procurement@demo.delbros.local', rule: 'Portal sign-in (Q-PTL-01)', pending: true },
  { key: 'portal.dpo_email', label: 'Data Protection Officer email (privacy notice)', group: 'Portal', type: 'text', value: 'dpo@demo.delbros.local', rule: 'RA 10173 (Q-PTL-02)', pending: true },
  { key: 'alo.idle_days_threshold', label: 'Idle unit flag after (days)', group: 'Allocation', type: 'number', value: 30, rule: 'DCIR (TBD)', pending: true },
  { key: 'alo.reg_warn_days', label: 'Warn on Allocate when registration expires within (days); expired = blocked', group: 'Allocation', type: 'number', value: 14, rule: 'DBL-ALO-003 (proposed default — confirm rule)', pending: true },
  { key: 'alo.parkfix_daily_rate', label: 'Park & Fix daily rate (override needs Park & Fix approve permission)', group: 'Allocation', type: 'money', value: 350, rule: 'DBL-ALO-005 (Q-ALO-02)', pending: true },
  { key: 'alo.dcir_snapshot_days', label: 'DCIR nightly snapshot retention (days)', group: 'Allocation', type: 'number', value: 90, rule: 'DBL-ALO-003 (proposed default — confirm retention)', pending: true },
];

export type SettingsMap = Record<string, number | string>;
export const settingsToMap = (defs: SettingDef[]): SettingsMap => Object.fromEntries(defs.map((d) => [d.key, d.value as number | string]));

// ── SUP-05 edit metadata (unit, range, choices, help, decision ref) ─────────
// Kept separate from DEFAULT_SETTINGS so other modules can add keys freely; settingMeta() fills sensible
// defaults (unit + whole-number range) from the type/label for keys without an entry here.
const D = { unit: 'days', integer: true } as const;
const H = { unit: 'hours', integer: true } as const;
export const SETTING_META: Record<string, Partial<SettingDef>> = {
  'cnc.hold_threshold_days': { ...D, min: 1, max: 365, sensitive: true, help: 'A client goes On Hold automatically when any balance is older than this many days. Hold status is re-evaluated whenever balances change, so lowering the value can put clients on hold immediately.' },
  'cnc.hold_age_basis': { decision: 'Q-CNC-03', options: [{ value: 'acknowledgment', label: 'Client acknowledgment of receipt (DBL-CNC-005)' }, { value: 'invoice_date', label: 'Invoice date' }, { value: 'due_date', label: 'Due date' }],
    help: 'DBL-CNC-005 measures the 30-day window from the client’s acknowledgment of receipt, so the default is acknowledgment. The SOA/invoice needs an acknowledgment-date field to support it. Still to be confirmed by Delbros.' },
  'cnc.tier1_max': { min: 1, sensitive: true }, 'cnc.tier2_max': { min: 1, sensitive: true }, 'cnc.tier3_min': { min: 1, sensitive: true },
  'cnc.gap_policy': { decision: 'Q-CNC-02', sensitive: true, options: [{ value: 'use_tier3', label: 'Route to Tier 3 (Officers 1, 2, 3)' }, { value: 'use_tier2', label: 'Route to Tier 2 (Officer 1 + Finance Mgr)' }] },
  'cnc.first_reminder_days': { ...D, min: 1, max: 90 }, 'cnc.second_reminder_days': { ...D, min: 1, max: 120, decision: 'Q-CNC-04' }, 'cnc.demand_letter_days': { ...D, min: 1, max: 180, decision: 'Q-CNC-04' },
  'ewl.min_balance': { decision: 'Q-001' },
  'gat.late_encoding_auto_days': { ...D, min: 1, max: 60 }, 'gat.ewa_validity_hours': { ...H, min: 1, max: 168 },
  'gat.cross_branch_code_ttl_hours': { ...H, min: 1, max: 336, pending: true, decision: 'Q-GAT-05', help: 'BR-16 requires the IT-issued code but gives no validity period. 72 hours is a proposed default; confirm the source.' },
  'gat.gatepass_seq_digits': { unit: 'digits', integer: true, min: 4, max: 8, decision: 'Q-GAT-07', help: 'FRS examples are GEN0001 / CEB0001 (3-letter prefix + 4 digits). The per-branch prefix is maintained in Master data → Branches.' },
  'reg.notice_days': { help: 'Comma-separated days before expiry: 3 months, 1 month, 2 weeks. Drives notification rules N25/N26.' },
  'reg.renewal_cycle_months': { unit: 'months', integer: true, min: 1, max: 60, decision: 'Q-REG-02', help: 'LTO renewal cadence; confirm whether it follows plate ending or registration date.' },
  'prc.po_tier_threshold': { min: 1, sensitive: true },
  'prc.pr_routing': { sensitive: true, options: [{ value: 'DEPT_HEAD>APS_MANAGER>APS_OFFICER', label: 'Dept Head → Admin (APS Mgr) → APS processing' }, { value: 'DEPT_HEAD>APS_OFFICER', label: 'Dept Head → APS processing' }], help: 'Gates every PR/PO passes before the amount-based final approval (CEO + CHRO above the PO threshold).' },
  'fin.rfp_funding_route': { decision: 'Q-FIN-03', options: [{ value: 'treasury', label: 'Treasury releases (check / transfer)' }, { value: 'branch_fund', label: 'Branch revolving fund, Treasury replenishes' }] },
  'prc.branch_parts_multiplier': { unit: '×', min: 0.5, max: 3, help: 'Applied to the standard part price per branch. Per-branch overrides are set in Master data → Branches.' },
  'prc.rescue_parts_uplift_pct': { decision: 'Q-005', help: 'Rescue price = standard cost × (1 + uplift); BR-11 then adds the 10% service charge and 12% VAT. Confirm the uplift is intended (possible double mark-up).' },
  'prc.price_rounding': { decision: 'Q-005', options: [{ value: 'half_up_peso', label: 'Round half up to the peso' }, { value: 'centavo', label: 'Keep centavos (2 decimals)' }, { value: 'ceil_peso', label: 'Always round up to the peso' }] },
  'inv.low_stock_default': { unit: 'units', integer: true, min: 0, max: 10000, help: 'Used when a part has no own low-stock level in Master data → Parts.' },
  'fin.vat_pct': { sensitive: true }, 'fin.adjustment_approval_threshold': { decision: 'Q-FIN-01' }, 'res.rate_per_km': { decision: 'Q-RES-01' },
  'clt.credit_score_model': { decision: 'Q-CLT-04', help: 'Weights (must total 100) and pass mark used in the C&C investigation (BICI). Proposed default; confirm the model with Credit & Collection.' },
  'wf.escalation_hours': { ...H, min: 1, max: 168, help: 'Used for approval types without their own timer.' },
  'not.urgent_repeat_minutes': { unit: 'minutes', integer: true, min: 1, max: 240, pending: true, decision: 'Q-NOT-01', help: 'Repeat-until-acknowledged is required; the interval and the SMS category scope are open in the FRS.' },
  'auth.max_failed_logins': { unit: 'attempts', integer: true, min: 3, max: 10, pending: true, decision: 'Q-SEC-01', sensitive: true },
  'auth.lockout_minutes': { unit: 'minutes', integer: true, min: 5, max: 1440, pending: true, decision: 'Q-SEC-01', sensitive: true },
  'auth.password_min_length': { unit: 'characters', integer: true, min: 8, max: 64, pending: true, decision: 'Q-SEC-01', sensitive: true },
  'auth.portal_session_timeout_minutes': { unit: 'minutes', integer: true, min: 5, max: 240, decision: 'Q-SEC-02', sensitive: true, help: 'Portal users are signed out after this many minutes without activity. A warning with “Stay signed in” appears one minute before.' },
  'auth.portal_second_factor': { decision: 'Q-SEC-03', sensitive: true, options: [{ value: 'email_otp', label: 'Email one-time code (6 digits, 5 minutes)' }, { value: 'off', label: 'Off — password only' }],
    help: 'Whether client and vendor portal users must enter a one-time code after their password. Proposed default: email code. An authenticator app can be added later if Delbros prefers it.' },
  'auth.reset_link_minutes': { unit: 'minutes', integer: true, min: 10, max: 1440, decision: 'Q-SEC-01', sensitive: true },
  'clt.pretermination_cap_days': { unit: 'days', integer: true, min: 0, max: 365, decision: 'Q-CLT-PTF', help: 'BR-15 names a pre-termination fee inside the lock-in but not its amount. Proposed: the daily rates of the units on hire for the lock-in days left, capped at this many days.' },
  'portal.client_support_phone': { decision: 'Q-PTL-01' }, 'portal.client_support_email': { decision: 'Q-PTL-01' },
  'portal.vendor_support_phone': { decision: 'Q-PTL-01' }, 'portal.vendor_support_email': { decision: 'Q-PTL-01' }, 'portal.dpo_email': { decision: 'Q-PTL-02' },
  'alo.idle_days_threshold': { ...D, min: 1, max: 365 },
};

/** Full definition for the edit dialog: base def + SETTING_META + defaults inferred from type/label. */
export function settingMeta(def: SettingDef): SettingDef {
  const m = { ...def, ...SETTING_META[def.key] };
  if (def.key.startsWith('wf.escalation_hours.')) Object.assign(m, { ...H, min: 1, max: 168, help: m.help ?? 'Hours an approval step of this type may wait before it escalates (baseline 1–2 days).' });
  if (m.type === 'money') { m.unit ??= '₱'; m.min ??= 0; m.max ??= 100_000_000; }
  if (m.type === 'percent') { m.unit ??= '%'; m.min ??= 0; m.max ??= 1; }
  if (m.type === 'number' && !m.unit) {
    const u = /\((days|hours|minutes|months|%)/i.exec(m.label)?.[1]?.toLowerCase() ?? (/days/i.test(m.label) ? 'days' : undefined);
    if (u) { m.unit = u; m.integer ??= u !== '%'; } m.min ??= 0; m.max ??= u === '%' ? 100 : 100_000;
  }
  if (m.pending && !m.decision) m.decision = /\((Q-[A-Z0-9-]+)/.exec(m.rule)?.[1] ?? /^(Q-[A-Z0-9-]+)/.exec(m.rule)?.[1];
  return m;
}

/** SUP-05 validation of a candidate value. Returns an error message or undefined. */
export function validateSetting(def: SettingDef, raw: unknown): string | undefined {
  const d = settingMeta(def);
  if (d.type === 'boolean') return typeof raw === 'boolean' ? undefined : 'Choose Yes or No.';
  if (d.options) return d.options.some((o) => o.value === raw) ? undefined : 'Choose one of the listed options.';
  if (d.type === 'json') { try { JSON.parse(String(raw)); return undefined; } catch { return 'Enter valid JSON.'; } }
  if (d.type === 'text') return String(raw ?? '').trim() ? undefined : 'A value is required.';
  const s = String(raw ?? '').trim();
  if (!s) return 'A value is required.';
  const n = Number(s);
  if (!Number.isFinite(n)) return 'Enter a number (digits only).';
  if (n < 0) return 'Negative values are not allowed.';
  if (d.integer && !Number.isInteger(n)) return 'Enter a whole number.';
  const shown = (v: number) => (d.type === 'percent' ? `${Math.round(v * 1000) / 10}%` : d.type === 'money' ? `₱${v.toLocaleString('en-PH')}` : `${v}${d.unit ? ` ${v === 1 ? d.unit.replace(/s$/, '') : d.unit}` : ''}`);
  if (d.min != null && n < d.min) return n === 0 ? `Zero is not allowed — minimum is ${shown(d.min)}.` : `Minimum is ${shown(d.min)}.`;
  if (d.max != null && n > d.max) return `Maximum is ${shown(d.max)}.`;
  return undefined;
}
