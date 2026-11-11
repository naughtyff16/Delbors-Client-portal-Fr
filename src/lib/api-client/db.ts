import type {
  Accreditation, AppNotification, Asset, AuditEvent, Branch, CashBond, Chassis, Client, CollectionCase, Contract, Eir,
  EquipmentType, Ewa, Ewallet, GateOverride, EwalletTxn, GatePass, HoldEvent, Invoice, JobOrder, LateEncoding, Memo, NotificationRule,
  ParkFixRecord, Part, PaymentRequest, PurchaseOrder, PurchaseRequest, Receipt, ReceivingReport, Registration, RescueRequest,
  SalesActivity, SettingDef, Warehouse, RateCardRow, MasterListItem, StockBalance, StockTxn, TopupRequest, User, Vendor, VendorInvoice, WorkflowInstance, Grants,
  UnitRequest, ClientFeedback, ReturnRequest,
} from '../shared';
import { buildSeed } from './seed';

// In-browser mock "database". Replaced by the real REST API (docs/07) — pages only talk to ./api.ts.
export interface Db {
  version: number;
  branches: Branch[]; equipmentTypes: EquipmentType[]; users: (User & { password: string; failed: number; lockedUntil?: string; overrides?: Grants })[];
  clients: Client[]; accreditations: Accreditation[]; contracts: Contract[]; cashBonds: CashBond[]; salesActivities: SalesActivity[];
  chassis: Chassis[]; assets: Asset[]; ewas: Ewa[]; gatePasses: GatePass[]; eirs: Eir[]; lateEncodings: LateEncoding[];
  jobOrders: JobOrder[]; rescues: RescueRequest[]; parts: Part[]; stock: StockBalance[]; stockTxns: StockTxn[];
  vendors: Vendor[]; prs: PurchaseRequest[]; pos: PurchaseOrder[]; rrs: ReceivingReport[]; vendorInvoices: VendorInvoice[]; paymentRequests: PaymentRequest[];
  invoices: Invoice[]; receipts: Receipt[]; memos: Memo[]; holdEvents: HoldEvent[]; collections: CollectionCase[];
  ewallets: Ewallet[]; ewalletTxns: EwalletTxn[]; topups: TopupRequest[]; registrations: Registration[];
  workflows: WorkflowInstance[]; notificationRules: NotificationRule[]; notifications: AppNotification[]; audit: AuditEvent[];
  settings: SettingDef[]; parkFix: ParkFixRecord[]; crossBranchCodes: { code: string; chassisNo: string; toBranch: string; used: boolean; expiresAt: string }[];
  unitRequests?: UnitRequest[];
  feedback?: ClientFeedback[]; // portal review 1.1 (optional so older saved DBs keep loading)
  seq: Record<string, number>;
  gateOverrides?: GateOverride[]; // DBL-CNC-001 (optional so persisted v4 DBs keep loading)
  warehouses?: Warehouse[]; rateCards?: RateCardRow[]; masterLists?: MasterListItem[]; // SUP-06 (optional; backfilled by api.admin)
  /** Portal sign-in review: password-reset links (token, expiry, single use). */
  passwordResets?: PasswordReset[];
  /** Portal sign-in review: "Request portal access" submissions (client or vendor) with their supporting documents. */
  accessRequests?: AccessRequest[];
  /** Portal dashboard review: client return requests for on-hire units. */
  returnRequests?: ReturnRequest[];
}

export interface PasswordReset { token: string; userId: string; createdAt: string; expiresAt: string; usedAt?: string }
export interface AccessRequest {
  reference: string; accountType: 'client' | 'vendor'; subjectId: string; companyName: string; tin: string; branchCode: string; address: string;
  contactName: string; email: string; phone: string; documents: string[]; submittedAt: string; status: 'Submitted' | 'Approved' | 'Rejected'; reviewer: string;
}

const KEY = 'delbros.mockdb.v4';
export const DB_VERSION = 16; // 2026-11-11: portal New EWA review — EWA email log, pickup time and remarks on EU-000781; reloads the mock DB once
// v15 (same day): 2026-11-11: portal dashboard review — FRS gate-pass numbers, a cross-branch return, client notifications; reloads the mock DB once
// v14 (same day): portal sign-in review — demo accounts for locked / inactive / not-accredited / Allow Online off / vendor states

function load(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Db;
      if (parsed.version === DB_VERSION) return parsed;
    }
  } catch { /* storage unavailable — fall back to fresh seed */ }
  return freshSeed();
}

// Stamp the current DB_VERSION so a saved DB is reused on the next load (seed.ts must not carry its own number).
const freshSeed = (): Db => ({ ...buildSeed(), version: DB_VERSION });

export const db: Db = load();

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore quota/private mode */ }
}

export function resetDb() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  Object.assign(db, freshSeed());
}

export function nextNo(docType: string, prefix: string, pad = 6) {
  db.seq[docType] = (db.seq[docType] ?? 0) + 1;
  return `${prefix}${String(db.seq[docType]).padStart(pad, '0')}`;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
