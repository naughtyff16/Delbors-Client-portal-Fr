import type { Client, CollectionStage, RoleCode } from '../types';

// BR-01: the single enforcement point for "can this client transact?" (docs/01 §4.1 CreditGateService).
export type GateAction = 'EWA_CREATE' | 'GATE_OUT' | 'GATE_IN' | 'JO_CREATE_SPOT' | 'RESCUE_DISPATCH' | 'PARK_IN' | 'CONTRACT_ACTIVATE' | 'SERVICE_CREATE' | 'PORTAL_EWA' | 'RESCUE_REQUEST';
export interface GateResult { allowed: boolean; code?: string; reason?: string; overrideUntil?: string }

const BLOCKING = new Set(['Hold', 'Blacklist', 'Inactive', 'Draft']);

/** DBL-CNC-001: an approved, unexpired override lets one blocked gate through until `validUntil`. */
export function creditGate(client: Pick<Client, 'status' | 'allowOnline' | 'allowRescue' | 'clientName'> | undefined, action: GateAction, overrides: { action: string; validUntil: string; status?: string }[] = [], now = new Date()): GateResult {
  if (!client) return { allowed: false, code: 'CLIENT_NOT_FOUND', reason: 'Client record not found.' };
  if (action === 'GATE_IN') return { allowed: true }; // returns are never blocked by a hold (Blacklist included — pending Q-CNC-05)
  if (BLOCKING.has(client.status)) {
    const ov = overrides.find((o) => o.action === action && (o.status ?? 'Approved') === 'Approved' && new Date(o.validUntil) >= now);
    if (ov) return { allowed: true, code: 'OVERRIDE', overrideUntil: ov.validUntil, reason: `Authorised override until ${ov.validUntil.slice(0, 10)} (DBL-CNC-001).` };
    const why = client.status === 'Hold' ? 'is ON HOLD for overdue balance' : client.status === 'Draft' ? 'is not yet accredited (Draft)' : client.status === 'Blacklist' ? 'is BLACKLISTED' : 'is INACTIVE';
    return { allowed: false, code: 'CREDIT_GATE_BLOCKED', reason: `${client.clientName} ${why}. Chassis release, gate pass, repair scheduling and new services are blocked (BR-01).` };
  }
  if (action === 'PORTAL_EWA' && !client.allowOnline) return { allowed: false, code: 'ELIGIBILITY', reason: 'Online EWA is not enabled for this client (Allow Online = off).' };
  if ((action === 'RESCUE_DISPATCH' || action === 'RESCUE_REQUEST') && !client.allowRescue) return { allowed: false, code: 'ELIGIBILITY', reason: 'Rescue service is not enabled for this client (Allow Rescue = off).' };
  return { allowed: true };
}

// BR-03 tiered reactivation approval. Gap (₱500k–₱1M) handled per cnc.gap_policy (default: Tier 3).
export function holdLiftTier(outstanding: number, t1 = 100000, t2 = 500000) {
  if (outstanding <= t1) return { tier: 1, label: 'Tier 1 — Officer 1', roles: ['CNC_OFFICER'] as RoleCode[] };
  if (outstanding <= t2) return { tier: 2, label: 'Tier 2 — Officer 1 + Finance Manager', roles: ['CNC_OFFICER', 'FINANCE_MANAGER'] as RoleCode[] };
  return { tier: 3, label: 'Tier 3 — Officers 1, 2 and 3', roles: ['CNC_OFFICER', 'EXEC_OFFICER', 'EXEC_OFFICER'] as RoleCode[] };
}

// DBL-CNC-003 / BR-02: days left before an invoice trips the automatic hold (negative = already past).
export const daysToAutoHold = (daysOverdue: number, threshold = 30) => threshold - daysOverdue;

// DBL-CNC-001: credit-limit utilisation = exposure ÷ limit (exposure = AR + on-hire estimate, definition pending Q-CNC-01).
export function creditUtilisation(exposure: number, limit?: number) {
  if (!limit) return { pct: null as number | null, tone: 'default' as const };
  const pct = Math.round((exposure / limit) * 1000) / 10;
  return { pct, tone: pct > 100 ? ('danger' as const) : pct >= 80 ? ('warning' as const) : ('success' as const) };
}

// DBL-CNC-006 collection ladder: SOA → 1st reminder → 2nd reminder → demand letter.
export const COLLECTION_LADDER: CollectionStage[] = ['None', 'SOA Sent', '1st Reminder', '2nd Reminder', 'Demand Letter'];
export const nextCollectionStage = (s: CollectionStage): CollectionStage | null => COLLECTION_LADDER[COLLECTION_LADDER.indexOf(s) + 1] ?? null;

// DBL-CNC-005: 30-day window measured from the client's SOA acknowledgment.
export function soaWindow(acknowledgedAt: string | undefined, now = new Date(), days = 30) {
  if (!acknowledgedAt) return { status: 'Awaiting acknowledgment' as const, day: null as number | null, daysLeft: null as number | null };
  const day = Math.floor((now.getTime() - new Date(acknowledgedAt).getTime()) / 86400000);
  return day > days ? { status: 'Window lapsed' as const, day, daysLeft: days - day } : { status: 'Within window' as const, day, daysLeft: days - day };
}
