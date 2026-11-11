// Domain types. Field names follow docs/04-data-model.md (legacy DelWater names kept where they exist).

export type Realm = 'INTERNAL' | 'CLIENT_PORTAL' | 'VENDOR_PORTAL';

export type ClientStatus = 'Active' | 'Draft' | 'Hold' | 'Blacklist' | 'Inactive';
export type AccreditationStatus = 'Draft' | 'Pending C&C' | 'Pending Finance' | 'Pending VP' | 'Approved' | 'Rejected';
export type ContractType = 'LTL' | 'SPL' | 'QLP';
export type ContractClass = 'A' | 'Z' | 'Q';
export type ContractStatus = 'Draft' | 'Printed' | 'Sent to Client' | 'Signed' | 'For Notarisation' | 'Notarized' | 'Active' | 'Expired' | 'Renewed' | 'Terminated';
export type ChassisStatus =
  | 'New' | 'Available' | 'Allocated' | 'On Hire' | 'Breakdown' | 'In Repair' | 'Rescue'
  | 'Parked' | 'Unaccounted' | 'Legal' | 'Converted' | 'Sold' | 'Killed';
export type Assessment = 'Roadworthy' | 'Unroadworthy';
export type EwaStatus = 'Active' | 'Used' | 'Partially Used' | 'Expired' | 'Extension Pending' | 'Cancelled';
export type JoStatus = 'Draft' | 'Approved' | 'Confirmed' | 'Ongoing' | 'On Hold' | 'Closed by R&M' | 'Closed by EIR Out';
export type RepairCategory = 'Tires' | 'Suspension' | 'Mechanical' | 'Electrical' | 'Brakes' | 'Painting';
export type RescueStatus = 'Requested' | 'Verified' | 'Confirmed' | 'Dispatched' | 'In Progress' | 'Completed' | 'Cancelled' | 'Blocked';
export type InvoiceStatus = 'Draft' | 'Finalized' | 'Sent' | 'Cancelled';
export type PaymentStatus = 'Unpaid' | 'Partially Paid' | 'Paid' | 'Overdue' | 'Credited' | 'Cancelled';
export type CollectionStage = 'None' | 'SOA Sent' | '1st Reminder' | '2nd Reminder' | 'Demand Letter';
export type RegistrationStatus = 'Current' | 'Registered' | 'Pending' | 'Expiring' | 'Renewal In Progress' | 'Expired';
export type ApprovalDecision = 'Pending' | 'Approved' | 'Rejected' | 'Escalated' | 'Skipped';
export type EwalletTxnType = 'Replenishment' | 'Deduction' | 'Adjustment' | 'Reversal';
export type StockTxnType = 'Request' | 'Issue' | 'Transfer' | 'Receive' | 'Adjustment' | 'Return';
export type PoStatus = 'Draft' | 'For Approval' | 'Approved' | 'Issued' | 'Partially Received' | 'Received' | 'On Hold' | 'Closed' | 'Cancelled';
export type PaymentRequestType = 'RFP' | 'PCV';

export interface Branch {
  code: string; name: string; region: string; gatePassPrefix: string; isHeadOffice: boolean;
  // SUP-06 master-data detail (optional so older records keep compiling)
  regionGroup?: 'Luzon' | 'Visayas' | 'Mindanao'; address?: string; manager?: string; phone?: string; partsMultiplier?: number; issuesGatePasses?: boolean; active?: boolean; inactiveReason?: string;
}
export interface EquipmentType {
  code: string; name: string; sort: number; placeholder?: boolean;
  lengthFt?: number; axles?: string[]; hubTypes?: string[]; tags?: string[]; active?: boolean; inactiveReason?: string;
}
/** SUP-06 Warehouse / stockroom master (used by Inventory and the user's default stockroom). */
export interface Warehouse { code: string; name: string; branchCode: string; custodian?: string; active: boolean; inactiveReason?: string }
/** SUP-06 effective-dated rate card row (BR-18: never overwritten — a change closes the old row and opens a new one). */
export interface RateCardRow { id: string; equipmentType: string; contractType: ContractType; contractClass: ContractClass; dailyRate: number; indemnity: number; validFrom: string; validTo?: string; createdBy: string; reason?: string }
/** SUP-06 simple reference list item (axle configs, hub types, tags, entities, departments, categories…). */
export interface MasterListItem { list: string; code: string; name: string; standard?: boolean; active: boolean; inactiveReason?: string }

export interface User {
  userId: string; name: string; designation: string; status: 'Active' | 'Inactive';
  branchCode: string; branchAccess: string[] | 'ALL'; warehouseCode?: string;
  email: string; mobile?: string; roles: RoleCode[]; realm: Realm;
  clientCode?: string; vendorId?: string; lastLogin?: string;
}

export type RoleCode =
  | 'SYS_ADMIN' | 'BRANCH_GENERALIST' | 'DYM' | 'REGIONAL_MANAGER' | 'OPS_MANAGER' | 'RESCUE_COORDINATOR'
  | 'ACCOUNT_EXECUTIVE' | 'SALES_DIRECTOR' | 'CNC_OFFICER' | 'CNC_MANAGER' | 'ACCOUNTING' | 'TREASURY'
  | 'FINANCE_MANAGER' | 'EXEC_OFFICER' | 'APS_OFFICER' | 'APS_MANAGER' | 'DEPT_HEAD' | 'REGULATORY'
  | 'VP' | 'CEO' | 'CHRO' | 'PRESIDENT' | 'EXECUTIVE' | 'WAREHOUSE' | 'CLIENT' | 'VENDOR';

export interface ContactPerson { id: string; firstName: string; lastName: string; phone: string; email: string; isPrimary?: boolean; isSignatory?: boolean }

export interface Client {
  clientCode: string; clientName: string; billingName: string; qbName?: string;
  address1: string; address2?: string; city?: string; zipCode?: string; country: string;
  phone?: string; fax?: string; website?: string; email?: string; ebillingEmail?: string;
  billingCycle: 'Weekly' | 'Monthly'; aeAssigned: string; branchCode: string; status: ClientStatus;
  allowLt: boolean; allowSt: boolean; allowOnline: boolean; allowSpecial: boolean; allowRescue: boolean;
  cwsBranchAccess: string[]; notes?: string; isLegal: boolean; isCollectionAgency: boolean;
  creditLimit?: number; registrationSource: 'Internal' | 'Portal'; contacts: ContactPerson[];
  createdAt: string;
  /** Printed on invoices / receipts (SCR-35 correction pass). */
  tin?: string; vatStatus?: 'VAT-registered' | 'Non-VAT' | 'Zero-rated';
}

export interface ApprovalStep {
  step: number; label: string; roles: RoleCode[]; decision: ApprovalDecision;
  decidedBy?: string; decidedAt?: string; comment?: string; dueAt?: string;
}

export interface WorkflowInstance {
  id: string; matrixCode: string; title: string; subjectType: string; subjectId: string;
  amount?: number; branchCode?: string; requestedBy: string; requestedAt: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'; steps: ApprovalStep[]; currentStep: number;
}

export interface Accreditation {
  id: string; clientCode: string; status: AccreditationStatus;
  bici: { yearsInOperation?: number; secReg?: string; tin?: string; tradeReferences?: string; bankReferences?: string; siteVisitNotes?: string; creditScore?: number; grade?: string; recommendedTermDays?: number; recommendedLimit?: number; result?: 'Recommend' | 'Do not recommend'; reasoning?: string };
  workflowId: string; submittedAt: string;
  /** SCR-07: supporting documents (FRS 447), form change log, activation set on VP sign-off (DBL-CLT-005). */
  documents?: { id: string; kind: string; fileName: string; at: string; by: string }[];
  log?: { at: string; by: string; action: string }[];
  activation?: { allowLt: boolean; allowSt: boolean; allowOnline: boolean; allowSpecial: boolean; allowRescue: boolean; cwsBranchAccess: string[]; creditLimit?: number; signOffDate?: string };
}

export interface ContractRate { equipmentType: string; dailyRate: number; indemnity: number; qty?: number; templateRate?: number }
export interface ContractEvent { status: string; at: string; by: string; note?: string; fileName?: string }
export interface Contract {
  contractNo: string; clientCode: string; contractType: ContractType; class: ContractClass;
  effectiveDate: string; expiryDate?: string; unitQty: number; region: string; signatoryId?: string;
  paymentMethod: string; billingCycle: 'Weekly' | 'Monthly'; creditTermDays: number; cashDeposit: number; lockInMonths: number;
  rates: ContractRate[];
  penalties: { nonReturn: number; deferredCheck: number; lateInterestPct: number; dishonoredCheck: number };
  status: ContractStatus; renewalOf?: string; createdAt: string;
  /** DBL-CLT-008/010 additions — optional so older records keep loading. */
  version?: number; createdBy?: string; aeUserId?: string; branchCode?: string; renewedTo?: string;
  customType?: { name: string; rateStructure: string };
  approval?: { workflowId: string; reason: string; status: 'Pending' | 'Approved' | 'Rejected'; kind: 'Custom type' | 'Rate variance' | 'Custom type + rate variance' };
  termination?: { workflowId: string; reason: string; status: 'Pending' | 'Approved' | 'Rejected'; effectiveDate: string };
  history?: ContractEvent[];
  documents?: { kind: 'Signed copy' | 'Notarized copy' | 'Amendment'; fileName: string; at: string; by: string }[];
  versions?: { version: number; at: string; by: string; reason: string }[];
  /**
   * Portal Contracts review (2026-11-11): entitlement is set for every equipment type (0 = not entitled, available on request);
   * earlier versions of the rates (BR-18); the minimum billing days if the contract sets them.
   */
  entitlementByType?: boolean;
  rateHistory?: { version: number; validFrom: string; validTo?: string; reason: string; rates: { equipmentType: string; dailyRate: number }[] }[];
  minBillingDays?: number;
}
/** Portal Contracts review: a renewal, amendment or termination request sent from the portal, with its status. */
export interface ContractRequest {
  id: string; clientCode: string; contractNo: string; kind: 'Renewal' | 'Amendment' | 'Termination';
  details: string; termMonths?: number; changeArea?: string; effectiveDate?: string; feeEstimate?: number;
  status: 'Submitted' | 'Under review' | 'Approved' | 'Declined' | 'Withdrawn'; submittedAt: string; submittedBy: string;
  decidedAt?: string; decidedBy?: string; decisionNote?: string;
}

export interface CashBond {
  id: string; clientCode: string; contractNo?: string; amount: number; dateReceived: string; receiptRef: string;
  status: 'Held' | 'Withdrawal Pending' | 'Refunded' | 'Applied';
  withdrawals: { id: string; amount: number; reason: string; refundable: number; workflowId: string; status: string; requestedAt: string; earlyException?: boolean; refund?: { method: string; date: string; reference: string; by: string } }[];
  paymentMethod?: string; receivedBy?: string; notes?: string; receiptFile?: string;
}

export interface Chassis {
  chassisNo: string; chassisType: string; plateNo?: string; branchCode: string; status: ChassisStatus;
  owner: string; ownerEquipmentNo?: string; generalAssessment: Assessment; standard: 'DW' | 'Nakamura';
  remarks?: string; acquisitionDate?: string; currentClientCode?: string; currentContractNo?: string;
  currentGatePassNo?: string; statusSince: string; allocation?: { clientCode: string; contractNo: string; date: string; expectedReturn?: string; targetPickupDate?: string; requestNo?: string };
  /** DCIR yard / repair category override (DBL-ALO-003); otherwise derived from status + open job orders. */
  yardCategory?: YardCategory;
  /** Master-record attributes (DBL-CHS-001) and classification tags (DBL-CHS-002). */
  axleConfig?: '2-axle' | '3-axle'; hubType?: 'Spoke' | '8-hole' | '10-hole'; tags?: string[];
}
export type YardCategory = 'TQS' | 'Roadworthy' | 'Minor Repair' | 'Major Repair';
/** Client unit request — allocation-tracking pipeline (DBL-ALO-002). */
export interface UnitRequest {
  reqNo: string; clientCode: string; contractNo: string; branchCode: string; equipmentType: string; qty: number; targetPickupDate: string;
  requiredParts?: string; notes?: string; allocated: string[]; status: 'Open' | 'Partially Allocated' | 'Allocated' | 'Cancelled'; createdAt: string; createdBy: string;
}

export interface Asset {
  assetId: string; category: 'Heavy Equipment' | 'Forklift' | 'Welding Machine' | 'Depot Tool' | 'Stockroom Tool';
  description: string; branchCode: string; location?: string; status: 'Available' | 'In-Use' | 'Under Repair' | 'Retired' | 'Disposed';
  assignedTo?: string; acquisitionDate?: string; lastMaintenanceDate?: string; nextPmDate?: string; notes?: string;
  /** DBL-CHS-006/010/011 — quantity for depot/stockroom tools, identity, condition, PM interval, QR tag, lifecycle. */
  qty?: number; uom?: string; serialNo?: string; make?: string; model?: string; condition?: 'Good' | 'Fair' | 'Poor' | 'Unserviceable';
  pmIntervalDays?: number; qrCode?: string;
  maintenanceLog?: { date: string; type: 'Preventive' | 'Corrective' | 'Inspection'; notes: string; joNo?: string; by: string }[];
  disposal?: { action: 'Retire' | 'Dispose'; reason: string; workflowId: string; status: 'Pending Approval' | 'Approved' | 'Rejected'; requestedAt: string };
}

export interface EwaUnit { equipmentType: string; qty: number; usedChassis: string[] }
export interface Ewa {
  euNo: string; clientCode: string; contractNo: string; branchCode: string; driverName: string; driverLicenseNo: string;
  truckPlateNo: string; trucker: string; units: EwaUnit[]; createdAt: string; validUntil: string;
  createdVia: 'Portal' | 'Internal'; status: EwaStatus; extensionCount: number; createdBy: string;
  /** DBL-GAT-003: inbound-leg credentials updated by the Branch Generalist (pre-fill Gate In). */
  inbound?: EwaCredentials; updatedAt?: string; updatedBy?: string;
  cancelledAt?: string; cancelledBy?: string; cancelReason?: string;
  /**
   * Portal New EWA review (2026-11-11): truck OR/CR entered by the client (optional — the yard still verifies the original at Gate Out),
   * expected pickup time and remarks, and the delivery log of the full-detail EWA email (GAT-002, notification N08).
   */
  truckOrcr?: string; expectedPickupAt?: string; remarks?: string; delivery?: EwaDelivery[];
  /** Portal EWA list review (2026-11-11): every extension request with its decision and the valid-until change (GAT-003, BR-06). */
  extensions?: EwaExtension[];
}
export interface EwaExtension {
  requestedAt: string; requestedBy: string; reason: string; workflowId?: string; status: 'Pending' | 'Approved' | 'Rejected';
  decidedAt?: string; decidedBy?: string; validUntilBefore: string; validUntilAfter?: string;
}
export interface EwaDelivery { at: string; channel: 'Email' | 'SMS' | 'In-app'; audience: 'Client' | 'Delbros'; recipient: string; to: string; status: 'Sent' | 'Queued' | 'Failed'; resend?: boolean }
export interface EwaCredentials { trucker: string; driverName: string; driverLicenseNo: string; truckPlateNo: string }

export interface InspectionLine { part: string; branding?: string; threadDepth?: string; statusCode: string; qty: number; chargeable: number }
export interface GatePass {
  gatePassNo: string; direction: 'OUT' | 'IN'; chassisNo: string; clientCode: string; contractNo: string; euNo?: string;
  trucker: string; truckPlateNo: string; truckOrcr?: string; driverName: string; driverLicenseNo: string;
  generalAssessment: Assessment; inspection: InspectionLine[]; flatTires?: number; vandalized?: boolean;
  signature?: string; actualEventAt: string; encodedAt: string; branchCode: string; originBranchCode?: string;
  crossBranchCode?: string; isForceInbound?: boolean; eirNo: string; pairedGatePassNo?: string; encodedBy: string;
  /** DBL-GAT-005/006 condition notes + damage photo file names; credentialMismatch = fields that differed from the EWA at release. */
  remarks?: string; photos?: string[]; credentialMismatch?: string[];
}
export interface EirReprint { no: number; at: string; by: string; reason: string; copy: 'OUT' | 'IN' }

export interface Eir {
  eirNo: string; gatePassOutNo: string; gatePassInNo?: string; clientCode: string; chassisNo: string; chassisType: string;
  eirOutDate: string; eirInDate?: string; depotCode: string; bookingNo?: string; contractNo: string; reprintCount: number;
  reprints?: EirReprint[];
}

export interface LateEncoding {
  id: string; gatePassNo: string; originalDate: string; correctedDate: string; daysLate: number; reason: string;
  path: 'AUTO' | 'CREDIT_MEMO'; workflowId?: string; status: 'Posted' | 'Pending Approval' | 'Approved' | 'Rejected'; createdAt: string; createdBy: string;
  memoNo?: string; attachment?: string;
}

export interface JobOrder {
  joNo: string; chassisNo: string; branchCode: string; source: 'Gate In' | 'Rescue' | 'Spot Repair' | 'Scheduled'; sourceRef?: string;
  categories: RepairCategory[]; notes: string; workers: string[]; status: JoStatus; isMajor: boolean; chargeable: boolean;
  spotDriver?: { name: string; license: string; truckPlate: string };
  bom: BomLine[]; labor: { worker: string; hours: number; rate: number; date: string; shift: LaborShift }[];
  createdAt: string; createdBy: string; approvedBy?: string; confirmedBy?: string; closedAt?: string;
}
export interface BomLine { partCode: string; description: string; qty: number; unitCost: number }
// DBL-RM-007 shift split (windows pending Q-RM-02); legacy 'Day' / 'Night' entries read as Morning / Evening.
export type LaborShift = 'Morning' | 'Afternoon' | 'Evening' | 'Day' | 'Night';

export interface RescueRequest {
  rescueNo: string; clientCode: string; chassisNo: string; locationText: string; lat?: number; lng?: number;
  incident: string; sceneContactName: string; sceneContactPhone: string; urgent: boolean; status: RescueStatus;
  requestedAt: string; requestedVia: 'Portal' | 'Internal'; branchCode: string;
  verifiedBy?: string; confirmedBy?: string; crew?: string; dispatchedAt?: string; eta?: string; completedAt?: string;
  chargeable: boolean; oneWayKm?: number; ratePerKm?: number; tireCost?: number; partsCost?: number;
  total?: number; debitMemoNo?: string; blockedReason?: string; acknowledgedAt?: string;
  loadStatus?: 'Loaded' | 'Empty'; photos?: string[]; // US-RES-001 load status + supporting photos at request time
  // DBL-RES-002/005/006/008 (correction pass): eligibility, urgent ack, dispatch log, cost lines, billing evidence, cancel.
  blockedAt?: string; notEligibleBy?: string;
  urgentAckBy?: string; urgentAckAt?: string;
  rescueVehicle?: string; driverName?: string; driverPhone?: string;
  onsiteAssessment?: string; costLines?: RescueCostLine[]; beforePhotos?: string[]; afterPhotos?: string[];
  clientAckName?: string; completedBy?: string; ewalletBalanceAfter?: number;
  cancelReason?: string; cancelledBy?: string; cancelledAt?: string;
  /** Portal review 1.1: problem type chosen by the client (flat tire, brake, mechanical, accident, other) — helps the dispatcher plan crew and parts. */
  problemType?: string;
  /** Portal Rescue review (2026-11-11): free text when the problem type is Other; each status change with its time; who was notified on submission. */
  problemDetail?: string; statusLog?: { status: string; at: string; by?: string }[]; notified?: EwaDelivery[];
}
/** Portal review 1.1 (DBL-CLT-017): client feedback and contract requests (renewal / amendment / termination) sent to the Account Executive. */
export interface ClientFeedback {
  id: string; clientCode: string; category: string; subject: string; message: string; reference?: string;
  submittedAt: string; submittedBy: string; status: 'Submitted' | 'Acknowledged' | 'Closed';
  /** Portal dashboard review (2026-11-11): 1–5 star rating and the service it is about (optional — plain feedback has neither). */
  rating?: number; topic?: string;
}
/**
 * Portal dashboard review (2026-11-11): the client asks Delbros to collect an on-hire unit (proposed — Q-PTL-03:
 * whether clients may request returns online). The branch arranges the Gate In; a return at another branch still
 * needs the IT-issued cross-branch approval code at the gate (BR-16).
 */
export interface ReturnRequest {
  requestNo: string; clientCode: string; chassisNo: string; contractNo?: string; originBranchCode: string; returnBranchCode: string;
  preferredDate: string; notes?: string; status: 'Requested' | 'Scheduled' | 'Completed' | 'Cancelled';
  requestedAt: string; requestedBy: string;
}
export interface RescueCostLine { kind: 'Tire' | 'Part'; partCode: string; description: string; qty: number; unitPrice: number }

export interface Part {
  partCode: string; description: string; uom: string; category: string; standardCost: number; rescuePrice?: number; lowStockThreshold: number;
  // SUP-06 master-data detail (DBL-INV-001/006, DBL-PRC-005/010)
  weightKg?: number; regionalPrices?: Record<string, number>; preferredVendorId?: string; movementClass?: 'Fast' | 'Slow' | 'Non-moving'; scrapFlag?: boolean; reorderQty?: number; active?: boolean; inactiveReason?: string;
  priceHistory?: { validFrom: string; validTo?: string; vendorId?: string; unitCost: number; source: string }[];
}
export interface StockBalance {
  partCode: string; warehouseCode: string; qtyOnHand: number; lastPhysicalCount?: number; lastCountDate?: string; pendingPo?: string;
  /** Owning entity (DBL-PRC-009) and the pre-audit count submission awaiting approval (DBL-INV-004/007). */
  entityCode?: string;
  pendingCount?: { counted: number; auditType: 'Monthly cycle count' | 'Annual audit'; reason?: string; photoName?: string; submittedBy: string; submittedAt: string; workflowId: string };
}
export interface StockTxn {
  id: string; txnNo: string; type: StockTxnType; partCode: string; qty: number; fromWarehouse?: string; toWarehouse?: string; referenceType?: string; referenceId?: string; reason?: string; balanceAfter: number; entityCode: string; at: string; by: string;
  /** SCR-28 ledger detail (DBL-INV-001/003/005/007). Missing status = Posted. */
  status?: 'Posted' | 'Pending Approval' | 'Rejected' | 'Open'; source?: 'Manual' | 'Auto — PO' | 'Auto — Job Order' | 'Auto — Count'; workflowId?: string;
  joNo?: string; equipmentRef?: string; approvalRef?: string; poNo?: string; orderedQty?: number; requestingBranch?: string; department?: string; requestedBy?: string; damagedQty?: number; remarks?: string;
}

export interface Vendor {
  vendorId: string; name: string; tin: string; address: string; email: string; paymentTerms: string; status: 'Active' | 'Inactive' | 'Pending' | 'Blocked';
  // SUP-06 master-data detail (DBL-PRC-001/002/009/011)
  contactPerson?: string; phone?: string; vatStatus?: 'VAT-registered' | 'Non-VAT'; bankName?: string; bankAccount?: string; paymentMethod?: 'Check' | 'Bank transfer' | 'Cash';
  category?: string; entityCodes?: string[]; portalAccess?: boolean; portalUserId?: string; statusReason?: string;
}
export interface PoLine { partCode: string; description: string; qty: number; unitPrice: number; qtyReceived: number }
export interface PurchaseRequest {
  prNo: string; department: string; requestedBy: string; justification: string; entityCode: string; sourceJo?: string;
  lines: { partCode: string; description: string; qty: number; estUnitCost: number; uom?: string; standardCost?: number; priceOverride?: boolean; supplierId?: string }[]; status: 'Draft' | 'For Approval' | 'Approved' | 'Converted' | 'Rejected';
  workflowId?: string; createdAt: string; poNo?: string;
  supplierId?: string; neededBy?: string; priority?: 'Normal' | 'Urgent' | 'Critical'; deliveryWarehouse?: string; stockRef?: string; attachments?: string[];
}
export interface PurchaseOrder { poNo: string; prNo: string; vendorId: string; terms: string; deliveryDate: string; lines: PoLine[]; status: PoStatus; workflowId?: string; entityCode: string; createdAt: string }
export interface ReceivingReport { rrNo: string; poNo: string; receivedDate: string; receivedBy: string; warehouseCode: string; lines: { partCode: string; qtyReceived: number; qtyRejected: number; condition: string }[]; conditionNotes?: string; discrepancy: boolean }
export interface VendorInvoice { id: string; vendorId: string; invoiceNo: string; invoiceDate: string; amount: number; poNo: string; rrNo?: string; fileName?: string; status: 'Submitted' | 'Under Review' | 'Approved' | 'Paid' | 'Rejected'; submittedVia: 'Portal' | 'Internal'; submittedAt: string }
export interface PaymentRequest { docNo: string; type: PaymentRequestType; referenceType: 'PO' | 'RR' | 'Justification'; referenceId: string; payee: string; amount: number; dueDate: string; entityCode: string; status: 'Draft' | 'For Approval' | 'Approved' | 'Paid' | 'Rejected'; workflowId?: string; createdAt: string; justification?: string;
  department?: string; requestedBy?: string; fundingSource?: string; attachments?: string[];
  /** Particulars; for an RFP against POs each line may be allocated to a PO line (many-to-many, DBL-PRC-001). */
  lines?: { description: string; category: string; amount: number; poNo?: string; partCode?: string }[] }

export interface InvoiceLine {
  id: string; lineType: 'Lease' | 'Rescue' | 'Repair' | 'Park & Fix' | 'Penalty' | 'Adjustment' | 'Damage' | 'GPS' | 'Special'; description: string; chassisNo?: string; from?: string; to?: string; days?: number; rate?: number; amount: number; held?: boolean;
  // SCR-34/35 correction pass (DBL-FIN-002/003/004, BR-05): equipment, rate type, late-encoding markers, correction / adjustment audit.
  equipmentType?: string; rateType?: string; lateDays?: number; recalculated?: boolean; heldMemoNo?: string;
  adjType?: string; reason?: string; evidence?: string; by?: string; at?: string; originalDays?: number; originalRate?: number;
}
export interface InvoiceEvent { at: string; by: string; action: string; note?: string }
export interface Invoice {
  invoiceNo: string; clientCode: string; contractNo?: string; periodStart: string; periodEnd: string; billType: string;
  lines: InvoiceLine[]; subtotal: number; vat: number; total: number; amountPaid: number; dueDate: string;
  status: InvoiceStatus; issuedAt: string; heldReason?: string; branchCode: string;
  // SCR-35 correction pass: header fields, delivery, history, reprint log.
  batchNo?: string; invoiceDate?: string; billingCycle?: string; creditTermDays?: number; sentTo?: string; sentAt?: string;
  history?: InvoiceEvent[]; printCount?: number; credited?: number; cancelReason?: string;
}
export type ReceiptStatus = 'Provisional' | 'Cleared' | 'OR Issued' | 'Bounced' | 'Cancelled';
export interface Receipt {
  receiptNo: string; type: 'OR' | 'PR' | 'NVAR'; clientCode: string; date: string; amount: number; method: string; reference?: string; applications: { invoiceNo: string; amount: number }[]; unapplied: number; by: string;
  // SCR-36 correction pass (DBL-FIN-012/013/015): PR → Treasury clearance → OR, check / PDC detail, cancel / bounce.
  status?: ReceiptStatus; orNo?: string; prNo?: string; checkNo?: string; bank?: string; checkDate?: string; pdc?: boolean; depositStatus?: 'Not deposited' | 'Deposited' | 'Cleared' | 'Returned';
  clearedAt?: string; clearedBy?: string; tin?: string; notes?: string; createdAt?: string; cancelReason?: string; cancelledBy?: string; penaltyMemoNo?: string; history?: InvoiceEvent[];
}
export interface MemoBreakdown { labor: number; parts: number; travel: number; service: number; inputTax: number }
export interface Memo {
  memoNo: string; type: 'Credit' | 'Debit'; clientCode: string; referenceInvoiceNo?: string; referenceType: string; referenceId?: string; amount: number; reason: string;
  status: 'Draft' | 'Pending Approval' | 'Approved' | 'Posted' | 'Rejected' | 'Applied'; workflowId?: string; createdAt: string;
  // SCR-37 correction pass (DBL-FIN-011, DBL-FIN-003, DBL-RES-006): category, evidence, DM cost breakdown, links, source, approval chain.
  category?: string; evidence?: string[]; breakdown?: MemoBreakdown; joNo?: string; rescueNo?: string; source?: 'Auto' | 'Manual'; createdBy?: string;
  approvalChain?: string[]; appliedTo?: string; balanceAfter?: number; appliedAt?: string;
}

export interface HoldEvent { id: string; clientCode: string; type: 'Auto Hold' | 'Manual Hold' | 'Reactivated' | 'Re-Hold'; at: string; by: string; outstanding: number; daysOverdue?: number; invoiceNo?: string; reason?: string; effectiveDate?: string; approvedBy?: string; workflowId?: string }
export interface SoaSend { id: string; soaNo: string; at: string; by: string; channel: 'Email' | 'Courier'; to: string; trackingNo?: string }
export interface CollectionCase { clientCode: string; stage: CollectionStage; stageChangedAt?: string; nextActionDue?: string; actions: { at: string; action: string; by: string; notes?: string; letter?: string }[]; soaSends?: SoaSend[]; acknowledgedAt?: string; pendingWorkflowId?: string }
// DBL-CNC-001 authorised override of one blocked gate, time-boxed.
export interface GateOverride { id: string; clientCode: string; action: string; reason: string; validUntil: string; requestedBy: string; requestedAt: string; workflowId: string; status: 'Pending' | 'Approved' | 'Rejected'; approvedBy?: string; approvedAt?: string }

export interface Ewallet {
  clientCode: string; balance: number; minimumBalance: number; createdAt: string;
  // DBL-EWL-001 initial funding evidence (Treasury-cleared receipt)
  createdBy?: string; receiptNo?: string; clearedDate?: string; paymentMethod?: string; bankRef?: string; treasuryRef?: string; treasuryConfirmedBy?: string; treasuryConfirmedAt?: string;
}
// DBL-EWL-003 deduction scope + top-up / reversal / adjustment categories
export type EwalletCategory = 'Top-up' | 'Rescue' | 'Repair' | 'Debit Memo' | 'Contract-termination lease' | 'Reversal' | 'Adjustment';
export interface EwalletTxn { id: string; clientCode: string; at: string; type: EwalletTxnType; amount: number; balanceAfter: number; referenceType: string; referenceId?: string; reason?: string; by: string; category?: EwalletCategory; receiptNo?: string; treasuryRef?: string; reversesId?: string; reversedById?: string; workflowId?: string }
export interface TopupRequest { id: string; clientCode: string; amount: number; proofFileName?: string; status: 'Submitted' | 'Confirmed by Treasury' | 'Posted' | 'Rejected'; submittedAt: string; bankRef?: string; paymentRef?: string;
  receiptNo?: string; confirmedBy?: string; confirmedAt?: string; postedBy?: string; postedAt?: string; txnId?: string; rejectedBy?: string; rejectedAt?: string; rejectReason?: string;
  /** Portal top-up review (2026-11-11): what Treasury needs to match the transfer, the resubmission link and who was told. */
  transferDate?: string; method?: string; sendingBank?: string; remarks?: string; resubmitOf?: string; notified?: EwaDelivery[] }
/**
 * Portal invoice review (2026-11-11, proposed — Delbros to confirm scope): the client tells Accounting it has paid an invoice
 * (proof of payment), or disputes an invoice. Neither changes the balance — Accounting verifies and records the receipt or memo.
 */
export interface PaymentAdvice {
  id: string; clientCode: string; invoiceNo: string; amount: number; paidOn: string; method: string; bank?: string; reference: string; proofFileName: string;
  remarks?: string; status: 'Submitted' | 'Verified' | 'Rejected'; submittedAt: string; submittedBy: string; receiptNo?: string; rejectReason?: string;
}
export interface InvoiceDispute {
  id: string; clientCode: string; invoiceNo: string; reason: string; details: string; amountDisputed?: number; attachment?: string;
  status: 'Submitted' | 'Under review' | 'Resolved' | 'Rejected'; submittedAt: string; submittedBy: string; resolution?: string;
}

export interface Registration {
  id: string; subjectType: 'Chassis' | 'Trailer' | 'Vehicle' | 'Asset' | 'Motorcycle' | 'Prime Mover'; subjectId: string; plateNo: string; orNo: string; crNo: string;
  issueDate: string; expiryDate: string; agency: string; region: string; renewalInProgress: boolean; documents: string[];
  lastNotifiedStage?: '90' | '30' | '14';
  /** Non-chassis units carry their own branch; chassis take it from the chassis master. */
  branchCode?: string; description?: string; pending?: boolean;
  notices?: { at: string; stage: '90' | '30' | '14' | 'expired' | 'manual'; recipients: string }[];
  responsible?: string; followUp?: string; followUpDate?: string; renewalCost?: number; escalatedAt?: string; escalatedTo?: string;
}

export interface NotificationRule {
  id: string; eventType: string; description: string; recipientRoles: RoleCode[]; namedRecipients: string[]; includeClient: boolean; includeAe: boolean;
  channels: ('Email' | 'SMS' | 'In-App')[]; mode: 'One-time' | 'Repeat until ack'; repeatMinutes?: number; escalationHours?: number; active: boolean; source: string;
  /** SCR-44: who receives the escalation when escalationHours lapses without action/ack. */
  escalateTo?: RoleCode[];
  /** SCR-44: message template ({{placeholders}} resolved at send time) and optional send condition. */
  template?: { subject: string; body: string; sms?: string };
  condition?: string;
  pending?: string;
}
export interface AppNotification { id: string; at: string; title: string; body: string; link?: string; read: boolean; requiresAck: boolean; ackAt?: string; userId: string }
export interface AuditEvent {
  id: string; at: string; actor: string; action: string; entityType: string; entityId: string; branchCode?: string; before?: unknown; after?: unknown; reason?: string;
  /** NFR-AUD-001: channel / device the action came from, and the hash chain (tamper evidence). */
  source?: string; actorRole?: string; prevHash?: string; hash?: string;
}
export interface ParkFixRecord { id: string; chassisNo: string; clientCode: string; branchCode: string; parkInAt: string; reason: 'Idle' | 'Awaiting Repair' | 'Client Request'; parkOutAt?: string; dailyRate: number; status: 'Parked' | 'Released';
  // Gate-receipt pattern + billing feed (DBL-ALO-005)
  clientOwned?: boolean; chassisType?: string; plateNo?: string; service?: 'Park only' | 'Park & Repair'; joNo?: string; expectedParkOut?: string;
  rateOverrideReason?: string; inReceiptNo?: string; outReceiptNo?: string; reprintCount?: number;
  parkIn?: ParkFixGate; parkOut?: ParkFixGate; billingStatus?: 'Unbilled' | 'Billed'; debitMemoNo?: string; billedAmount?: number;
}
export interface ParkFixGate { trucker: string; truckPlateNo: string; driverName: string; driverLicenseNo: string; inspection: InspectionLine[]; signature?: string; remarks?: string; by?: string }
export interface SalesActivity {
  id: string; aeUserId: string; clientCode?: string; type: 'Visit' | 'Call' | 'Email' | 'Meeting' | 'Tracker update'; date: string; notes?: string;
  // DBL-CLT-014 fields (correction pass) — optional so older records keep loading.
  at?: string; loggedAt?: string; loggedBy?: string; businessType?: string; location?: string; outcome?: string; outcomeDetails?: string;
  prospectCompany?: string; prospectContact?: string; nextActionDate?: string;
}
