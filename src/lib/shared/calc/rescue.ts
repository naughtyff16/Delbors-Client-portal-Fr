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
