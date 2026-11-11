import { describe, expect, it } from 'vitest';
import { computeRescueCharge, rescueLineTotals, rescueSlaTone } from './rescue';
import { lateEncodingPath, cashBondRefundable, paymentRequestType, poApprovalTier, agingBucket, billableDays, periodDays, invoiceDates, allocateOldestFirst, memoApprovalChain, debitMemoTotal } from './billing';
import { holdLiftTier, creditGate, creditUtilisation, daysToAutoHold, nextCollectionStage, soaWindow } from './credit';
import { isContractExpired, rateVariancePct, ratesAboveTolerance, validateContractDuration } from './contract';
import { amountInWords } from '../format';

describe('BR-11 rescue charge', () => {
  it('matches the worked example in docs/05', () => {
    const c = computeRescueCharge({ oneWayKm: 25, ratePerKm: 50, tireCost: 8000, partsCost: 1500 });
    expect(c).toEqual({ travel: 2500, subtotal: 12000, service: 1200, taxable: 13200, vat: 1584, total: 14784 });
  });
  it('sums tire and part lines from the price list', () => {
    expect(rescueLineTotals([{ kind: 'Tire', qty: 2, unitPrice: 4000 }, { kind: 'Part', qty: 3, unitPrice: 500 }])).toEqual({ tireCost: 8000, partsCost: 1500 });
  });
  it('SLA tone at 2h amber / 4h red', () => {
    expect([60, 120, 239, 240].map((m) => rescueSlaTone(m, 2, 4))).toEqual(['ok', 'amber', 'amber', 'red']);
  });
});

describe('BR-05 late encoding', () => {
  it('auto-corrects within 7 days', () => {
    expect(lateEncodingPath('2026-09-01T02:00:00Z', '2026-09-06T02:00:00Z').path).toBe('AUTO');
  });
  it('requires a credit memo beyond 7 days', () => {
    expect(lateEncodingPath('2026-09-01T02:00:00Z', '2026-09-10T02:00:00Z')).toEqual({ daysLate: 9, path: 'CREDIT_MEMO' });
  });
});

describe('BR-03 hold-lift tiers', () => {
  it.each([[80000, 1], [300000, 2], [750000, 3], [1200000, 3]])('₱%i → tier %i', (amt, tier) => {
    expect(holdLiftTier(amt).tier).toBe(tier);
  });
});

describe('BR-01 credit gate', () => {
  const held = { status: 'Hold' as const, allowOnline: true, allowRescue: true, clientName: 'X' };
  it('blocks gate out on hold', () => expect(creditGate(held, 'GATE_OUT').allowed).toBe(false));
  it('never blocks gate in', () => expect(creditGate(held, 'GATE_IN').allowed).toBe(true));
  it('honours an approved, unexpired override (DBL-CNC-001)', () => {
    const now = new Date('2026-10-22T08:00:00Z');
    expect(creditGate(held, 'GATE_OUT', [{ action: 'GATE_OUT', validUntil: '2026-10-23T23:59:59Z', status: 'Approved' }], now).code).toBe('OVERRIDE');
    expect(creditGate(held, 'GATE_OUT', [{ action: 'GATE_OUT', validUntil: '2026-10-21T23:59:59Z', status: 'Approved' }], now).allowed).toBe(false);
    expect(creditGate(held, 'GATE_OUT', [{ action: 'GATE_OUT', validUntil: '2026-10-23T23:59:59Z', status: 'Pending' }], now).allowed).toBe(false);
  });
  it('collection ladder, utilisation and SOA window', () => {
    expect(nextCollectionStage('2nd Reminder')).toBe('Demand Letter');
    expect(nextCollectionStage('Demand Letter')).toBeNull();
    expect(creditUtilisation(102080, 1500000).pct).toBe(6.8);
    expect(soaWindow('2026-09-01T00:00:00Z', new Date('2026-10-22T00:00:00Z')).status).toBe('Window lapsed');
    expect(daysToAutoHold(25)).toBe(5);
  });
});

describe('BR-09/10/12/14', () => {
  it('PO tiers', () => {
    expect(poApprovalTier(180000).tier).toBe('APS/MMG Manager');
    expect(poApprovalTier(300000).tier).toBe('CEO + CHRO');
  });
  it('RFP vs PCV', () => {
    expect(paymentRequestType(3500)).toBe('PCV');
    expect(paymentRequestType(4000.01)).toBe('RFP');
  });
  it('QLP duration', () => {
    expect(validateContractDuration('QLP', '2026-01-01', '2026-08-01')).toMatch(/QLP/);
    expect(validateContractDuration('QLP', '2026-01-01', '2026-03-01')).toBeNull();
  });
  it('cash bond refund', () => expect(cashBondRefundable(20000, 5000, 1000, 0).refundable).toBe(14000));
});

describe('SCR-08 contract rules', () => {
  it('LTL ≥ 1 year, SPL open-ended', () => {
    expect(validateContractDuration('LTL', '2026-01-01', '2026-12-31')).toMatch(/1 year/);
    expect(validateContractDuration('LTL', '2026-01-01', '2027-01-01')).toBeNull();
    expect(validateContractDuration('SPL', '2026-01-01')).toBeNull();
    expect(validateContractDuration('QLP', '2026-01-01', '2026-01-05')).toMatch(/QLP/);
  });
  it('rate variance vs template and tolerance', () => {
    expect(rateVariancePct(990, 900)).toBe(10);
    const tpl = [{ equipmentType: 'EQ1', dailyRate: 900, indemnity: 1 }, { equipmentType: 'EQ2', dailyRate: 1000, indemnity: 1 }];
    expect(ratesAboveTolerance([{ ...tpl[0], dailyRate: 990 }, { ...tpl[1], dailyRate: 800 }], tpl, 10).map((r) => r.equipmentType)).toEqual(['EQ2']);
  });
  it('auto-expiry on the expiry date', () => {
    const today = new Date('2026-10-22T08:00:00');
    expect(isContractExpired({ status: 'Active', expiryDate: '2026-08-18' }, today)).toBe(true);
    expect(isContractExpired({ status: 'Active', expiryDate: '2026-10-22' }, today)).toBe(false);
    expect(isContractExpired({ status: 'Active' }, today)).toBe(false);
  });
});

describe('aging buckets (six production buckets)', () => {
  it.each([[0, 'current'], [30, 'd1_30'], [31, 'd31_60'], [90, 'd61_90'], [91, 'd91_180'], [180, 'd91_180'], [181, 'd180']])('%i days → %s', (days, key) => {
    expect(agingBucket(days)).toBe(key);
  });
});

describe('SCR-34 billable days (never exceed the period)', () => {
  const ps = '2026-10-02', pe = '2026-10-08';
  it('unit on hire before and through the period bills the 7 period days, not 8', () => {
    expect(billableDays('2026-08-30T01:00:00Z', undefined, ps, pe)).toBe(7);
    expect(billableDays('2026-09-26T09:30:00Z', undefined, ps, pe)).toBe(7);
  });
  it('is unaffected by a period end given as a local end-of-day timestamp', () => {
    expect(billableDays('2026-08-30T01:00:00Z', undefined, '2026-10-02T00:00:00+08:00', '2026-10-08T23:59:59+08:00')).toBe(7);
  });
  it('returned unit counts pickup-in-period through return day', () => {
    expect(billableDays('2026-09-20T02:00:00Z', '2026-10-08T03:00:00Z', ps, pe)).toBe(7);
    expect(billableDays('2026-10-04T02:00:00Z', '2026-10-06T03:00:00Z', ps, pe)).toBe(3);
  });
  it('outside the period bills nothing', () => {
    expect(billableDays('2026-09-01T02:00:00Z', '2026-09-30T03:00:00Z', ps, pe)).toBe(0);
  });
  it('period length and invoice / due dates', () => {
    expect(periodDays(ps, pe)).toBe(7);
    expect(invoiceDates('2026-09-16', 30)).toEqual({ invoiceDate: '2026-09-17', dueDate: '2026-10-17' });
  });
});

describe('SCR-36 / SCR-37 helpers', () => {
  it('allocates oldest first with an unapplied remainder', () => {
    const r = allocateOldestFirst(50000, [{ invoiceNo: 'B', dueDate: '2026-10-10', balance: 47040 }, { invoiceNo: 'A', dueDate: '2026-10-03', balance: 27040 }]);
    expect(r).toEqual({ applications: { A: 27040, B: 22960 }, unapplied: 0 });
    expect(allocateOldestFirst(30000, [{ invoiceNo: 'A', dueDate: '2026-10-03', balance: 27040 }]).unapplied).toBe(2960);
  });
  it('late-encoding credit memo needs DYM then Treasury; others Finance Manager', () => {
    expect(memoApprovalChain('Credit', 'Late-encoding correction').map((s) => s.label)).toEqual(['Deputy Yard Manager', 'Treasury']);
    expect(memoApprovalChain('Debit', 'Repair cost').map((s) => s.label)).toEqual(['Finance Manager']);
  });
  it('debit memo total', () => expect(debitMemoTotal({ labor: 1000, parts: 2500, travel: 500, service: 400, inputTax: 528 })).toBe(4928));
});

describe('amount in words', () => {
  it('formats pesos', () => expect(amountInWords(14784)).toBe('FOURTEEN THOUSAND SEVEN HUNDRED EIGHTY-FOUR PESOS AND 00/100'));
});
