import { daysBetween, round2 } from '../format';

// BR-05 late encoding path.
export function lateEncodingPath(actualIso: string, encodedIso: string, autoDays = 7) {
  const daysLate = Math.max(0, daysBetween(actualIso, encodedIso));
  return { daysLate, path: daysLate <= autoDays ? ('AUTO' as const) : ('CREDIT_MEMO' as const) };
}

/** Manila calendar-day index. A bare 'YYYY-MM-DD' is taken as that calendar day (never shifted by the browser time zone). */
export function manilaDayIndex(iso: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; }
  return daysBetween('1970-01-01T00:00:00+08:00', iso);
}

/**
 * Billable days for an on-hire interval clipped to the billing period, counted on Manila calendar days.
 * Rule (proposed default, Q-FIN-02): pickup day and return day both count; a unit still on hire counts to the period end.
 * The result never exceeds the number of days in the period (02–08 Oct = 7).
 */
export function billableDays(outIso: string, inIso: string | undefined, periodStartIso: string, periodEndIso: string) {
  const ps = manilaDayIndex(periodStartIso), pe = manilaDayIndex(periodEndIso);
  const start = Math.max(manilaDayIndex(outIso), ps);
  const end = inIso ? Math.min(manilaDayIndex(inIso), pe) : pe;
  if (end < start) return 0;
  return Math.min(end - start + 1, pe - ps + 1);
}

/** Days in a billing period, inclusive of both ends. */
export const periodDays = (periodStartIso: string, periodEndIso: string) => manilaDayIndex(periodEndIso) - manilaDayIndex(periodStartIso) + 1;

/** Invoice date = day after the period end; due date = invoice date + contract credit term (SCR-35). */
export function invoiceDates(periodEnd: string, creditTermDays: number) {
  const base = manilaDayIndex(periodEnd);
  const iso = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
  return { invoiceDate: iso(base + 1), dueDate: iso(base + 1 + creditTermDays) };
}

/** Allocate a payment to open invoices, oldest due first (DBL-CNC-008). */
export function allocateOldestFirst(amount: number, open: { invoiceNo: string; dueDate: string; balance: number }[]) {
  let left = round2(amount);
  const out: Record<string, number> = {};
  for (const i of [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    const x = round2(Math.min(left, i.balance));
    if (x > 0) { out[i.invoiceNo] = x; left = round2(left - x); }
  }
  return { applications: out, unapplied: left };
}

// DBL-FIN-011 memo categories and approval chain (DBL-FIN-003 / BR-05 for late encoding).
export const CREDIT_MEMO_CATEGORIES = ['Late-encoding correction', 'Withholding-tax adjustment', 'E-wallet offsetting', 'No-rescue service dispute', 'Billing correction', 'Other'] as const;
export const DEBIT_MEMO_CATEGORIES = ['Rescue billing', 'Repair cost', 'Dishonoured check penalty', 'Other charges'] as const;
export function memoApprovalChain(type: 'Credit' | 'Debit', category?: string) {
  if (type === 'Credit' && category === 'Late-encoding correction') return [{ label: 'Deputy Yard Manager', roles: ['DYM'] as const }, { label: 'Treasury', roles: ['TREASURY'] as const }];
  return [{ label: 'Finance Manager', roles: ['FINANCE_MANAGER'] as const }];
}
/** DM cost breakdown total (labor + parts + travel + service + input tax). */
export const debitMemoTotal = (b: { labor: number; parts: number; travel: number; service: number; inputTax: number }) => round2((b.labor || 0) + (b.parts || 0) + (b.travel || 0) + (b.service || 0) + (b.inputTax || 0));

export function invoiceTotals(lineAmounts: number[], vatPct = 0.12) {
  const subtotal = round2(lineAmounts.reduce((a, b) => a + b, 0));
  const vat = round2(subtotal * vatPct);
  return { subtotal, vat, total: round2(subtotal + vat) };
}

// BR-14 cash bond refund.
export function cashBondRefundable(bond: number, unpaidInvoices: number, negativeWallet: number, openDebitMemos: number) {
  const deductions = round2(unpaidInvoices + Math.max(0, negativeWallet) + openDebitMemos);
  return { deductions, refundable: round2(Math.max(0, bond - deductions)), shortfall: round2(Math.max(0, deductions - bond)) };
}

// BR-10 RFP vs PCV.
export const paymentRequestType = (amount: number, pcvMax = 4000) => (amount > pcvMax ? 'RFP' : 'PCV') as 'RFP' | 'PCV';

// BR-09 PO final approval tier.
export const poApprovalTier = (total: number, threshold = 250000) =>
  total <= threshold ? { tier: 'APS/MMG Manager', roles: ['APS_MANAGER'] as const } : { tier: 'CEO + CHRO', roles: ['CEO', 'CHRO'] as const };

// Six production aging buckets (Screen Inventory): Current, 1–30, 31–60, 61–90, 91–180, Over 180.
export interface AgingBuckets { current: number; d1_30: number; d31_60: number; d61_90: number; d91_180: number; d180: number; total: number }
export const AGING_BUCKETS = [
  { key: 'current', label: 'Current' }, { key: 'd1_30', label: '1–30' }, { key: 'd31_60', label: '31–60' },
  { key: 'd61_90', label: '61–90' }, { key: 'd91_180', label: '91–180' }, { key: 'd180', label: 'Over 180' },
] as const;
export const emptyAging = (): AgingBuckets => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91_180: 0, d180: 0, total: 0 });
export function agingBucket(daysOverdue: number): keyof Omit<AgingBuckets, 'total'> {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  if (daysOverdue <= 180) return 'd91_180';
  return 'd180';
}
