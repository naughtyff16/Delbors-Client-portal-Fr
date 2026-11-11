import type { ContractClass, ContractRate, ContractStatus, ContractType } from '../types';

// BR-12: contract types carry fixed classes and durations.
export const CONTRACT_TYPES: Record<ContractType, { name: string; class: ContractClass; rule: string }> = {
  LTL: { name: 'Long-Term Lease', class: 'A', rule: '≥ 1 year' },
  SPL: { name: 'Spot List', class: 'Z', rule: 'Open-ended' },
  QLP: { name: 'Quick Lease Program', class: 'Q', rule: '10 days to 6 months' },
};

/** DBL-CLT-010 lifecycle, in order. Expired / Renewed / Terminated are terminal states after Active. */
export const CONTRACT_LIFECYCLE: ContractStatus[] = ['Draft', 'Sent to Client', 'Signed', 'For Notarisation', 'Notarized', 'Active'];
export const CONTRACT_TERMINAL: ContractStatus[] = ['Expired', 'Renewed', 'Terminated'];

/** Legacy 'Printed' records map onto 'Sent to Client' in the stepper. */
export function lifecycleIndex(status: ContractStatus): number {
  if (status === 'Printed') return 1;
  if (CONTRACT_TERMINAL.includes(status)) return CONTRACT_LIFECYCLE.length;
  return CONTRACT_LIFECYCLE.indexOf(status);
}

export function validateContractDuration(type: ContractType, effective: string, expiry?: string): string | null {
  if (type === 'SPL') return null;
  if (!effective || !expiry) return 'Expiry date is required for this contract type.';
  const a = new Date(effective), b = new Date(expiry);
  if (b <= a) return 'Expiry date must be after the effective date.';
  if (type === 'LTL') {
    const oneYear = new Date(a); oneYear.setFullYear(oneYear.getFullYear() + 1);
    if (b < oneYear) return 'LTL (Class A) contracts must run at least 1 year.';
  }
  if (type === 'QLP') {
    const days = (b.getTime() - a.getTime()) / 86_400_000;
    const sixMonths = new Date(a); sixMonths.setMonth(sixMonths.getMonth() + 6);
    if (days < 10 || b > sixMonths) return 'QLP duration must be between 10 days and 6 months.';
  }
  return null;
}

/** Signed % change of a daily rate against the class template rate (0 when no template). */
export function rateVariancePct(rate: number, template?: number): number {
  if (!template) return 0;
  return Math.round(((rate - template) / template) * 10000) / 100;
}

/** Rate lines whose variance vs template exceeds the tolerance (absolute %) — these need approval. */
export function ratesAboveTolerance(rates: ContractRate[], template: ContractRate[], tolerancePct: number) {
  return rates.filter((r) => {
    const t = template.find((x) => x.equipmentType === r.equipmentType)?.dailyRate ?? r.templateRate;
    return Math.abs(rateVariancePct(r.dailyRate, t)) > tolerancePct;
  });
}

/** An Active contract whose expiry date is before today is Expired (DBL-CLT-010). SPL (no expiry) never expires. */
export function isContractExpired(c: { status: ContractStatus; expiryDate?: string }, today = new Date()): boolean {
  if (c.status !== 'Active' || !c.expiryDate) return false;
  return new Date(c.expiryDate + 'T23:59:59') < today;
}

/** Days until expiry (negative when past). Undefined for open-ended contracts. */
export function daysToExpiry(expiryDate?: string, today = new Date()): number | undefined {
  if (!expiryDate) return undefined;
  return Math.ceil((new Date(expiryDate + 'T23:59:59').getTime() - today.getTime()) / 86_400_000);
}
