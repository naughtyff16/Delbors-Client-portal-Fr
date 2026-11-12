import { round2 } from '../format';

// BR-11: (Travel + Tire + Parts + Service Charge [10% of subtotal]) + 12% VAT on the resulting subtotal.
// Travel = one-way km × 2 × standard rate per km. Used by the UI preview and (later) the API — identical code.
export interface RescueChargeInput { oneWayKm: number; ratePerKm: number; tireCost: number; partsCost: number; serviceChargePct?: number; vatPct?: number }
export interface RescueCharge { travel: number; subtotal: number; service: number; taxable: number; vat: number; total: number }

export function computeRescueCharge(i: RescueChargeInput): RescueCharge {
  const servicePct = i.serviceChargePct ?? 0.1;
  const vatPct = i.vatPct ?? 0.12;
  const travel = round2(Math.max(0, i.oneWayKm) * 2 * Math.max(0, i.ratePerKm));
  const subtotal = round2(travel + Math.max(0, i.tireCost) + Math.max(0, i.partsCost));
  const service = round2(subtotal * servicePct);
  const taxable = round2(subtotal + service);
  const vat = round2(taxable * vatPct);
  return { travel, subtotal, service, taxable, vat, total: round2(taxable + vat) };
}

// DBL-RES-004: tire / part lines priced from the standard (regional) price list → tireCost / partsCost inputs for BR-11.
export interface RescueLineInput { kind: 'Tire' | 'Part'; qty: number; unitPrice: number }
export function rescueLineTotals(lines: RescueLineInput[]): { tireCost: number; partsCost: number } {
  const sum = (k: RescueLineInput['kind']) => round2(lines.filter((l) => l.kind === k).reduce((a, l) => a + Math.max(0, l.qty) * Math.max(0, l.unitPrice), 0));
  return { tireCost: sum('Tire'), partsCost: sum('Part') };
}

// DBL-RES-007 SLA tone: elapsed request → completion; thresholds come from settings (res.sla_amber_hours / res.sla_red_hours, proposed 2h / 4h).
export function rescueSlaTone(elapsedMin: number, amberHours = 2, redHours = 4): 'ok' | 'amber' | 'red' {
  return elapsedMin >= redHours * 60 ? 'red' : elapsedMin >= amberHours * 60 ? 'amber' : 'ok';
}

/**
 * Portal Rescue review (2026-11-11): the problem types a client can choose and which BR-11 cost lines each usually brings
 * (proposed — Operations to confirm). Travel (km × 2 × rate), the 10% service fee and 12% VAT apply to every rescue;
 * the type only tells the dispatcher what to bring — the charge is always from the actual tires and parts used.
 */
export const RESCUE_PROBLEM_TYPES = [
  { value: 'Flat / blown tire', pricing: 'Travel + tire (from the tire price list)', drives: 'Tires' },
  { value: 'Brake problem', pricing: 'Travel + brake parts (drum, lining)', drives: 'Parts' },
  { value: 'Mechanical breakdown', pricing: 'Travel + parts used on site', drives: 'Parts' },
  { value: 'Electrical / lights', pricing: 'Travel + electrical parts (lamps, wiring)', drives: 'Parts' },
  { value: 'Accident / collision', pricing: 'Travel + tires and parts assessed on site', drives: 'Tires and parts' },
  { value: 'Other', pricing: 'Travel + tires or parts assessed on site', drives: 'Assessed on site' },
] as const;
export const RESCUE_PROBLEM_OTHER = 'Other';

/**
 * Timeline 2 review: one rule for the unit while a rescue is open. From Requested until Completed / Cancelled the unit shows
 * "Under rescue" and Request return is blocked (it is returned after the rescue) — Requested and Dispatched alike (DW-MNL-1003 / DW-BTG-1025).
 * Proposed — Operations to confirm. crewOnTheWay tells the client a crew has been sent (Dispatched / In progress).
 */
export const RESCUE_OPEN_STATUSES = ['Requested', 'Verified', 'Confirmed', 'Dispatched', 'In Progress'] as const;
export function rescueUnitState(status?: string): { label: 'Under rescue'; blocksReturn: true; crewOnTheWay: boolean; detail: string } | undefined {
  if (!status || !(RESCUE_OPEN_STATUSES as readonly string[]).includes(status)) return undefined;
  const crewOnTheWay = status === 'Dispatched' || status === 'In Progress';
  const detail = status === 'Requested' ? 'request received, awaiting Delbros verification' : status === 'Verified' ? 'verified by Credit & Collection, awaiting confirmation'
    : status === 'Confirmed' ? 'confirmed, crew being assigned' : status === 'Dispatched' ? 'crew on the way' : 'crew working on the unit';
  return { label: 'Under rescue', blocksReturn: true, crewOnTheWay, detail };
}

/**
 * Timeline 2 review (UC-05 / DBL-CLT-005, "Allow for Rescue requires a funded e-wallet"): the e-wallet check before a rescue request,
 * from System setting res.funded_wallet_rule (proposed: an e-wallet must be open; a low or negative balance only warns — Finance to confirm).
 */
export type FundedWalletRule = 'wallet_exists' | 'positive' | 'minimum' | 'none';
export function rescueWalletGate(wallet: { balance: number; minimumBalance: number } | null | undefined, rule: string = 'wallet_exists'): { allowed: boolean; code?: 'WALLET'; reason?: string; warning?: string } {
  const r = (['wallet_exists', 'positive', 'minimum', 'none'].includes(rule) ? rule : 'wallet_exists') as FundedWalletRule;
  if (r === 'none') return { allowed: true };
  if (!wallet) return { allowed: false, code: 'WALLET', reason: 'Rescue needs a funded e-wallet, and your e-wallet is not open yet. It opens once Treasury confirms your first deposit — request a top-up or contact your Account Executive.' };
  if (r === 'positive' && wallet.balance <= 0) return { allowed: false, code: 'WALLET', reason: 'Rescue needs a funded e-wallet: your balance is ₱0 or below. Top up first, or call your Account Executive in an emergency.' };
  if (r === 'minimum' && wallet.balance < wallet.minimumBalance) return { allowed: false, code: 'WALLET', reason: 'Rescue needs your e-wallet at or above the contract minimum. Top up first, or call your Account Executive in an emergency.' };
  const warning = wallet.balance < 0 ? 'Your e-wallet is negative. The rescue is still accepted; its charge is deducted afterwards and adds to what you owe — please top up.'
    : wallet.balance < wallet.minimumBalance ? 'Your e-wallet is below the contract minimum. The rescue is still accepted; please top up so the charge is covered.' : undefined;
  return { allowed: true, warning };
}
