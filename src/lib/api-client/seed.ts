// DEMO DATA ONLY. Branch names, equipment types, clients, vendors and amounts below are placeholders for
// development and UI review — they are NOT Delbros master data. Equipment types in particular are not named
// in the BRD or design brief (Q-CLT-01) and must be replaced from the DelWater Online extract.
import {
  DEFAULT_SETTINGS, addDays, addHours, formatDate, formatPhp, manilaDay,
  type Branch, type Chassis, type Client, type Contract, type EquipmentType, type Invoice, type NotificationRule,
  type Registration, type RoleCode, type User, type WorkflowInstance, type ChassisStatus, type Part, type EwaDelivery,
} from '../shared';
import type { Db } from './db';

const now = () => new Date().toISOString();
const ago = (d: number) => addDays(now(), -d);
const ahead = (d: number) => addDays(now(), d);

export function buildSeed(): Db {
  const branches: Branch[] = [
    // Gate pass numbers follow the FRS format (GEN0001 / CEB0001): branch prefix + 4 digits (gat.gatepass_seq_digits, Q-GAT-07). Portal dashboard review 2026-11-11.
    { code: 'HO', name: 'Head Office', region: 'NCR', gatePassPrefix: 'HO', isHeadOffice: true },
    ...[
      ['MNL', 'Manila Yard', 'NCR'], ['NVL', 'Navotas Depot', 'NCR'], ['CAV', 'Cavite Depot', 'South Luzon'], ['LAG', 'Laguna Depot', 'South Luzon'],
      ['BTG', 'Batangas Depot', 'South Luzon'], ['SUB', 'Subic Depot', 'North Luzon'], ['CLK', 'Clark Depot', 'North Luzon'],
      ['CEB', 'Cebu Depot', 'Visayas'], ['CDO', 'Cagayan de Oro Depot', 'Mindanao'], ['DVO', 'Davao Depot', 'Mindanao'],
    ].map(([code, name, region]) => ({ code, name: `${name}`, region, gatePassPrefix: code, isHeadOffice: false })),
  ];
  const opsBranches = branches.filter((b) => !b.isHeadOffice).map((b) => b.code);

  // Q-CLT-01: the seven chassis types of DBL-CHS-001 plus 20ft flatbed (20FBED) from the legacy master database (28-May-2026).
  // Codes stay EQ1–EQ8 so existing records keep their references; Admin → Equipment types can rename or add more.
  const equipmentTypes: EquipmentType[] = [
    '20ft chassis', '40ft chassis', '40ft flatbed', '40ft combo', '40ft super combo', '45ft chassis', 'Cane cage trailer', '20ft flatbed',
  ].map((name, i) => ({ code: `EQ${i + 1}`, name, sort: i + 1 }));

  const mk = (userId: string, name: string, designation: string, roles: RoleCode[], branchCode = 'HO', extra: Partial<User> = {}) => ({
    userId, name, designation, roles, branchCode, status: 'Active' as const, realm: 'INTERNAL' as const,
    branchAccess: (branchCode === 'HO' ? 'ALL' : [branchCode]) as string[] | 'ALL', email: `${userId.toLowerCase()}@demo.delbros.local`,
    mobile: '+63 917 000 0000', password: 'Demo@2026', failed: 0, ...extra,
  });
  const users: Db['users'] = [
    mk('ADMIN', 'System Administrator', 'IT Administrator', ['SYS_ADMIN']),
    mk('BG.MNL', 'Rocky Santos', 'Branch Generalist', ['BRANCH_GENERALIST'], 'MNL', { warehouseCode: 'WH-MNL' }),
    mk('BG.CEB', 'Ana Villanueva', 'Branch Generalist', ['BRANCH_GENERALIST'], 'CEB', { warehouseCode: 'WH-CEB' }),
    mk('DYM.MNL', 'Carlos Mendoza', 'Deputy Yard Manager', ['DYM'], 'MNL'),
    mk('RM.NCR', 'Liza Gomez', 'Regional Manager', ['REGIONAL_MANAGER'], 'HO'),
    mk('OPSMGR', 'Paolo Reyes', 'Operations Manager', ['OPS_MANAGER', 'RESCUE_COORDINATOR']),
    mk('AE.JREYES', 'Jasmine Reyes', 'Account Executive', ['ACCOUNT_EXECUTIVE']),
    mk('SALESDIR', 'Mark Tan', 'Sales Director', ['SALES_DIRECTOR']),
    mk('CNC.OFF1', 'Grace Lim', 'C&C Officer (Officer 1)', ['CNC_OFFICER']),
    mk('CNC.MGR', 'Ramon Cruz', 'C&C Manager', ['CNC_MANAGER']),
    mk('ACCTG', 'Joy Bautista', 'Billing Specialist', ['ACCOUNTING']),
    mk('TREAS', 'Ben Aquino', 'Treasury Officer', ['TREASURY']),
    mk('FINMGR', 'Carmen Dizon', 'Finance Manager', ['FINANCE_MANAGER']),
    mk('EXEC.OFF2', 'Victor Ramos', 'Executive Approver (Officer 2)', ['EXEC_OFFICER']),
    mk('EXEC.OFF3', 'Helen Yu', 'Executive Approver (Officer 3)', ['EXEC_OFFICER']),
    mk('APS', 'Ross Ann Plaza', 'Asset & Procurement Head', ['APS_OFFICER', 'APS_MANAGER']),
    mk('APS.OFF', 'Dennis Co', 'APS Officer', ['APS_OFFICER']),
    mk('DEPTHEAD', 'Nora Castillo', 'Department Head', ['DEPT_HEAD']),
    mk('REG', 'Miguel Torres', 'Regulatory Specialist', ['REGULATORY']),
    mk('VP', 'Antonio Lopez', 'Vice President', ['VP']),
    mk('CEO', 'Chief Executive', 'CEO', ['CEO', 'EXECUTIVE']),
    mk('CHRO', 'Chief HR Officer', 'CHRO', ['CHRO']),
    mk('PRES', 'President', 'President', ['PRESIDENT', 'EXECUTIVE']),
    mk('WH.MNL', 'Eddie Garcia', 'Stockroom Custodian', ['WAREHOUSE'], 'MNL', { warehouseCode: 'WH-MNL' }),
    { ...mk('client@abclogistics.ph', 'Maria Santos', 'Client — ABC Logistics', ['CLIENT']), realm: 'CLIENT_PORTAL', clientCode: 'C-00123', branchAccess: [] },
    { ...mk('client@pacificmovers.ph', 'Leo Navarro', 'Client — Pacific Movers', ['CLIENT']), realm: 'CLIENT_PORTAL', clientCode: 'C-00188', branchAccess: [] },
    { ...mk('tess@islandlink.ph', 'Tess Uy', 'Client — Islandlink Cargo', ['CLIENT']), realm: 'CLIENT_PORTAL', clientCode: 'C-00251', branchAccess: [], status: 'Inactive' as const }, // portal self-registration awaiting AE approval (DBL-CLT-019)
    { ...mk('vendor@tirepro.ph', 'Tire Pro Supply', 'Vendor', ['VENDOR']), realm: 'VENDOR_PORTAL', vendorId: 'V-001', branchAccess: [] },
    // Portal sign-in review (2026-11-11): one demo account per sign-in state. Email is the sign-in ID for every portal user.
    { ...mk('ops@southernhaulers.ph', 'Joel Ramos', 'Client — Southern Haulers', ['CLIENT']), realm: 'CLIENT_PORTAL', clientCode: 'C-00215', branchAccess: [] }, // Allow Online = No → signs in, EWA blocked
    { ...mk('rico@northstar.ph', 'Rico Dela Paz', 'Client — Northstar Trucking', ['CLIENT']), realm: 'CLIENT_PORTAL', clientCode: 'C-00244', branchAccess: [] }, // company still in accreditation → not accredited
    { ...mk('dispatch@visayasfreight.ph', 'Ana Lopez', 'Client — Visayas Freight', ['CLIENT']), realm: 'CLIENT_PORTAL', clientCode: 'C-00201', branchAccess: [], failed: 5, lockedUntil: addDays(now(), 30) }, // locked after 5 failed attempts
    { ...mk('j.cruz@abclogistics.ph', 'Jun Cruz', 'Client — ABC Logistics (left the company)', ['CLIENT']), realm: 'CLIENT_PORTAL', clientCode: 'C-00123', branchAccess: [], status: 'Inactive' as const }, // deactivated portal user
    { ...mk('sales@luzonbrake.ph', 'Luzon Brake & Axle Trading', 'Vendor', ['VENDOR']), realm: 'VENDOR_PORTAL', vendorId: 'V-005', branchAccess: [] }, // vendor accreditation pending
    { ...mk('orders@metropaint.ph', 'Metro Paint Supply', 'Vendor', ['VENDOR']), realm: 'VENDOR_PORTAL', vendorId: 'V-004', branchAccess: [] }, // vendor deactivated by APS
    { ...mk('finance@baysidehaulage.ph', 'Carla Mendoza', 'Client — Bayside Haulage', ['CLIENT']), realm: 'CLIENT_PORTAL', clientCode: 'C-00262', branchAccess: [] }, // contract ended, cash bond refundable
  ];

  // Portal users sign in with their email: the user ID and the email are the same address (one email = one company).
  for (const u of users) if (u.realm !== 'INTERNAL') u.email = u.userId;

  const contact = (id: string, f: string, l: string) => ({ id, firstName: f, lastName: l, phone: '+63 917 555 0101', email: `${f.toLowerCase()}@example.ph`, isPrimary: true, isSignatory: true });
  const client = (c: Partial<Client> & Pick<Client, 'clientCode' | 'clientName' | 'status'>): Client => ({
    billingName: c.clientName, address1: 'Port Area', city: 'Manila', country: 'PHILIPPINES', billingCycle: 'Weekly', aeAssigned: 'AE.JREYES',
    branchCode: 'MNL', allowLt: true, allowSt: true, allowOnline: true, allowSpecial: false, allowRescue: true, cwsBranchAccess: ['MNL', 'NVL', 'CAV'],
    isLegal: false, isCollectionAgency: false, registrationSource: 'Internal', contacts: [contact(c.clientCode + '-1', 'Maria', 'Santos')],
    email: 'accounts@example.ph', ebillingEmail: 'billing@example.ph', phone: '(02) 8123 4567', creditLimit: 1500000, createdAt: ago(400), ...c,
  });
  const clients: Client[] = [
    // Portal Contracts review: branches covered = the branches enabled for the account (CWS access), which now include the
    // Batangas, Clark and Cagayan de Oro branches its units were released from (amendment request CRQ-000001, approved).
    client({ clientCode: 'C-00123', clientName: 'ABC Logistics Inc.', status: 'Active', qbName: 'ABC LOGISTICS', tin: '201-555-123-000', cwsBranchAccess: ['MNL', 'NVL', 'CAV', 'BTG', 'CLK', 'CDO'] }),
    client({ clientCode: 'C-00188', clientName: 'Pacific Movers Corp.', status: 'Hold', billingCycle: 'Monthly', contacts: [contact('C-00188-1', 'Leo', 'Navarro')] }),
    client({ clientCode: 'C-00201', clientName: 'Visayas Freight Services', status: 'Active', branchCode: 'CEB', cwsBranchAccess: ['CEB'], contacts: [contact('C-00201-1', 'Ana', 'Lopez')] }),
    client({ clientCode: 'C-00215', clientName: 'Southern Haulers Co.', status: 'Active', branchCode: 'BTG', allowRescue: false, allowOnline: false, billingCycle: 'Monthly' }), // Allow Online = No (portal sign-in review)
    client({ clientCode: 'C-00230', clientName: 'Metro Container Lines', status: 'Active', allowSpecial: true }),
    client({ clientCode: 'C-00244', clientName: 'Northstar Trucking', status: 'Draft', createdAt: ago(16), contacts: [contact('C-00244-1', 'Rico', 'Dela Paz')] }),
    client({ clientCode: 'C-00251', clientName: 'Islandlink Cargo', status: 'Draft', registrationSource: 'Portal', createdAt: ago(1), contacts: [contact('C-00251-1', 'Tess', 'Uy')] }),
    client({ clientCode: 'C-00099', clientName: 'Defunct Transport Ltd.', status: 'Blacklist', isLegal: true }),
    // Portal E-wallet review: contract ended, everything paid — its cash bond can be withdrawn (BR-14).
    client({ clientCode: 'C-00262', clientName: 'Bayside Haulage Corp.', status: 'Active', branchCode: 'NVL', cwsBranchAccess: ['NVL', 'MNL'], tin: '262-118-447-000', createdAt: ago(380), contacts: [contact('C-00262-1', 'Carla', 'Mendoza')] }),
  ];

  const rates = (base: number) => equipmentTypes.map((e, i) => ({ equipmentType: e.code, dailyRate: base + i * 50, indemnity: 350000 + i * 25000 }));
  const contract = (no: string, clientCode: string, type: Contract['contractType'], cls: Contract['class'], months: number | undefined, base: number, status: Contract['status'] = 'Active'): Contract => ({
    contractNo: no, clientCode, contractType: type, class: cls, effectiveDate: manilaDay(ago(200)), expiryDate: months ? manilaDay(addDays(ago(200), months * 30)) : undefined,
    unitQty: 10, region: 'NCR', paymentMethod: 'Check', billingCycle: 'Weekly', creditTermDays: 30, cashDeposit: 20000, lockInMonths: type === 'LTL' ? 12 : 0,
    penalties: { nonReturn: 5000, deferredCheck: 1000, lateInterestPct: 2, dishonoredCheck: 2500 }, status, createdAt: ago(210),
    // SCR-08 lifecycle trail (DBL-CLT-010) — date + user per step.
    signatoryId: `${clientCode}-1`, version: 1, createdBy: 'AE.JREYES', aeUserId: 'AE.JREYES',
    history: ([['Draft', 210, 'AE.JREYES'], ['Sent to Client', 208, 'AE.JREYES'], ['Signed', 205, 'AE.JREYES'], ['For Notarisation', 204, 'AE.JREYES'], ['Notarized', 202, 'AE.JREYES'], ['Active', 200, 'AE.JREYES']] as const)
      .map(([s, d, by]) => ({ status: s, at: ago(d), by, fileName: s === 'Signed' ? `${no}-signed.pdf` : s === 'Notarized' ? `${no}-notarized.pdf` : undefined })),
    documents: [{ kind: 'Signed copy', fileName: `${no}-signed.pdf`, at: ago(205), by: 'AE.JREYES' }, { kind: 'Notarized copy', fileName: `${no}-notarized.pdf`, at: ago(202), by: 'AE.JREYES' }],
    rates: rates(base).map((r, i) => ({ ...r, qty: i < 2 ? 5 : 0, templateRate: r.dailyRate })),
  });
  const contracts: Contract[] = [
    contract('LTL-2026-0045', 'C-00123', 'LTL', 'A', 13, 900),
    contract('SPL-2026-0012', 'C-00188', 'SPL', 'Z', undefined, 1100),
    contract('LTL-2026-0051', 'C-00201', 'LTL', 'A', 24, 850),
    contract('QLP-2026-0007', 'C-00215', 'QLP', 'Q', 5, 1200),
    contract('LTL-2026-0060', 'C-00230', 'LTL', 'A', 8, 950),
    contract('QLP-2026-0003', 'C-00262', 'QLP', 'Q', 5, 1200, 'Expired'),
    // Portal Contracts review: ABC's earlier contracts, so the list shows the Expired and Terminated states.
    contract('QLP-2025-0019', 'C-00123', 'QLP', 'Q', 6, 1200, 'Expired'),
    contract('SPL-2025-0007', 'C-00123', 'SPL', 'Z', undefined, 1100, 'Terminated'),
  ];
  {
    // LTL-2026-0045: entitlement for every type (sums to the 10 contracted units and covers every unit on hire); version 2 re-rated the
    // 20ft flatbed to the 2026 LTL rate card (BR-18 — the earlier rate is kept in the rate history).
    const abc = contracts.find((c) => c.contractNo === 'LTL-2026-0045')!;
    const qty: Record<string, number> = { EQ1: 3, EQ2: 2, EQ3: 2, EQ4: 0, EQ5: 2, EQ6: 1, EQ7: 0, EQ8: 0 };
    abc.entitlementByType = true;
    abc.rates = abc.rates.map((r) => ({ ...r, qty: qty[r.equipmentType] ?? 0 }));
    const v2At = ago(90);
    abc.rateHistory = [
      { version: 1, validFrom: abc.effectiveDate, validTo: manilaDay(addDays(v2At, -1)), reason: 'Rates at signing',
        rates: abc.rates.map((r) => ({ equipmentType: r.equipmentType, dailyRate: r.equipmentType === 'EQ8' ? 1150 : r.dailyRate })) },
      { version: 2, validFrom: manilaDay(v2At), reason: '20ft flatbed re-rated to the 2026 LTL rate card (specialised flatbed deck), approved by the Sales Director',
        rates: abc.rates.map((r) => ({ equipmentType: r.equipmentType, dailyRate: r.dailyRate })) },
    ];
    abc.version = 2;
    abc.versions = [{ version: 2, at: v2At, by: 'AE.JREYES', reason: '20ft flatbed rate aligned to the 2026 LTL rate card' }];
    abc.history?.push({ status: 'Amended → v2', at: v2At, by: 'AE.JREYES', note: '20ft flatbed ₱1,150 → ₱1,250 per day (2026 LTL rate card)' });
    // Earlier contracts: one ran to its end, one was ended early when ABC moved to the long-term lease.
    const q = contracts.find((c) => c.contractNo === 'QLP-2025-0019')!;
    Object.assign(q, { effectiveDate: manilaDay(ago(420)), expiryDate: manilaDay(ago(241)), unitQty: 4, createdAt: ago(425), signatoryId: 'C-00123-1',
      rates: q.rates.map((r, i) => ({ ...r, qty: i < 2 ? 2 : 0 })), entitlementByType: true,
      history: [{ status: 'Active', at: ago(420), by: 'AE.JREYES' }, { status: 'Expired', at: ago(240), by: 'system', note: 'End date reached' }],
      documents: [{ kind: 'Signed copy', fileName: 'QLP-2025-0019-signed.pdf', at: ago(423), by: 'AE.JREYES' }] });
    const t = contracts.find((c) => c.contractNo === 'SPL-2025-0007')!;
    Object.assign(t, { effectiveDate: manilaDay(ago(560)), unitQty: 3, createdAt: ago(565), lockInMonths: 0,
      termination: { workflowId: 'WF-CTT-1', reason: 'Moved all units to the long-term lease LTL-2026-0045', status: 'Approved', effectiveDate: manilaDay(ago(201)) },
      history: [{ status: 'Active', at: ago(560), by: 'AE.JREYES' }, { status: 'Termination requested', at: ago(215), by: 'AE.JREYES', note: 'Client moving to LTL-2026-0045' }, { status: 'Terminated', at: ago(201), by: 'SALESDIR', note: 'Approved — no pre-termination fee (no lock-in)' }],
      documents: [{ kind: 'Signed copy', fileName: 'SPL-2025-0007-signed.pdf', at: ago(562), by: 'AE.JREYES' }] });
  }

  // Chassis fleet — ~70/30 company vs partner ownership (BR-13).
  const statuses: ChassisStatus[] = ['Available', 'Available', 'On Hire', 'On Hire', 'On Hire', 'Allocated', 'Breakdown', 'In Repair', 'Available', 'On Hire'];
  const chassis: Chassis[] = [];
  let n = 1000;
  opsBranches.forEach((b, bi) => {
    for (let i = 0; i < 6; i++) {
      const eq = equipmentTypes[(bi + i) % 8];
      const st = statuses[(bi * 3 + i) % statuses.length];
      chassis.push({
        chassisNo: `DW-${b}-${++n}`, chassisType: eq.code, plateNo: `${b.slice(0, 2)}${String.fromCharCode(65 + i)} ${1000 + n}`, branchCode: b, status: st,
        owner: (bi + i) % 10 < 7 ? 'DELWATER' : 'PARTNER-01', generalAssessment: st === 'Breakdown' ? 'Unroadworthy' : 'Roadworthy', standard: i % 3 ? 'DW' : 'Nakamura',
        statusSince: ago(3 + ((bi + i) * 7) % 45), acquisitionDate: ago(900 + i * 30).slice(0, 10),
      });
    }
  });
  // Attach on-hire units to clients.
  const onHire = chassis.filter((c) => c.status === 'On Hire');
  const hireClients = ['C-00123', 'C-00188', 'C-00201', 'C-00230', 'C-00215'];
  const hireContracts: Record<string, string> = { 'C-00123': 'LTL-2026-0045', 'C-00188': 'SPL-2026-0012', 'C-00201': 'LTL-2026-0051', 'C-00230': 'LTL-2026-0060', 'C-00215': 'QLP-2026-0007' };
  // Demo driver signature (as captured on the gate tablet) so printed EIRs show the signature image.
  const DEMO_SIGNATURE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="60" viewBox="0 0 220 60"><path d="M8 42c14-26 22-30 26-18s-4 22 6 10 16-28 22-14-6 20 8 8 14-18 24-8 4 12 16 4 18-16 30-6 10 10 22 2 16-8 30-4" fill="none" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round"/></svg>')}`;
  const gatePasses: Db['gatePasses'] = [];
  const crossBranch: Db['crossBranchCodes'] = [];
  const eirs: Db['eirs'] = [];
  const histEwas: Db['ewas'] = []; // gate (SCR-15/17 review): every seeded release carries the EWA it left under
  // Review 1.1: different drivers per release (not one driver on every row).
  const DRIVERS = [['Juan Dela Cruz', 'N01-23-456789'], ['Mario Reyes', 'N02-15-334455'], ['Ramil Santos', 'N04-18-998877'], ['Arnel Bautista', 'N03-20-112233']] as const;
  const checklist = (damaged: Record<string, number> = {}) => ['Tire L1 outer', 'Tire L1 inner', 'Tire R1 outer', 'Tire R1 inner', 'Tire L2 outer', 'Tire L2 inner', 'Tire R2 outer', 'Tire R2 inner', 'Brake system', 'Landing legs', 'King pin', 'Twist locks', 'Lights & wiring', 'Mud flaps', 'Chassis frame']
    .map((part) => ({ part, statusCode: damaged[part] != null ? 'DMG' : 'OK', qty: 1, chargeable: damaged[part] ?? 0 }));
  onHire.forEach((c, i) => {
    const cl = hireClients[i % hireClients.length];
    const gp = `${c.branchCode}${String(900 + i).padStart(4, '0')}`; // FRS gate-pass format, e.g. MNL0900
    const eir = `EIR-${c.branchCode}-${String(200 + i).padStart(6, '0')}`;
    const euNo = `EU-TMP-${i}`; // renumbered by creation date below
    const [driverName, driverLicenseNo] = DRIVERS[i % DRIVERS.length];
    c.currentClientCode = cl; c.currentContractNo = hireContracts[cl]; c.currentGatePassNo = gp;
    histEwas.push({ euNo, clientCode: cl, contractNo: hireContracts[cl], branchCode: c.branchCode, driverName, driverLicenseNo, truckPlateNo: `NAB ${5600 + i}`, trucker: 'XYZ Trucking',
      units: [{ equipmentType: c.chassisType, qty: 1, usedChassis: [c.chassisNo] }], createdAt: addHours(c.statusSince, -2), validUntil: addHours(c.statusSince, 22), createdVia: 'Internal', status: 'Used', extensionCount: 0, createdBy: 'AE.JREYES' });
    gatePasses.push({
      gatePassNo: gp, direction: 'OUT', chassisNo: c.chassisNo, clientCode: cl, contractNo: hireContracts[cl], trucker: 'XYZ Trucking', truckPlateNo: `NAB ${5600 + i}`, truckOrcr: `OR ${4100200 + i} / CR ${5200300 + i}`, euNo,
      driverName, driverLicenseNo, generalAssessment: 'Roadworthy', actualEventAt: c.statusSince, encodedAt: c.statusSince, signature: DEMO_SIGNATURE,
      // Seeded releases carry the standard GP2 checklist (all OK) so EIR reprints show the recorded condition.
      inspection: checklist(),
      branchCode: c.branchCode, eirNo: eir, encodedBy: 'BG.MNL',
    });
    eirs.push({ eirNo: eir, gatePassOutNo: gp, clientCode: cl, chassisNo: c.chassisNo, chassisType: c.chassisType, eirOutDate: c.statusSince, depotCode: c.branchCode, contractNo: hireContracts[cl], reprintCount: 0 });
  });
  // Review 1.1 (DBL-CLT-017 equipment return history): one ABC unit hired out and returned (Gate Out → Gate In), now Available again.
  {
    const ret = chassis.find((c) => c.branchCode === 'MNL' && c.status === 'Available');
    if (ret) {
      const outAt = ago(75), inAt = ago(35), base = { chassisNo: ret.chassisNo, clientCode: 'C-00123', contractNo: 'LTL-2026-0045', trucker: 'XYZ Trucking', truckPlateNo: 'NAB 5590', driverName: 'Mario Reyes', driverLicenseNo: 'N02-15-334455',
        generalAssessment: 'Roadworthy' as const, signature: DEMO_SIGNATURE, branchCode: 'MNL', encodedBy: 'BG.MNL', inspection: [] };
      histEwas.push({ euNo: 'EU-TMP-R', clientCode: 'C-00123', contractNo: 'LTL-2026-0045', branchCode: 'MNL', driverName: 'Mario Reyes', driverLicenseNo: 'N02-15-334455', truckPlateNo: 'NAB 5590', trucker: 'XYZ Trucking',
        // Portal EWA list review: extended once — expired before the truck arrived, extension approved, then used (GAT-003, BR-06).
        units: [{ equipmentType: ret.chassisType, qty: 1, usedChassis: [ret.chassisNo] }], createdAt: addHours(outAt, -27), validUntil: addHours(outAt, 22.5), createdVia: 'Portal', status: 'Used', extensionCount: 1, createdBy: 'client@abclogistics.ph',
        extensions: [{ requestedAt: addHours(outAt, -2.5), requestedBy: 'client@abclogistics.ph', reason: 'Truck held at the port; driver arriving this morning', workflowId: 'WF-EWX-0', status: 'Approved', decidedAt: addHours(outAt, -1.5), decidedBy: 'DYM.MNL', validUntilBefore: addHours(outAt, -3), validUntilAfter: addHours(outAt, 22.5) }] });
      gatePasses.push({ ...base, gatePassNo: 'MNL0880', direction: 'OUT', euNo: 'EU-TMP-R', truckOrcr: 'OR 4100190 / CR 5200290', actualEventAt: outAt, encodedAt: outAt, eirNo: 'EIR-MNL-000180', pairedGatePassNo: 'MNL0881', inspection: checklist() },
        { ...base, gatePassNo: 'MNL0881', direction: 'IN', actualEventAt: inAt, encodedAt: inAt, eirNo: 'EIR-MNL-000181', pairedGatePassNo: 'MNL0880', originBranchCode: 'MNL', remarks: 'Tail lamp and wiring damaged — chargeable ₱4,500 (billed on INV-MNL-00001118)', inspection: checklist({ 'Lights & wiring': 4500 }) });
    }
    // Portal dashboard review (BR-16): an ABC unit hired out at Cavite and returned at Manila with the IT-issued cross-branch approval code.
    // A cracked tail lamp was found at Gate In — chargeable ₱950 on the inbound EIR. It is the oldest release, so it keeps EU-000599 and the other EU numbers do not move.
    const xb = chassis.find((c) => c.branchCode === 'CAV' && c.status === 'Available');
    if (xb) {
      const outAt = ago(80), inAt = addHours(ago(44), 2.5), base = { chassisNo: xb.chassisNo, clientCode: 'C-00123', contractNo: 'LTL-2026-0045', trucker: 'XYZ Trucking', truckPlateNo: 'NAB 5601', driverName: 'Arnel Bautista', driverLicenseNo: 'N03-20-112233',
        generalAssessment: 'Roadworthy' as const, signature: DEMO_SIGNATURE, encodedBy: 'BG.MNL' };
      histEwas.push({ euNo: 'EU-000599', clientCode: 'C-00123', contractNo: 'LTL-2026-0045', branchCode: 'CAV', driverName: 'Arnel Bautista', driverLicenseNo: 'N03-20-112233', truckPlateNo: 'NAB 5601', trucker: 'XYZ Trucking',
        // Portal EWA list review: partly released — 1 of 2 units left the gate; the EWA expired and the second unit lapsed.
        units: [{ equipmentType: xb.chassisType, qty: 2, usedChassis: [xb.chassisNo] }], createdAt: addHours(outAt, -2), validUntil: addHours(outAt, 22), createdVia: 'Portal', status: 'Expired', extensionCount: 0, createdBy: 'client@abclogistics.ph' });
      gatePasses.push({ ...base, gatePassNo: 'CAV0871', direction: 'OUT', euNo: 'EU-000599', truckOrcr: 'OR 4100195 / CR 5200295', actualEventAt: outAt, encodedAt: outAt, branchCode: 'CAV', eirNo: 'EIR-CAV-000214', pairedGatePassNo: 'MNL0884', inspection: checklist() },
        { ...base, gatePassNo: 'MNL0884', direction: 'IN', actualEventAt: inAt, encodedAt: inAt, branchCode: 'MNL', originBranchCode: 'CAV', crossBranchCode: 'XB-7Q4K2M', eirNo: 'EIR-CAV-000214', pairedGatePassNo: 'CAV0871',
          remarks: 'Left tail lamp cracked — chargeable on the inbound EIR', inspection: checklist({ 'Lights & wiring': 950 }) });
      eirs.push({ eirNo: 'EIR-CAV-000214', gatePassOutNo: 'CAV0871', gatePassInNo: 'MNL0884', clientCode: 'C-00123', chassisNo: xb.chassisNo, chassisType: xb.chassisType, eirOutDate: outAt, eirInDate: inAt, depotCode: 'CAV', contractNo: 'LTL-2026-0045', reprintCount: 0 });
      xb.branchCode = 'MNL'; xb.statusSince = inAt; // the unit now sits at the return branch
      crossBranch.push({ code: 'XB-7Q4K2M', chassisNo: xb.chassisNo, toBranch: 'MNL', used: true, expiresAt: addHours(ago(45), 72) });
    }
  }
  // Review 1.1: EU numbers follow creation dates (oldest = EU-000600). The fixed recent EWAs (EU-000765 … EU-000781) are all newer.
  {
    const renum: Record<string, string> = {};
    [...histEwas].filter((e) => e.euNo.startsWith('EU-TMP-')).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach((e, k) => { renum[e.euNo] = `EU-${String(600 + k).padStart(6, '0')}`; });
    histEwas.forEach((e) => { e.euNo = renum[e.euNo] ?? e.euNo; });
    gatePasses.forEach((g) => { if (g.euNo) g.euNo = renum[g.euNo] ?? g.euNo; });
  }
  chassis.filter((c) => c.status === 'Allocated').forEach((c) => { c.allocation = { clientCode: 'C-00123', contractNo: 'LTL-2026-0045', date: ago(1), expectedReturn: ahead(30) }; });
  // DCIR repair categories (DBL-ALO-003): units without an override derive Minor/Major from the open JO, or TQS when repair is done (awaiting BR-07 sign-off).
  (['Breakdown', 'In Repair'] as const).forEach((s) => chassis.filter((c) => c.status === s).forEach((c, i) => { const cat = ([undefined, 'Major Repair', 'Minor Repair', 'Major Repair'] as const)[i]; if (cat) c.yardCategory = cat; }));
  // Chassis master attributes (SCR-12 review, DBL-CHS-001/002) — optional fields only; fleet size and statuses are untouched.
  chassis.forEach((c, i) => {
    c.axleConfig ??= i % 4 === 3 ? '3-axle' : '2-axle';
    c.hubType ??= (['10-hole', '8-hole', 'Spoke', '10-hole', '8-hole'] as const)[i % 5];
    c.tags ??= [c.axleConfig === '3-axle' ? 'Triaxle' : 'Dual Axle', c.hubType === 'Spoke' ? 'Spoke Type' : '8/10-Hole', ...(i % 7 === 2 ? ['Flashback'] : []), ...(i % 9 === 4 ? ['East Coast'] : [])];
    if (c.owner !== 'DELWATER' && !c.ownerEquipmentNo) c.ownerEquipmentNo = `PTN-EQ-${4100 + i}`;
  });

  // Notice history follows the DBL-REG-003 cadence: every stage already passed was sent; expired units were escalated.
  const regNotices = (offset: number) => {
    const exp = ahead(offset);
    const n: NonNullable<Registration['notices']> = [];
    ([[90, '90', 'Regulatory + Accounting'], [30, '30', 'Regulatory + Accounting'], [14, '14', 'Operations + Sales']] as const).forEach(([d, stage, recipients]) => { if (offset <= d) n.push({ at: addDays(exp, -d), stage, recipients }); });
    if (offset < 0) n.push({ at: addDays(exp, 1), stage: 'expired', recipients: 'Regulatory + Operations Manager + Accounting (escalation)' });
    return { notices: n, lastNotifiedStage: (offset <= 14 ? '14' : offset <= 30 ? '30' : offset <= 90 ? '90' : undefined) as Registration['lastNotifiedStage'], escalatedAt: offset < 0 ? addDays(exp, 1) : undefined, escalatedTo: offset < 0 ? 'Regulatory + Operations Manager + Accounting' : undefined };
  };
  const otherUnits: [Registration['subjectType'], string, string, string, number | null][] = [
    ['Trailer', 'TRL-MNL-01', 'MNL', 'Flatbed trailer 40ft', 60], ['Trailer', 'TRL-CEB-02', 'CEB', 'Flatbed trailer 20ft', 210],
    ['Vehicle', 'VEH-HO-01', 'HO', 'Service pickup', 18], ['Vehicle', 'VEH-HO-02', 'HO', 'Admin van', 320], ['Vehicle', 'VEH-HO-03', 'HO', 'Service pickup (new unit)', null],
    ['Motorcycle', 'MC-MNL-01', 'MNL', 'Yard checker motorcycle', 45], ['Motorcycle', 'MC-DVO-02', 'DVO', 'Yard checker motorcycle', 100],
    ['Prime Mover', 'PM-MNL-01', 'MNL', 'Prime mover 6x4', 9], ['Prime Mover', 'PM-BTG-02', 'BTG', 'Prime mover 6x4', 250], ['Prime Mover', 'PM-CAV-03', 'CAV', 'Prime mover 6x4 (new unit)', null],
  ];
  const registrations: Registration[] = [...chassis.map((c, i): Registration => {
    const offset = [400, 200, 85, 25, 12, -5, 300, 150][i % 8];
    return {
      ...regNotices(offset), responsible: 'REG', followUp: offset < 0 ? 'Escalated — renewal overdue' : offset <= 30 ? 'LTO appointment to book' : undefined, followUpDate: offset <= 30 ? ahead(Math.max(1, Math.min(offset, 7))).slice(0, 10) : undefined,
      id: `REG-${i + 1}`, subjectType: 'Chassis', subjectId: c.chassisNo, plateNo: c.plateNo ?? '', orNo: `OR${7000000 + i}`, crNo: `CR${8000000 + i}`,
      issueDate: addDays(ahead(offset), -365).slice(0, 10), expiryDate: ahead(offset).slice(0, 10), agency: 'LTO', region: branches.find((b) => b.code === c.branchCode)?.region ?? 'NCR',
      renewalInProgress: offset < 30 && offset > 0 && i % 2 === 0, documents: [],
    };
  }), ...otherUnits.map(([subjectType, subjectId, branchCode, description, offset], i): Registration => {
    const region = branches.find((b) => b.code === branchCode)?.region ?? 'NCR';
    if (offset == null) return { id: `REG-X${i + 1}`, subjectType, subjectId, branchCode, description, pending: true, plateNo: '', orNo: '', crNo: '', issueDate: '', expiryDate: '', agency: 'LTO', region, renewalInProgress: false, documents: [], responsible: 'REG', followUp: 'Awaiting LTO first registration', followUpDate: ahead(5).slice(0, 10) };
    return {
      ...regNotices(offset), id: `REG-X${i + 1}`, subjectType, subjectId, branchCode, description, plateNo: `N${String.fromCharCode(66 + i)}X ${4520 + i * 7}`, orNo: `OR${7100000 + i}`, crNo: `CR${8100000 + i}`,
      issueDate: addDays(ahead(offset), -365).slice(0, 10), expiryDate: ahead(offset).slice(0, 10), agency: 'LTO', region, renewalInProgress: false, documents: [`OR-CR-${subjectId}.pdf`], responsible: 'REG',
      followUp: offset <= 30 ? 'LTO appointment to book' : undefined, followUpDate: offset <= 30 ? ahead(3).slice(0, 10) : undefined,
    };
  })];

  // SCR-35 correction pass: one line per chassis (equipment, Out → In, days, contract-snapshot rate), billing cycle matching the client
  // master (weekly = 7-day period, monthly = 30-day period), invoice date = day after period end, due = invoice date + credit term.
  clients.forEach((c, i) => { c.tin ??= `00${i + 1}-${String(234 + i * 111).padStart(3, '0')}-${String(567 + i * 7).padStart(3, '0')}-000`; c.vatStatus ??= 'VAT-registered'; });
  const pick: Record<string, number> = {};
  const unitOf = (eqIdx: number, branchCode: string) => {
    const code = equipmentTypes[eqIdx].code; const pool = chassis.filter((c) => c.chassisType === code && c.branchCode === branchCode);
    const list = pool.length ? pool : chassis.filter((c) => c.chassisType === code); const k = (pick[code + branchCode] = (pick[code + branchCode] ?? -1) + 1);
    return list[k % list.length];
  };
  const inv = (no: string, clientCode: string, contractNo: string, daysAgoIssued: number, units: [eqIdx: number, days: number][], paid: number, branchCode = 'MNL', o: Partial<Invoice> = {}): Invoice => {
    const cl = clients.find((c) => c.clientCode === clientCode)!; const ct = contracts.find((c) => c.contractNo === contractNo)!;
    for (const k in pick) delete pick[k]; // same units on each weekly invoice of a client
    const len = cl.billingCycle === 'Monthly' ? 30 : 7; const ps = ago(daysAgoIssued + len), pe = ago(daysAgoIssued + 1);
    const lines: Invoice['lines'] = units.map(([eq, days], k) => {
      const u = unitOf(eq, branchCode); const rate = ct.rates[eq].dailyRate;
      return { id: `${no}-${k + 1}`, lineType: 'Lease', description: `Chassis lease — ${equipmentTypes[eq].name}`, equipmentType: equipmentTypes[eq].code, chassisNo: u.chassisNo, from: addDays(ps, -20 - k * 3), to: days < len ? addDays(ps, days - 1) : undefined, days, rate, rateType: 'Daily — contract snapshot', amount: days * rate };
    });
    const subtotal = lines.reduce((a, l) => a + l.amount, 0), vat = Math.round(subtotal * 0.12 * 100) / 100;
    const issuedAt = ago(daysAgoIssued);
    return {
      // Date-only fields use the Manila calendar day (portal review 1.1: due date = invoice date + credit term, no off-by-one before 08:00).
      invoiceNo: no, clientCode, contractNo, periodStart: manilaDay(ps), periodEnd: manilaDay(pe), billType: 'Lease', lines,
      subtotal, vat, total: Math.round((subtotal + vat) * 100) / 100, amountPaid: paid, dueDate: manilaDay(addDays(issuedAt, ct.creditTermDays)), status: 'Sent', issuedAt, branchCode,
      batchNo: `BB-${manilaDay(issuedAt).replace(/-/g, '')}-${cl.billingCycle === 'Monthly' ? 'M' : 'W'}${branchCode}`, invoiceDate: manilaDay(issuedAt), billingCycle: cl.billingCycle, creditTermDays: ct.creditTermDays,
      sentTo: cl.ebillingEmail, sentAt: addHours(issuedAt, 1), printCount: 0,
      history: [{ at: issuedAt, by: 'ACCTG', action: 'Finalized', note: 'Billing run' }, { at: addHours(issuedAt, 1), by: 'system', action: 'Sent', note: `Billing Completion email with invoice copy to ${cl.ebillingEmail}` }],
      ...o,
    };
  };
  const invoices: Invoice[] = [
    inv('INV-MNL-00001101', 'C-00123', 'LTL-2026-0045', 20, [[7, 7], [7, 7], [6, 7], [5, 7], [5, 7]], 0),
    inv('INV-MNL-00001102', 'C-00123', 'LTL-2026-0045', 13, [[7, 7], [7, 7], [6, 7], [5, 7], [5, 7]], 20000),
    inv('INV-MNL-00001050', 'C-00188', 'SPL-2026-0012', 75, [[0, 30], [1, 30], [2, 30], [3, 30], [4, 30]], 0),
    inv('INV-MNL-00001068', 'C-00188', 'SPL-2026-0012', 45, [[3, 30], [1, 30], [1, 20]], 0),
    inv('INV-CEB-00000310', 'C-00201', 'LTL-2026-0051', 10, [[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]], 43120, 'CEB', { heldReason: 'Awaiting late-encoding credit memo CM-000009 approval (BR-05) — Deputy Yard Manager + Treasury' }),
    inv('INV-BTG-00000122', 'C-00215', 'QLP-2026-0007', 50, [[0, 30], [4, 20]], 30000, 'BTG'),
    inv('INV-MNL-00001120', 'C-00230', 'LTL-2026-0060', 5, [[0, 7], [1, 7], [2, 7], [2, 7], [3, 7], [3, 7], [6, 3]], 0),
  ];
  {
    // BR-05: the late-encoded Visayas unit (LE-00099, 9 days, WF-LE-1) is held on its invoice — excluded from the totals until CM-000009 is approved.
    const m = invoices[4]; const gp = gatePasses[2];
    const eq = equipmentTypes.find((e) => e.code === chassis.find((c) => c.chassisNo === gp?.chassisNo)?.chassisType);
    const r = contracts.find((c) => c.contractNo === 'LTL-2026-0051')?.rates.find((x) => x.equipmentType === eq?.code)?.dailyRate ?? 1300;
    if (gp && gp.clientCode === m.clientCode) m.lines.push({ id: `${m.invoiceNo}-H`, lineType: 'Lease', description: `Chassis lease — ${eq?.name ?? 'unit'}`, equipmentType: eq?.code, chassisNo: gp.chassisNo, from: gp.actualEventAt, days: 7, rate: r, rateType: 'Daily — contract snapshot', amount: 7 * r, held: true, lateDays: 9, heldMemoNo: 'CM-000009' });
    // Other bill types (DBL-FIN-005): repair (gate-in damage), GPS fee, special billing fully credited, and a cancelled duplicate.
    const one = (no: string, clientCode: string, contractNo: string, d: number, billType: string, line: Invoice['lines'][number], paid: number, branchCode: string, o: Partial<Invoice> = {}) => {
      const base = inv(no, clientCode, contractNo, d, [], paid, branchCode, { billType, ...o }); const vat = Math.round(line.amount * 0.12 * 100) / 100;
      return { ...base, lines: [{ ...line, id: `${no}-1` }], subtotal: line.amount, vat, total: line.amount + vat };
    };
    invoices.push(
      // A one-off repair bill covers the gate-in day it was found, not a weekly lease period (review 1.1: no overlap with INV-MNL-00001102).
      // Portal invoice review: this is not a lease bill — it bills the damage found at the MNL0881 Gate In (35 days ago): ₱4,500 + 12% VAT = ₱5,040.
      one('INV-MNL-00001118', 'C-00123', 'LTL-2026-0045', 8, 'Repair', { id: '', lineType: 'Damage', description: 'Chargeable damage — tail lamp + wiring (EIR-MNL-000181, Gate In MNL0881)', chassisNo: chassis[0].chassisNo, from: ago(35), to: ago(35), rateType: 'Fixed — EIR chargeable', amount: 4500 }, 0, 'MNL', { periodStart: manilaDay(ago(35)), periodEnd: manilaDay(ago(35)) }),
      one('INV-CEB-00000315', 'C-00201', 'LTL-2026-0051', 3, 'GPS', { id: '', lineType: 'GPS', description: 'GPS tracking fee — 2 units × 1 month', days: 2, rate: 500, rateType: 'Monthly per unit (proposed, DBL-FIN-010)', amount: 1000 }, 0, 'CEB'),
      one('INV-MNL-00001105', 'C-00230', 'LTL-2026-0060', 18, 'Special', { id: '', lineType: 'Special', description: 'Special billing — weekend yard handling', rateType: 'Fixed — special billing', amount: 2000, reason: 'Client request (DBL-FIN-004)' }, 0, 'MNL', { credited: 2240 }),
      // Numbered right after INV-MNL-00001102: the duplicate came out of the same billing run (review 1.1: numbers follow issue dates).
      one('INV-MNL-00001103', 'C-00123', 'LTL-2026-0045', 13, 'Lease', { id: '', lineType: 'Lease', description: 'Duplicate of INV-MNL-00001102 (same client & period)', amount: 42000 }, 0, 'MNL', { status: 'Cancelled', cancelReason: 'Billing batch conflict — duplicate of INV-MNL-00001102' }),
    );
    invoices[invoices.length - 1].history?.push({ at: ago(12), by: 'FINMGR', action: 'Cancelled', note: 'Billing batch conflict — duplicate of INV-MNL-00001102' });
    invoices[invoices.length - 2].history?.push({ at: ago(10), by: 'FINMGR', action: 'Credited', note: 'CM-000008 applied (no-rescue service dispute)' });
    // Portal invoice review: the weekly lease bill that follows INV-MNL-00001102 — billing periods now run without a gap.
    invoices.push(inv('INV-MNL-00001119', 'C-00123', 'LTL-2026-0045', 6, [[7, 7], [7, 7], [6, 7], [5, 7], [5, 7]], 0));
    // BR-05 / review: CM-000010 (2% creditable withholding tax, BIR 2307) applied to INV-MNL-00001101 — shown as a Credit Memo row on the SOA.
    const i1101 = invoices.find((i) => i.invoiceNo === 'INV-MNL-00001101');
    if (i1101) { i1101.credited = 840; i1101.history?.push({ at: ago(2), by: 'ACCTG', action: 'Credited', note: 'CM-000010 applied (withholding tax, BIR 2307)' }); }
  }

  const parts: Part[] = [
    ['TIR-1100', 'Tire 11R22.5 radial', 'pc', 'Tires', 14500], ['TIR-VALVE', 'Tire valve stem', 'pc', 'Tires', 120], ['BRK-PAD', 'Brake lining set', 'set', 'Brakes', 3800],
    ['BRK-DRUM', 'Brake drum', 'pc', 'Brakes', 7200], ['SUS-LEAF', 'Leaf spring assembly', 'pc', 'Suspension', 9800], ['ELC-LAMP', 'Tail lamp assembly', 'pc', 'Electrical', 950],
    ['ELC-WIRE', 'Wiring harness 7-pin', 'pc', 'Electrical', 2400], ['MEC-KING', 'King pin', 'pc', 'Mechanical', 5600], ['MEC-LEG', 'Landing leg', 'pair', 'Mechanical', 12500], ['PNT-PRIM', 'Primer paint (gal)', 'gal', 'Painting', 1350],
  ].map(([partCode, description, uom, category, cost]) => ({ partCode: String(partCode), description: String(description), uom: String(uom), category: String(category), standardCost: Number(cost), rescuePrice: Math.round(Number(cost) * 1.15), lowStockThreshold: 5 }));
  // SCR-29 review: counts mostly agree with the system; a few realistic variances; CEB is past its monthly cycle; DVO adds a Mindanao stockroom.
  const countVar: Record<string, number> = { 'TIR-VALVE@WH-MNL': -2, 'ELC-LAMP@WH-CEB': 1, 'MEC-KING@WH-MNL': -6, 'PNT-PRIM@WH-MNL': -1, 'SUS-LEAF@WH-DVO': -1 };
  const countAgo: Record<string, number> = { 'WH-MNL': 12, 'WH-CEB': 38, 'WH-DVO': 25 };
  const stock: Db['stock'] = parts.flatMap((p, i) => ['WH-MNL', 'WH-CEB', ...(i < 6 ? ['WH-DVO'] : [])].map((wh, j) => {
    const qtyOnHand = wh === 'WH-DVO' ? (i * 7 + 4) % 15 : (i * 3 + j * 5 + 2) % 24;
    return { partCode: p.partCode, warehouseCode: wh, qtyOnHand, lastPhysicalCount: Math.max(0, qtyOnHand + (countVar[`${p.partCode}@${wh}`] ?? 0)), lastCountDate: ago(countAgo[wh]).slice(0, 10),
      entityCode: p.partCode === 'PNT-PRIM' ? 'KNEX' : wh === 'WH-DVO' && p.category === 'Tires' ? 'NAK' : 'DBL' };
  }));
  parts.forEach((p, i) => { p.weightKg ??= [62, 0.05, 4.5, 38, 45, 1.2, 2.8, 6.5, 55, 4.2][i]; p.movementClass ??= (['Fast', 'Slow', 'Fast', 'Fast', 'Slow', 'Fast', 'Slow', 'Slow', 'Non-moving', 'Fast'] as const)[i]; });

  const wf = (w: Partial<WorkflowInstance> & Pick<WorkflowInstance, 'id' | 'matrixCode' | 'title' | 'subjectType' | 'subjectId' | 'steps'>): WorkflowInstance => ({
    requestedBy: 'AE.JREYES', requestedAt: ago(1), status: 'Pending', currentStep: 0, ...w,
  });
  // System Administrator inbox samples: every My approvals tab (pending at an IT step, escalated, submitted by me, history) and the Notifications tabs.
  const adminWorkflows: WorkflowInstance[] = [
    wf({ id: 'WF-USR-1', matrixCode: 'USER_ACCESS', title: 'User access — new Accounting user for Cebu (ACCTG.CEB)', subjectType: 'user', subjectId: 'ACCTG.CEB', requestedBy: 'FINMGR', requestedAt: ago(0.4), currentStep: 1, steps: [
      { step: 1, label: 'Department head endorsement', roles: ['FINANCE_MANAGER'], decision: 'Approved', decidedBy: 'FINMGR', decidedAt: ago(0.4), comment: 'FINMGR:FINANCE_MANAGER:New hire starts Monday — Accounting role, CEB scope|' },
      { step: 2, label: 'IT account provisioning', roles: ['SYS_ADMIN'], decision: 'Pending', dueAt: ahead(0.6) }] }),
    wf({ id: 'WF-UNL-1', matrixCode: 'ACCOUNT_UNLOCK', title: 'Unlock account — BG.CEB (5 failed sign-in attempts)', subjectType: 'user', subjectId: 'BG.CEB', requestedBy: 'BG.CEB', requestedAt: addHours(now(), -3), steps: [
      { step: 1, label: 'IT verification and unlock', roles: ['SYS_ADMIN'], decision: 'Pending', dueAt: addHours(now(), 5) }] }),
    wf({ id: 'WF-EWX-2', matrixCode: 'EWA_EXTENSION', title: 'EWA extension — EU-000779 (revalidation after expiry)', subjectType: 'ewa', subjectId: 'EU-000779', requestedBy: 'AE.JREYES', requestedAt: ago(2), currentStep: 1, steps: [
      { step: 1, label: 'Manager approval', roles: ['DYM', 'REGIONAL_MANAGER', 'OPS_MANAGER'], decision: 'Approved', decidedBy: 'OPSMGR', decidedAt: ago(1.8), comment: 'OPSMGR:OPS_MANAGER:Trucker delayed by port congestion — extend 24 h|' },
      { step: 2, label: 'IT / authorised revalidation', roles: ['SYS_ADMIN'], decision: 'Pending', dueAt: ago(0.8) }] }),
    wf({ id: 'WF-XBR-1', matrixCode: 'CROSS_BRANCH_RETURN', title: 'Cross-branch return code — DW-CEB-1046 returning to Manila', subjectType: 'chassis', subjectId: 'DW-CEB-1046', requestedBy: 'BG.MNL', requestedAt: ago(3), currentStep: 2, steps: [
      { step: 1, label: 'Regional / Operations Manager', roles: ['REGIONAL_MANAGER', 'OPS_MANAGER'], decision: 'Approved', decidedBy: 'RM.NCR', decidedAt: ago(2.8), comment: 'RM.NCR:REGIONAL_MANAGER:Client returns at MNL — confirmed with Cebu|' },
      { step: 2, label: 'APS', roles: ['APS_MANAGER'], decision: 'Approved', decidedBy: 'APS', decidedAt: ago(2.5), comment: 'APS:APS_MANAGER:Transfer the unit to MNL on finalise|' },
      { step: 3, label: 'IT issues the approval code', roles: ['SYS_ADMIN'], decision: 'Pending', dueAt: ago(1.5) }] }),
    wf({ id: 'WF-SET-1', matrixCode: 'SETTING_CHANGE', title: 'System setting — e-wallet minimum balance ₱10,000 → ₱15,000', subjectType: 'setting', subjectId: 'ewl.min_balance', amount: 15000, requestedBy: 'ADMIN', requestedAt: ago(1), steps: [
      { step: 1, label: 'Finance Manager approval', roles: ['FINANCE_MANAGER'], decision: 'Pending', dueAt: ahead(1) }] }),
    wf({ id: 'WF-SET-2', matrixCode: 'SETTING_CHANGE', title: 'System setting — EWA validity 24 h → 48 h', subjectType: 'setting', subjectId: 'gat.ewa_validity_hours', requestedBy: 'ADMIN', requestedAt: ago(9), status: 'Approved', currentStep: 1, steps: [
      { step: 1, label: 'Operations Manager approval', roles: ['OPS_MANAGER'], decision: 'Approved', decidedBy: 'OPSMGR', decidedAt: ago(8), comment: 'OPSMGR:OPS_MANAGER:Approved for the port-congestion period|' }] }),
    wf({ id: 'WF-USR-0', matrixCode: 'USER_ACCESS', title: 'Grant Treasury approver role to ACCTG', subjectType: 'user', subjectId: 'ACCTG', requestedBy: 'ADMIN', requestedAt: ago(12), status: 'Rejected', currentStep: 0, steps: [
      { step: 1, label: 'CHRO approval', roles: ['CHRO'], decision: 'Rejected', decidedBy: 'CHRO', decidedAt: ago(11), comment: 'CHRO:CHRO:Segregation of duties — Accounting cannot also approve Treasury releases|' }] }),
  ];
  const adminNote = (id: string, hoursAgo: number, title: string, body: string, link: string, read: boolean, requiresAck = false, ackAt?: string) =>
    ({ id, at: addHours(now(), -hoursAgo), title, body, link, read, requiresAck, ackAt, userId: 'ADMIN' });
  const adminNotifications = [
    adminNote('N-ADM-1', 0.3, 'Approval needed — user access', 'Finance Manager requests a new Accounting user for Cebu (ACCTG.CEB). IT provisioning is waiting for you.', '/approvals', false),
    adminNote('N-ADM-2', 3, 'Account locked — BG.CEB', 'Five failed sign-in attempts. The user has requested an unlock.', '/admin/users', false),
    adminNote('N-ADM-3', 20, 'Escalated — cross-branch return code', 'DW-CEB-1046 → Manila has waited 36 h at the IT step and was escalated.', '/approvals', false, true),
    adminNote('N-ADM-4', 26, 'Email delivery failed', '3 notification emails to billing@example.ph bounced (mailbox full). Retried 3 times.', '/admin/notifications', false),
    adminNote('N-ADM-5', 30, 'Setting change submitted', 'E-wallet minimum balance ₱10,000 → ₱15,000 is waiting for the Finance Manager.', '/admin/settings', true),
    adminNote('N-ADM-6', 48, 'Nightly DCIR snapshot saved', 'Snapshot for all branches saved at 23:59. Retained for 90 days.', '/allocation/dcir', true),
    adminNote('N-ADM-7', 72, 'Audit hash chain verified', 'Weekly check passed — 13 sealed events, no gaps.', '/admin/audit', true),
    adminNote('N-ADM-8', 120, 'Setting change approved', 'EWA validity 24 h → 48 h approved by the Operations Manager.', '/admin/settings', true, true, addHours(now(), -118)),
    adminNote('N-ADM-9', 200, 'Role change rejected', 'CHRO rejected “Grant Treasury approver role to ACCTG” — segregation of duties.', '/approvals', true),
    adminNote('N-ADM-10', 260, 'New portal registration', 'Islandlink Cargo registered on the client portal and is waiting for AE approval.', '/clients', true),
  ];
  const workflows: WorkflowInstance[] = [
    // SCR-07 history: Metro approved last year; Northstar's first attempt rejected by Finance, resubmitted 3 days ago (48h window → escalated).
    wf({ id: 'WF-ACC-0', matrixCode: 'ACCREDITATION', title: 'Accreditation — Metro Container Lines', subjectType: 'client', subjectId: 'C-00230', requestedAt: ago(408), status: 'Approved', currentStep: 3, steps: [
      { step: 1, label: 'C&C investigation (BICI)', roles: ['CNC_OFFICER'], decision: 'Approved', decidedBy: 'CNC.OFF1', decidedAt: ago(407), comment: 'CNC.OFF1:CNC_OFFICER:Recommend — clean trade and bank references|' },
      { step: 2, label: 'Finance endorsement', roles: ['FINANCE_MANAGER'], decision: 'Approved', decidedBy: 'FINMGR', decidedAt: ago(406), comment: 'FINMGR:FINANCE_MANAGER:Endorsed with ₱1.5M limit|' },
      { step: 3, label: 'VP final sign-off', roles: ['VP'], decision: 'Approved', decidedBy: 'VP', decidedAt: ago(405), comment: 'VP:VP:Approved|' }] }),
    wf({ id: 'WF-ACC-R', matrixCode: 'ACCREDITATION', title: 'Accreditation — Northstar Trucking', subjectType: 'client', subjectId: 'C-00244', requestedAt: ago(14), status: 'Rejected', currentStep: 1, steps: [
      { step: 1, label: 'C&C investigation (BICI)', roles: ['CNC_OFFICER'], decision: 'Approved', decidedBy: 'CNC.OFF1', decidedAt: ago(12), comment: 'CNC.OFF1:CNC_OFFICER:Recommend with conditions|' },
      { step: 2, label: 'Finance endorsement', roles: ['FINANCE_MANAGER'], decision: 'Rejected', decidedBy: 'FINMGR', decidedAt: ago(10), comment: 'FINMGR:FINANCE_MANAGER:Bank reference not verifiable — resubmit with bank certificate|' },
      { step: 3, label: 'VP final sign-off', roles: ['VP'], decision: 'Pending' }] }),
    wf({ id: 'WF-ACC-1', matrixCode: 'ACCREDITATION', title: 'Accreditation — Northstar Trucking', subjectType: 'client', subjectId: 'C-00244', requestedAt: ago(3), steps: [
      { step: 1, label: 'C&C investigation (BICI)', roles: ['CNC_OFFICER'], decision: 'Pending', dueAt: ago(1) },
      { step: 2, label: 'Finance endorsement', roles: ['FINANCE_MANAGER'], decision: 'Pending' },
      { step: 3, label: 'VP final sign-off', roles: ['VP'], decision: 'Pending' }] }),
    // Cash bond withdrawal in progress (SCR-09 review: show the approval stages on the list).
    wf({ id: 'WF-CBW-1', matrixCode: 'CASH_BOND_WITHDRAWAL', title: 'Cash bond withdrawal (EARLY — exception) — Visayas Freight Services', subjectType: 'cashbond', subjectId: 'CB-3', amount: 18880, requestedBy: 'AE.JREYES', requestedAt: ago(2), currentStep: 1, steps: [
      { step: 1, label: 'Credit & Collection', roles: ['CNC_OFFICER'], decision: 'Approved', decidedBy: 'CNC.OFF1', decidedAt: ago(1), comment: 'CNC.OFF1:CNC_OFFICER:No overdue balance; early exception supported|' },
      { step: 2, label: 'Finance', roles: ['FINANCE_MANAGER'], decision: 'Pending', dueAt: ahead(1) },
      { step: 3, label: 'Accounting', roles: ['ACCOUNTING'], decision: 'Pending' },
      { step: 4, label: 'Admin', roles: ['SYS_ADMIN'], decision: 'Pending' }] }),
    wf({ id: 'WF-HL-1', matrixCode: 'HOLD_LIFT', title: 'Hold lift — Pacific Movers Corp.', subjectType: 'client', subjectId: 'C-00188', amount: 308000, requestedBy: 'CNC.MGR', requestedAt: ago(3), steps: [
      { step: 1, label: 'Tier 2 — Officer 1 + Finance Manager', roles: ['CNC_OFFICER', 'FINANCE_MANAGER'], decision: 'Pending', dueAt: ago(1) }] }),
    // Gate (SCR-14/18 review): populated extension and late-encoding approval examples.
    wf({ id: 'WF-EWX-1', matrixCode: 'EWA_EXTENSION', title: 'EWA extension — EU-000776', subjectType: 'ewa', subjectId: 'EU-000776', requestedBy: 'AE.JREYES', requestedAt: addHours(now(), -2), steps: [
      { step: 1, label: 'Manager approval', roles: ['DYM', 'REGIONAL_MANAGER', 'OPS_MANAGER'], decision: 'Pending', dueAt: ahead(1) }, { step: 2, label: 'IT / authorised revalidation', roles: ['SYS_ADMIN'], decision: 'Pending' }] }),
    wf({ id: 'WF-LE-1', matrixCode: 'LATE_ENCODING_CM', title: `Late encoding 9 days — ${gatePasses[2]?.gatePassNo}`, subjectType: 'gatepass', subjectId: gatePasses[2]?.gatePassNo ?? '', requestedBy: 'BG.MNL', branchCode: gatePasses[2]?.branchCode, steps: [
      { step: 1, label: 'Deputy Yard Manager', roles: ['DYM'], decision: 'Pending', dueAt: ahead(1) }, { step: 2, label: 'Treasury', roles: ['TREASURY'], decision: 'Pending' }] }),
  ];
  // SCR-28 ledger sample (review: populated rows incl. pending-approval Adjustment / Transfer and auto-posted PO / JO movements).
  const qoh = (pc: string, wh: string) => stock.find((s) => s.partCode === pc && s.warehouseCode === wh)?.qtyOnHand ?? 0;
  const repairUnit = chassis.find((c) => c.status === 'In Repair')?.chassisNo;
  const stx = (no: number, t: Partial<Db['stockTxns'][number]> & Pick<Db['stockTxns'][number], 'type' | 'partCode' | 'qty' | 'fromWarehouse' | 'at' | 'by'>): Db['stockTxns'][number] =>
    ({ id: `STX-${no}`, txnNo: `STK-${String(no).padStart(6, '0')}`, entityCode: 'DBL', status: 'Posted', source: 'Manual', balanceAfter: qoh(t.partCode, t.fromWarehouse!), ...t });
  const stockTxns: Db['stockTxns'] = [
    stx(118, { type: 'Request', partCode: 'MEC-LEG', qty: 2, fromWarehouse: 'WH-CEB', toWarehouse: 'WH-MNL', referenceType: 'Request', status: 'Open', requestingBranch: 'CEB', department: 'Repair & Maintenance', requestedBy: 'BG.CEB', remarks: 'Landing legs for two units awaiting repair in Cebu', at: addHours(now(), -5), by: 'BG.CEB' }),
    stx(117, { type: 'Transfer', partCode: 'BRK-PAD', qty: -4, fromWarehouse: 'WH-MNL', toWarehouse: 'WH-CEB', referenceType: 'Transfer', status: 'Pending Approval', workflowId: 'WF-STK-2', remarks: 'Rebalance brake linings to Cebu', at: addHours(now(), -20), by: 'WH.MNL' }),
    stx(116, { type: 'Adjustment', partCode: 'TIR-VALVE', qty: -2, fromWarehouse: 'WH-MNL', referenceType: 'Manual', reason: 'Two valve stems found damaged during count', status: 'Pending Approval', workflowId: 'WF-STK-1', at: ago(1), by: 'WH.MNL' }),
    stx(115, { type: 'Issue', partCode: 'PNT-PRIM', qty: -3, fromWarehouse: 'WH-MNL', referenceType: 'JO', referenceId: 'JO-MNL-000498', source: 'Auto — Job Order', equipmentRef: repairUnit, entityCode: 'KNEX', at: ago(2), by: 'BG.MNL' }),
    stx(114, { type: 'Issue', partCode: 'ELC-LAMP', qty: -2, fromWarehouse: 'WH-MNL', referenceType: 'JO', referenceId: 'JO-MNL-000498', source: 'Auto — Job Order', equipmentRef: repairUnit, damagedQty: 2, remarks: 'Two broken lamps returned to scrap bin', at: ago(2), by: 'BG.MNL' }),
    stx(113, { type: 'Receive', partCode: 'ELC-WIRE', qty: 3, fromWarehouse: 'WH-CEB', referenceType: 'Transfer', referenceId: 'STK-000112', approvalRef: 'WF-00007', balanceAfter: 3, at: ago(14), by: 'BG.CEB' }),
    stx(112, { type: 'Transfer', partCode: 'ELC-WIRE', qty: -3, fromWarehouse: 'WH-MNL', toWarehouse: 'WH-CEB', referenceType: 'Transfer', approvalRef: 'WF-00007', at: ago(15), by: 'WH.MNL' }),
    stx(111, { type: 'Receive', partCode: 'SUS-LEAF', qty: 8, fromWarehouse: 'WH-MNL', referenceType: 'RR', referenceId: 'RR-000059', poNo: 'PO-000149', orderedQty: 8, source: 'Auto — PO', at: ago(9), by: 'WH.MNL' }),
    stx(110, { type: 'Issue', partCode: 'SUS-LEAF', qty: -1, fromWarehouse: 'WH-MNL', referenceType: 'JO', referenceId: 'JO-MNL-000470', source: 'Auto — Job Order', equipmentRef: chassis[0].chassisNo, balanceAfter: qoh('SUS-LEAF', 'WH-MNL') - 8, at: ago(13), by: 'BG.MNL' }),
  ];
  stockTxns[2].balanceAfter = qoh('TIR-VALVE', 'WH-MNL'); stockTxns[1].balanceAfter = qoh('BRK-PAD', 'WH-MNL');
  const mnlKing = stock.find((s) => s.partCode === 'MEC-KING' && s.warehouseCode === 'WH-MNL');
  if (mnlKing) mnlKing.pendingCount = { counted: 18, auditType: 'Monthly cycle count', reason: 'Recount after −6 variance; one king pin found in R&M bay', photoName: 'bin-card-MEC-KING-MNL.jpg', submittedBy: 'WH.MNL', submittedAt: ago(0.5), workflowId: 'WF-CNT-1' };
  workflows.push(
    wf({ id: 'WF-STK-1', matrixCode: 'STOCK_ADJUSTMENT', title: 'Stock adjustment STK-000116 — TIR-VALVE', subjectType: 'stock', subjectId: 'STK-000116', requestedBy: 'WH.MNL', steps: [{ step: 1, label: 'APS approval', roles: ['APS_MANAGER'], decision: 'Pending', dueAt: ahead(1) }] }),
    wf({ id: 'WF-STK-2', matrixCode: 'STOCK_TRANSFER', title: 'Stock transfer STK-000117 — BRK-PAD WH-MNL → WH-CEB', subjectType: 'stock', subjectId: 'STK-000117', requestedBy: 'WH.MNL', requestedAt: addHours(now(), -20), steps: [{ step: 1, label: 'APS approval', roles: ['APS_MANAGER'], decision: 'Pending', dueAt: ahead(1) }] }),
    wf({ id: 'WF-CNT-1', matrixCode: 'STOCK_COUNT', title: 'Monthly cycle count MEC-KING @ WH-MNL — variance −5', subjectType: 'stock', subjectId: 'MEC-KING@WH-MNL', requestedBy: 'WH.MNL', requestedAt: ago(0.5), steps: [{ step: 1, label: 'APS / MMG Manager — audit report approval', roles: ['APS_MANAGER'], decision: 'Pending', dueAt: ahead(1.5) }] }),
    wf({ id: 'WF-AST-1', matrixCode: 'ASSET_DISPOSAL', title: 'Dispose asset AST-ST-005 — Pallet jack', subjectType: 'asset', subjectId: 'AST-ST-005', requestedBy: 'APS.OFF', branchCode: 'MNL', steps: [{ step: 1, label: 'APS / MMG Manager approval', roles: ['APS_MANAGER'], decision: 'Pending', dueAt: ahead(1) }] }),
  );
  const lateEncodings: Db['lateEncodings'] =[gatePasses[1], gatePasses[2]].filter(Boolean).map((g, i) => ({
    id: `LE-0009${8 + i}`, gatePassNo: g.gatePassNo, originalDate: g.encodedAt, correctedDate: addDays(g.encodedAt, i ? -9 : -3), daysLate: i ? 9 : 3,
    reason: i ? 'Branch system outage — paper gate pass encoded after restoration' : 'Connectivity outage at the gate tablet', path: i ? 'CREDIT_MEMO' : 'AUTO', status: i ? 'Pending Approval' : 'Posted',
    workflowId: i ? 'WF-LE-1' : undefined, createdAt: g.encodedAt, createdBy: 'BG.MNL', attachment: i ? 'outage-report-ITSR-0142.pdf' : undefined,
  }));

  // ── SCR-36 / SCR-37 billing examples: PR → Treasury clearance → OR, bounced / cancelled / provisional receipts; memos in every state.
  const billRc = (r: Partial<Db['receipts'][number]> & Pick<Db['receipts'][number], 'receiptNo' | 'clientCode' | 'amount' | 'method'>): Db['receipts'][number] => ({
    type: 'PR', date: ago(5).slice(0, 10), applications: [], unapplied: 0, by: 'ACCTG', status: 'Provisional', createdAt: ago(5), tin: clients.find((c) => c.clientCode === r.clientCode)?.tin, ...r,
  });
  const billingReceipts: Db['receipts'] = [
    billRc({ receiptNo: 'PR-MNL-00000455', clientCode: 'C-00230', amount: 30000, method: 'Check', checkNo: '0081234', bank: 'BPI', checkDate: ahead(3).slice(0, 10), pdc: true, depositStatus: 'Not deposited', date: ago(1).slice(0, 10), createdAt: ago(1),
      reference: 'BPI 0081234', applications: [{ invoiceNo: 'INV-MNL-00001120', amount: 30000 }], notes: 'Post-dated check received at Manila cashier; deposit on check date.' }),
    billRc({ receiptNo: 'PR-MNL-00000447', orNo: 'OR-MNL-00000450', type: 'OR', status: 'OR Issued', clientCode: 'C-00123', amount: 20000, method: 'Check', checkNo: '004512', bank: 'BDO', checkDate: ago(6).slice(0, 10), depositStatus: 'Cleared', reference: 'BDO 004512',
      date: ago(6).slice(0, 10), createdAt: ago(6), clearedAt: ago(5).slice(0, 10), clearedBy: 'TREAS', applications: [{ invoiceNo: 'INV-MNL-00001102', amount: 20000 }],
      history: [{ at: ago(6), by: 'ACCTG', action: 'PR recorded' }, { at: ago(5), by: 'TREAS', action: 'Clearance confirmed — OR-MNL-00000450 issued' }] }),
    billRc({ receiptNo: 'PR-CEB-00000451', orNo: 'OR-CEB-00000452', type: 'OR', status: 'OR Issued', clientCode: 'C-00201', amount: 43120, method: 'Bank Transfer', bank: 'Metrobank', reference: 'MBTC-TRF-88120', date: ago(4).slice(0, 10), createdAt: ago(4),
      clearedAt: ago(3).slice(0, 10), clearedBy: 'TREAS', depositStatus: 'Cleared', applications: [{ invoiceNo: 'INV-CEB-00000310', amount: 43120 }], history: [{ at: ago(4), by: 'ACCTG', action: 'PR recorded' }, { at: ago(3), by: 'TREAS', action: 'Clearance confirmed — OR-CEB-00000452 issued' }] }),
    billRc({ receiptNo: 'PR-BTG-00000441', orNo: 'OR-BTG-00000442', type: 'OR', status: 'OR Issued', clientCode: 'C-00215', amount: 30000, method: 'Check', checkNo: '220019', bank: 'Landbank', checkDate: ago(30).slice(0, 10), reference: 'LBP 220019',
      date: ago(30).slice(0, 10), createdAt: ago(30), clearedAt: ago(27).slice(0, 10), clearedBy: 'TREAS', depositStatus: 'Cleared', applications: [{ invoiceNo: 'INV-BTG-00000122', amount: 30000 }] }),
    billRc({ receiptNo: 'PR-MNL-00000449', status: 'Bounced', clientCode: 'C-00188', amount: 50000, method: 'Check', checkNo: '0012077', bank: 'RCBC', checkDate: ago(12).slice(0, 10), depositStatus: 'Returned', reference: 'RCBC 0012077',
      date: ago(12).slice(0, 10), createdAt: ago(12), applications: [{ invoiceNo: 'INV-MNL-00001068', amount: 50000 }], penaltyMemoNo: 'DM-000037', notes: 'Returned DAIF by RCBC; client informed by C&C.',
      history: [{ at: ago(12), by: 'ACCTG', action: 'PR recorded' }, { at: ago(9), by: 'TREAS', action: 'Bounced — check returned DAIF', note: 'Dishonoured-check penalty DM-000037 raised' }] }),
    billRc({ receiptNo: 'PR-MNL-00000448', status: 'Cancelled', clientCode: 'C-00123', amount: 5000, method: 'Cash', date: ago(9).slice(0, 10), createdAt: ago(9), unapplied: 5000, cancelReason: 'Encoded under the wrong client — re-issued under Metro Container Lines', cancelledBy: 'ACCTG',
      history: [{ at: ago(9), by: 'ACCTG', action: 'PR recorded' }, { at: ago(9), by: 'ACCTG', action: 'Cancelled', note: 'Encoded under the wrong client' }] }),
  ];
  const billStep = (label: string, roles: RoleCode[], decision: 'Pending' | 'Approved' | 'Rejected', by?: string, at?: string, comment?: string) => ({ step: 0, label, roles, decision, decidedBy: by, decidedAt: at, comment: by ? `${by}:${roles[0]}:${comment ?? ''}|` : undefined });
  const memoWf = (id: string, subjectId: string, title: string, amount: number, status: WorkflowInstance['status'], steps: ReturnType<typeof billStep>[], at: string) =>
    wf({ id, matrixCode: 'MEMO', title, subjectType: 'memo', subjectId, amount, status, requestedBy: 'ACCTG', requestedAt: at, currentStep: status === 'Pending' ? steps.findIndex((s) => s.decision === 'Pending') : steps.length, steps: steps.map((s, i) => ({ ...s, step: i + 1 })) });
  workflows.push(
    memoWf('WF-CM-7', 'CM-000007', 'Credit memo CM-000007 — Southern Haulers Co.', 3000, 'Rejected', [billStep('Finance Manager', ['FINANCE_MANAGER'], 'Rejected', 'FINMGR', ago(18), 'No evidence of overbilling — rates match contract snapshot')], ago(19)),
    memoWf('WF-CM-8', 'CM-000008', 'Credit memo CM-000008 — Metro Container Lines', 2240, 'Approved', [billStep('Finance Manager', ['FINANCE_MANAGER'], 'Approved', 'FINMGR', ago(10), 'Dispute upheld')], ago(11)),
    memoWf('WF-CM-10', 'CM-000010', 'Credit memo CM-000010 — ABC Logistics Inc.', 840, 'Approved', [billStep('Finance Manager', ['FINANCE_MANAGER'], 'Approved', 'FINMGR', ago(2), 'BIR 2307 received')], ago(3)),
    memoWf('WF-DM-37', 'DM-000037', 'Debit memo DM-000037 — Pacific Movers Corp.', 2500, 'Pending', [billStep('Finance Manager', ['FINANCE_MANAGER'], 'Pending')], ago(9)),
  );
  const leWf = workflows.find((w) => w.id === 'WF-LE-1');
  if (leWf) { leWf.steps[0] = { ...leWf.steps[0], decision: 'Approved', decidedBy: 'DYM.MNL', decidedAt: ago(0.5), comment: 'DYM.MNL:DYM:Outage report verified|' }; leWf.currentStep = 1; leWf.steps[1].dueAt = ahead(1.5); }
  const leHeld = invoices[4].lines.find((l) => l.held);
  const billingMemos: Db['memos'] = [
    { memoNo: 'CM-000010', type: 'Credit', clientCode: 'C-00123', referenceInvoiceNo: 'INV-MNL-00001101', referenceType: 'Invoice', amount: 840, reason: 'Creditable withholding tax (2% of ₱42,000) on INV-MNL-00001101 — BIR Form 2307 received', category: 'Withholding-tax adjustment', status: 'Applied', workflowId: 'WF-CM-10',
      createdAt: ago(3), createdBy: 'ACCTG', source: 'Manual', evidence: ['BIR-2307-ABC-2026Q3.pdf'], approvalChain: ['Finance Manager'], appliedTo: 'INV-MNL-00001101', appliedAt: ago(2), balanceAfter: 46200 },
    { memoNo: 'CM-000009', type: 'Credit', clientCode: 'C-00201', referenceInvoiceNo: 'INV-CEB-00000310', referenceType: 'Late Encoding', referenceId: 'LE-00099', amount: leHeld?.amount ?? 0, reason: 'Late encoding 9 days — bill the held unit from the actual gate-out date (BR-05)',
      category: 'Late-encoding correction', status: 'Pending Approval', workflowId: 'WF-LE-1', createdAt: ago(1), createdBy: 'BG.MNL', source: 'Auto', evidence: ['outage-report-ITSR-0142.pdf'], approvalChain: ['Deputy Yard Manager', 'Treasury'] },
    { memoNo: 'CM-000008', type: 'Credit', clientCode: 'C-00230', referenceInvoiceNo: 'INV-MNL-00001105', referenceType: 'Invoice', amount: 2240, reason: 'Special billing disputed — handling was covered by the rescue already charged', category: 'No-rescue service dispute', status: 'Applied',
      workflowId: 'WF-CM-8', createdAt: ago(11), createdBy: 'ACCTG', source: 'Manual', evidence: ['client-dispute-letter.pdf'], approvalChain: ['Finance Manager'], appliedTo: 'INV-MNL-00001105', balanceAfter: 0, appliedAt: ago(10) },
    { memoNo: 'CM-000007', type: 'Credit', clientCode: 'C-00215', referenceInvoiceNo: 'INV-BTG-00000122', referenceType: 'Invoice', amount: 3000, reason: 'Client claims overbilling of 2 days', category: 'Billing correction', status: 'Rejected',
      workflowId: 'WF-CM-7', createdAt: ago(19), createdBy: 'ACCTG', source: 'Manual', evidence: ['client-email.pdf'], approvalChain: ['Finance Manager'] },
    { memoNo: 'DM-000038', type: 'Debit', clientCode: 'C-00123', referenceType: 'Job Order', referenceId: 'JO-MNL-000512', joNo: 'JO-MNL-000512', amount: 13328, reason: 'Chargeable repair after gate-in — two tires and brake lining', category: 'Repair cost', status: 'Draft',
      createdAt: ago(0.5), createdBy: 'ACCTG', source: 'Manual', evidence: ['JO-MNL-000512-photos.zip'], breakdown: { labor: 1900, parts: 9200, travel: 0, service: 800, inputTax: 1428 }, approvalChain: ['Finance Manager'] },
    { memoNo: 'DM-000037', type: 'Debit', clientCode: 'C-00188', referenceInvoiceNo: 'INV-MNL-00001068', referenceType: 'Receipt', referenceId: 'PR-MNL-00000449', amount: 2500, reason: 'Dishonoured check RCBC 0012077 — contract penalty', category: 'Dishonoured check penalty', status: 'Pending Approval',
      workflowId: 'WF-DM-37', createdAt: ago(9), createdBy: 'TREAS', source: 'Auto', evidence: ['RCBC-return-slip.pdf'], approvalChain: ['Finance Manager'] },
  ];

  const rule = (id: string, eventType: string, description: string, recipientRoles: RoleCode[], source: string, o: Partial<NotificationRule> = {}): NotificationRule => ({
    id, eventType, description, recipientRoles, namedRecipients: [], includeClient: false, includeAe: false, channels: ['Email', 'SMS', 'In-App'], mode: 'One-time', active: true, source, ...o,
  });
  const notificationRules: NotificationRule[] = [
    rule('N01', 'client.portal_registered', 'Portal registration — AE one-click approval', [], 'DBL-CLT-019', { includeAe: true, channels: ['Email', 'In-App'] }),
    rule('N02', 'client.portal_denied', 'Portal registration denied', [], 'DBL-CLT-019', { includeClient: true, channels: ['Email'] }),
    rule('N03', 'client.hold.applied', 'Credit Hold Alert', ['CNC_OFFICER', 'OPS_MANAGER'], 'DBL-NOT-004', { includeAe: true, includeClient: true }),
    rule('N04', 'client.reactivated', 'Client reactivated', ['CNC_OFFICER', 'OPS_MANAGER'], 'UC-09', { includeAe: true, includeClient: true, channels: ['Email', 'In-App'] }),
    rule('N05', 'contract.expiring', 'Contract expiry 3/2/1 months', ['SALES_DIRECTOR'], 'DBL-CLT-011', { includeAe: true, channels: ['Email', 'In-App'] }),
    rule('N06', 'contract.activated', 'Contract activation / expiration', ['SALES_DIRECTOR', 'CNC_OFFICER'], 'DBL-NOT-004', { includeAe: true, includeClient: true, channels: ['Email'] }),
    rule('N07', 'cashbond.withdrawal', 'Cash bond withdrawal', ['SALES_DIRECTOR', 'CNC_OFFICER', 'ACCOUNTING', 'FINANCE_MANAGER'], 'DBL-NOT-004', { channels: ['Email', 'In-App'] }),
    rule('N08', 'ewa.created', 'EWA created — full details', ['BRANCH_GENERALIST', 'DYM', 'REGIONAL_MANAGER', 'SALES_DIRECTOR'], 'DBL-GAT-002, DBL-NOT-006', { includeAe: true, includeClient: true, namedRecipients: ['ops-mailbox@demo.delbros.local'] }),
    rule('N09', 'gate.out.completed', 'Chassis out', ['BRANCH_GENERALIST'], 'DBL-NOT-003', { includeAe: true, includeClient: true }),
    rule('N10', 'gate.in.completed', 'Chassis in', ['BRANCH_GENERALIST'], 'DBL-NOT-003', { includeAe: true, includeClient: true }),
    rule('N11', 'gate.in.unroadworthy', 'Unroadworthy return → JO approval chain', ['BRANCH_GENERALIST', 'DYM'], 'DBL-RM-008', { channels: ['Email', 'In-App'] }),
    rule('N12', 'late_encoding.cm_required', 'Late encoding > 7 days — CM approval', ['DYM', 'TREASURY'], 'DBL-GAT-009, DBL-NOT-005', { escalationHours: 48, channels: ['Email', 'In-App'] }),
    rule('N13', 'rescue.requested', 'Rescue requested (urgent = repeat SMS until ack)', ['SALES_DIRECTOR', 'DYM', 'BRANCH_GENERALIST', 'OPS_MANAGER', 'CNC_OFFICER', 'ACCOUNTING'], 'DBL-RES-005, DBL-NOT-003', { mode: 'Repeat until ack', repeatMinutes: 15 }),
    rule('N14', 'rescue.completed', 'Rescue completed — full detail', ['OPS_MANAGER', 'CNC_OFFICER', 'ACCOUNTING'], 'DBL-NOT-006', { includeClient: true, channels: ['Email'] }),
    rule('N15', 'jo.created', 'Job order created (DYM escalation if major)', ['BRANCH_GENERALIST', 'DYM'], 'DBL-RM-008', { channels: ['Email', 'In-App'] }),
    rule('N16', 'jo.spot_repair', 'Spot repair (urgent)', ['BRANCH_GENERALIST', 'DYM'], 'DBL-NOT-003', { mode: 'Repeat until ack', repeatMinutes: 15, channels: ['SMS', 'In-App'] }),
    rule('N17', 'prc.approval_needed', 'RFP / PO approvals', ['DEPT_HEAD', 'ACCOUNTING'], 'DBL-NOT-004/005', { escalationHours: 48, channels: ['Email', 'In-App'] }),
    rule('N18', 'prc.payable.due_in_14d', 'Supplier payable due in 2 weeks', ['APS_OFFICER', 'ACCOUNTING'], 'DBL-FIN-016', { channels: ['Email'] }),
    rule('N19', 'billing.completed', 'Billing completion (client gets invoice copy)', ['ACCOUNTING', 'CNC_OFFICER', 'SALES_DIRECTOR'], 'DBL-NOT-004', { includeClient: true, channels: ['Email'] }),
    rule('N20', 'payment.applied', 'Payment application alert', ['CNC_OFFICER', 'SALES_DIRECTOR'], 'DBL-NOT-004', { includeClient: true, channels: ['Email'] }),
    rule('N21', 'invoice.overdue', 'Overdue balance alert', ['SALES_DIRECTOR', 'OPS_MANAGER', 'CNC_OFFICER'], 'DBL-NOT-004', { includeClient: true }),
    rule('N22', 'collection.reminder', 'SOA summary / payment reminders', ['CNC_OFFICER'], 'DBL-CNC-003…006', { includeClient: true, channels: ['Email'] }),
    rule('N23', 'hold_lift.escalated', 'Hold-to-Active escalation', ['FINANCE_MANAGER', 'CNC_MANAGER', 'EXEC_OFFICER'], 'DBL-NOT-004', { channels: ['Email', 'In-App'] }),
    rule('N24', 'ewallet.movement', 'E-wallet deduction / replenishment / below minimum', ['OPS_MANAGER', 'CNC_OFFICER'], 'DBL-EWL-004', { includeAe: true, includeClient: true }),
    rule('N25', 'registration.expiring_90_30', 'Registration expiring in 90 / 30 days', ['REGULATORY', 'ACCOUNTING'], 'DBL-REG-003', { channels: ['Email', 'In-App'] }),
    rule('N26', 'registration.expiring_14', 'Registration expiring in 14 days', ['OPS_MANAGER', 'SALES_DIRECTOR'], 'DBL-REG-003'),
    rule('N27', 'inventory.low_stock', 'Low stock', ['APS_OFFICER', 'WAREHOUSE'], 'DBL-RPT-004', { channels: ['In-App', 'Email'] }),
    rule('N28', 'workflow.task', 'Approval task assigned / escalated', [], 'Engine', { channels: ['In-App', 'Email'], escalationHours: 48 }),
    rule('N29', 'report.ready', 'Report ready', [], 'Reporting', { channels: ['In-App'] }),
    rule('N30', 'integration.delivery_failed', 'Delivery failure alert', ['SYS_ADMIN'], 'INT-002', { channels: ['Email', 'In-App'] }),
  ];

  const vendors: Db['vendors'] = [
    { vendorId: 'V-001', name: 'Tire Pro Supply', tin: '000-111-222-000', address: 'Quezon City', email: 'vendor@tirepro.ph', paymentTerms: '30 days', status: 'Active' },
    { vendorId: 'V-002', name: 'Axle & Brake Parts Co.', tin: '000-333-444-000', address: 'Valenzuela', email: 'sales@axlebrake.ph', paymentTerms: '15 days', status: 'Active' },
    { vendorId: 'V-003', name: 'Roadside Rescue Partners', tin: '000-555-666-000', address: 'Cavite', email: 'dispatch@rrp.ph', paymentTerms: '30 days', status: 'Active' },
    { vendorId: 'V-005', name: 'Luzon Brake & Axle Trading', tin: '000-999-111-000', address: 'Caloocan', email: 'sales@luzonbrake.ph', paymentTerms: '30 days', status: 'Pending', statusReason: 'Vendor accreditation in progress (Procurement)' },
  ];

  const breakdown = chassis.find((c) => c.status === 'Breakdown')!;
  const inRepair = chassis.find((c) => c.status === 'In Repair')!;

  // Portal Rescue review (2026-11-11): one ABC unit is under rescue (RSC-000042, Dispatched); who is told about a new request.
  const rsc42Unit = onHire.filter((c) => c.currentClientCode === 'C-00123')[2];
  if (rsc42Unit) { rsc42Unit.status = 'Rescue'; rsc42Unit.statusSince = addHours(now(), -0.55); }
  const rescueNotes = (at: string, urgent: boolean, branch = 'MNL'): EwaDelivery[] => ([
    ['Delbros', 'Paolo Reyes — dispatcher', 'opsmgr@demo.delbros.local', 'Email'], ...(urgent ? [['Delbros', 'Paolo Reyes — dispatcher', '+63 917 000 0000', 'SMS']] : []),
    ['Delbros', 'Grace Lim — Credit & Collection (eligibility check)', 'cnc.off1@demo.delbros.local', 'Email'], ...(branch === 'MNL' ? [['Delbros', 'Rocky Santos — Branch Generalist, MNL', 'bg.mnl@demo.delbros.local', 'Email']] as const : []),
    ['Delbros', 'Jasmine Reyes — Account Executive', 'ae.jreyes@demo.delbros.local', 'Email'], ['Client', 'Maria Santos (confirmation)', 'client@abclogistics.ph', 'Email'],
  ] as const).map(([audience, recipient, to, channel]) => ({ at, channel, audience, recipient, to, status: 'Sent' as const }) as EwaDelivery);

  // Portal dashboard review (2026-11-11): the client's own notifications, each linking to the record in the portal.
  const clientNotifications: Db['notifications'] = (() => {
    const abc = 'client@abclogistics.ph';
    const note = (id: string, at: string, title: string, body: string, link: string, read: boolean, userId = abc) => ({ id, at, title, body, link, read, requiresAck: false, userId });
    const rsc41 = onHire[0]?.chassisNo ?? '';
    const back = gatePasses.filter((g) => g.clientCode === 'C-00123' && g.direction === 'IN').sort((a, b) => b.actualEventAt.localeCompare(a.actualEventAt));
    const due1101 = invoices.find((i) => i.invoiceNo === 'INV-MNL-00001101');
    return [
      note('N-CL-8', addHours(now(), -0.9), 'Rescue RSC-000041 received', `${rsc41} · urgent · the dispatcher will call your scene contact to confirm the crew and ETA.`, '/client/rescue?open=RSC-000041', false),
      note('N-CL-7', addHours(now(), -3), 'EWA EU-000781 created', 'MNL · Juan Dela Cruz · NAB 5678 · valid for 24 hours.', '/client/ewa?open=EU-000781', false),
      note('N-CL-6', addHours(now(), -10), 'E-wallet close to the minimum', `Balance ${formatPhp(11951.2)} — below ${formatPhp(12500)} (125% of the ${formatPhp(10000)} minimum). Top up to keep rescue and repair charges covered.`, '/client/ewallet', false),
      note('N-CL-5', ago(1), 'Payment reminder: INV-MNL-00001101', `${formatPhp(due1101?.total)} due ${formatDate(due1101?.dueDate)}.`, '/client/invoices?open=INV-MNL-00001101', false),
      note('N-CL-4', ago(13), 'Invoice INV-MNL-00001102 sent', 'Weekly lease billing — copy sent to billing@example.ph.', '/client/invoices?open=INV-MNL-00001102', true),
      note('N-CL-3', ago(12), 'Debit memo DM-000039 posted', `Park & Fix ABC-CH-2210 — ${formatPhp(2800)}.`, '/client#charges', true),
      ...back.map((g, k) => note(`N-CL-R${k}`, g.actualEventAt, `Unit ${g.chassisNo} returned`, `Gate In ${g.gatePassNo} at ${branches.find((b) => b.code === g.branchCode)?.name ?? g.branchCode}${g.crossBranchCode ? ` (cross-branch, code ${g.crossBranchCode})` : ''}.`, '/client#returns', true)),
      note('N-CL-1', ago(60), `E-wallet deduction ${formatPhp(18048.8)}`, 'Rescue RSC-000020 (debit memo DM-000021) — balance ' + formatPhp(11951.2) + '.', '/client/ewallet', true),
      note('N-PM-1', ago(15), 'Account on hold', 'INV-MNL-00001050 is 31 days past due. New EWAs and rescue requests are blocked until the balance is settled.', '/client/invoices', false, 'client@pacificmovers.ph'),
    ];
  })();

  return {
    version: 4,
    branches, equipmentTypes, users, clients,
    accreditations: [
      { id: 'ACC-1', clientCode: 'C-00244', status: 'Pending C&C', bici: { yearsInOperation: 6, secReg: 'CS2019-00123', tin: '123-456-789-000', bankReferences: 'BPI Pasig — bank certificate attached' }, workflowId: 'WF-ACC-1', submittedAt: ago(3),
        documents: [{ id: 'AD-1', kind: 'SEC / DTI certificate', fileName: 'northstar-sec-cert.pdf', at: ago(3), by: 'AE.JREYES' }, { id: 'AD-2', kind: 'Bank certificate', fileName: 'northstar-bpi-cert.pdf', at: ago(3), by: 'AE.JREYES' }],
        log: [{ at: ago(3), by: 'AE.JREYES', action: 'Resubmitted after rejection' }] },
      { id: 'ACC-R', clientCode: 'C-00244', status: 'Rejected', bici: { yearsInOperation: 6, secReg: 'CS2019-00123', tin: '123-456-789-000', creditScore: 61, grade: 'C', result: 'Recommend', reasoning: 'Acceptable trade references; bank reference pending' }, workflowId: 'WF-ACC-R', submittedAt: ago(14),
        log: [{ at: ago(14), by: 'AE.JREYES', action: 'Submitted for accreditation' }, { at: ago(12), by: 'CNC.OFF1', action: 'C&C investigation (BICI): Approved — Recommend with conditions' }, { at: ago(10), by: 'FINMGR', action: 'Finance endorsement: Rejected — Bank reference not verifiable' }] },
      { id: 'ACC-0', clientCode: 'C-00230', status: 'Approved', bici: { yearsInOperation: 12, secReg: 'CS2008-00456', tin: '222-333-444-000', creditScore: 82, grade: 'A', recommendedTermDays: 30, recommendedLimit: 1500000, result: 'Recommend', reasoning: 'Clean trade and bank references' }, workflowId: 'WF-ACC-0', submittedAt: ago(408),
        activation: { allowLt: true, allowSt: true, allowOnline: true, allowSpecial: true, allowRescue: true, cwsBranchAccess: ['MNL', 'NVL', 'CAV'], creditLimit: 1500000, signOffDate: ago(405).slice(0, 10) } },
    ],
    contracts,
    cashBonds: [
      { id: 'CB-1', clientCode: 'C-00123', contractNo: 'LTL-2026-0045', amount: 20000, dateReceived: ago(205).slice(0, 10), receiptRef: 'OR-MNL-00000301', status: 'Held', withdrawals: [] },
      { id: 'CB-5', clientCode: 'C-00262', contractNo: 'QLP-2026-0003', amount: 20000, dateReceived: ago(205).slice(0, 10), receiptRef: 'OR-MNL-00000300', status: 'Held', withdrawals: [], paymentMethod: 'Bank transfer', receivedBy: 'TREAS' },
      { id: 'CB-2', clientCode: 'C-00188', contractNo: 'SPL-2026-0012', amount: 20000, dateReceived: ago(190).slice(0, 10), receiptRef: 'OR-MNL-00000318', status: 'Held', withdrawals: [] },
      { id: 'CB-3', clientCode: 'C-00201', contractNo: 'LTL-2026-0051', amount: 20000, dateReceived: ago(180).slice(0, 10), receiptRef: 'OR-CEB-00000044', status: 'Withdrawal Pending',
        withdrawals: [{ id: 'CBW-1', amount: 18880, reason: 'Client consolidating fleet; requests early release of the bond', refundable: 18880, workflowId: 'WF-CBW-1', status: 'Pending', requestedAt: ago(2), earlyException: true }] },
    ],
    salesActivities: Array.from({ length: 24 }, (_, i) => ({ id: `SA-${i}`, aeUserId: 'AE.JREYES', clientCode: clients[i % 5].clientCode, type: i % 3 ? 'Call' as const : 'Visit' as const, date: ago(i * 2).slice(0, 10),
      at: ago(i * 2), loggedAt: ago(i * 2 - (i % 5 === 4 ? 3 : 0)), businessType: 'Trucking', location: i % 3 ? 'Phone' : 'Client office, Port Area', outcome: (['Interested', 'Follow-up needed', 'Quote sent'] as const)[i % 3] })),
    chassis,
    assets: [
      // SCR-13 review: PM interval is set per asset (Next PM = last maintenance + interval); PM is suspended while Under Repair.
      { assetId: 'AST-FL-001', category: 'Forklift', description: 'Forklift 3T diesel', branchCode: 'MNL', location: 'Manila Yard — Bay 2', status: 'In-Use', assignedTo: 'Dept: Yard Operations', qty: 1, uom: 'unit', serialNo: 'FD30-8812345', make: 'Toyota', model: '8FD30', condition: 'Good', pmIntervalDays: 84, qrCode: 'QR-AST-FL-001',
        acquisitionDate: ago(800).slice(0, 10), lastMaintenanceDate: ago(80).slice(0, 10), nextPmDate: ahead(4).slice(0, 10), maintenanceLog: [{ date: ago(80).slice(0, 10), type: 'Preventive', notes: '250-hour service: oil, filters, hydraulic check', by: 'APS.OFF' }, { date: ago(164).slice(0, 10), type: 'Preventive', notes: 'Quarterly PM', by: 'APS.OFF' }] },
      { assetId: 'AST-HE-002', category: 'Heavy Equipment', description: 'Reach stacker', branchCode: 'MNL', location: 'Manila Yard — Container stack A', status: 'Available', assignedTo: 'Dept: Yard Operations', qty: 1, uom: 'unit', serialNo: 'RS45-00981', make: 'Kalmar', model: 'DRG450', condition: 'Good', pmIntervalDays: 90, qrCode: 'QR-AST-HE-002',
        acquisitionDate: ago(1200).slice(0, 10), lastMaintenanceDate: ago(30).slice(0, 10), nextPmDate: ahead(60).slice(0, 10), maintenanceLog: [{ date: ago(30).slice(0, 10), type: 'Preventive', notes: '500-hour service', by: 'APS.OFF' }] },
      { assetId: 'AST-WM-003', category: 'Welding Machine', description: 'Inverter welder 300A', branchCode: 'CEB', location: 'Cebu Depot — R&M shop', status: 'Under Repair', assignedTo: 'Dept: Repair & Maintenance', qty: 1, uom: 'unit', serialNo: 'WX300-55120', make: 'Lincoln', model: 'Invertec 300', condition: 'Poor', pmIntervalDays: 60, qrCode: 'QR-AST-WM-003',
        acquisitionDate: ago(600).slice(0, 10), lastMaintenanceDate: ago(10).slice(0, 10), maintenanceLog: [{ date: ago(10).slice(0, 10), type: 'Corrective', notes: 'No arc output — control board sent for repair; PM suspended until returned', by: 'BG.CEB' }] },
      { assetId: 'AST-DT-004', category: 'Depot Tool', description: 'Pneumatic impact wrench 3/4"', branchCode: 'BTG', location: 'Batangas Depot — tool crib', status: 'Available', assignedTo: 'Dept: Repair & Maintenance', qty: 6, uom: 'pc', make: 'Ingersoll Rand', model: '2135TiMAX', condition: 'Fair', pmIntervalDays: 180, qrCode: 'QR-AST-DT-004',
        acquisitionDate: ago(300).slice(0, 10), lastMaintenanceDate: ago(120).slice(0, 10), nextPmDate: ahead(60).slice(0, 10) },
      { assetId: 'AST-ST-005', category: 'Stockroom Tool', description: 'Pallet jack 2.5T', branchCode: 'MNL', location: 'Manila stockroom', status: 'Retired', qty: 1, uom: 'unit', make: 'Generic', model: 'PJ-25', condition: 'Unserviceable', qrCode: 'QR-AST-ST-005', acquisitionDate: ago(2000).slice(0, 10),
        notes: 'Retired after hydraulic pump failure; disposal requested.', disposal: { action: 'Dispose', reason: 'Beyond economic repair — sell as scrap', workflowId: 'WF-AST-1', status: 'Pending Approval', requestedAt: ago(1) } },
      { assetId: 'AST-ST-006', category: 'Stockroom Tool', description: 'Platform scale 300 kg', branchCode: 'CEB', location: 'Cebu stockroom', status: 'Disposed', qty: 1, uom: 'unit', make: 'Generic', model: 'TCS-300', condition: 'Unserviceable', qrCode: 'QR-AST-ST-006', acquisitionDate: ago(2400).slice(0, 10),
        notes: 'Disposed — sold as scrap (approved).', disposal: { action: 'Dispose', reason: 'Load cell failed; replaced by new scale', workflowId: 'WF-00003', status: 'Approved', requestedAt: ago(40) } },
      { assetId: 'AST-ST-007', category: 'Stockroom Tool', description: 'Socket wrench set', branchCode: 'MNL', location: 'Manila stockroom — Shelf C2', status: 'In-Use', assignedTo: 'WH.MNL', qty: 4, uom: 'set', make: 'Stanley', model: 'STMT74181', condition: 'Good', qrCode: 'QR-AST-ST-007', acquisitionDate: ago(400).slice(0, 10) },
    ],
    ewas: [
      { euNo: 'EU-000781', clientCode: 'C-00123', contractNo: 'LTL-2026-0045', branchCode: 'MNL', driverName: 'Juan Dela Cruz', driverLicenseNo: 'N01-23-456789', truckPlateNo: 'NAB 5678', trucker: 'XYZ Trucking',
        units: [{ equipmentType: 'EQ1', qty: 1, usedChassis: [] }], createdAt: addHours(now(), -3), validUntil: addHours(now(), 21), createdVia: 'Portal', status: 'Active', extensionCount: 0, createdBy: 'client@abclogistics.ph',
        // Portal New EWA review (GAT-002 / N08): the full-detail email log shown on the EWA.
        expectedPickupAt: addHours(now(), 2), remarks: 'Driver arrives after lunch; please stage the unit near Gate 2.',
        delivery: ([['Client', 'Maria Santos', 'client@abclogistics.ph'], ['Client', 'ABC Logistics Inc. (company email)', 'accounts@example.ph'], ['Delbros', 'Rocky Santos — Branch Generalist, MNL', 'bg.mnl@demo.delbros.local'], ['Delbros', 'Jasmine Reyes — Account Executive', 'ae.jreyes@demo.delbros.local']] as const)
          .map(([audience, recipient, to]) => ({ at: addHours(now(), -3), channel: 'Email' as const, audience, recipient, to, status: 'Sent' as const })) },
      // Expired portal EWA so the client portal shows the "Request extension" path (portal review, DBL-GAT-003).
      { euNo: 'EU-000770', clientCode: 'C-00123', contractNo: 'LTL-2026-0045', branchCode: 'MNL', driverName: 'Mario Reyes', driverLicenseNo: 'N02-15-334455', truckPlateNo: 'NAB 5679', trucker: 'XYZ Trucking',
        units: [{ equipmentType: 'EQ2', qty: 1, usedChassis: [] }], createdAt: addHours(now(), -40), validUntil: addHours(now(), -16), createdVia: 'Portal', status: 'Expired', extensionCount: 0, createdBy: 'client@abclogistics.ph' },
      // Review 1.1: the cancelled EWA in the Audit log is EU-000765 (not EU-000770, which simply expired) — shown with the Cancelled status in the portal.
      { euNo: 'EU-000765', clientCode: 'C-00123', contractNo: 'LTL-2026-0045', branchCode: 'CAV', driverName: 'Ramil Santos', driverLicenseNo: 'N04-18-998877', truckPlateNo: 'NAB 5612', trucker: 'XYZ Trucking',
        units: [{ equipmentType: 'EQ1', qty: 1, usedChassis: [] }], createdAt: addHours(now(), -60), validUntil: addHours(now(), -36), createdVia: 'Portal', status: 'Cancelled', extensionCount: 0, createdBy: 'client@abclogistics.ph',
        cancelledAt: addHours(now(), -58), cancelledBy: 'BG.MNL', cancelReason: 'Client cancelled the pickup — trucker unavailable' },
      { euNo: 'EU-000779', clientCode: 'C-00230', contractNo: 'LTL-2026-0060', branchCode: 'MNL', driverName: 'Pedro Penduko', driverLicenseNo: 'N02-11-000111', truckPlateNo: 'NCR 1122', trucker: 'Metro Haul',
        units: [{ equipmentType: 'EQ2', qty: 2, usedChassis: [] }], createdAt: addHours(now(), -30), validUntil: addHours(now(), -6), createdVia: 'Internal', status: 'Expired', extensionCount: 0, createdBy: 'AE.JREYES' },
      { euNo: 'EU-000776', clientCode: 'C-00201', contractNo: 'LTL-2026-0051', branchCode: 'CEB', driverName: 'Ramon Cruz', driverLicenseNo: 'G03-19-224466', truckPlateNo: 'GAB 3301', trucker: 'Visayas Trucking',
        units: [{ equipmentType: 'EQ3', qty: 1, usedChassis: [] }], createdAt: addHours(now(), -32), validUntil: addHours(now(), -8), createdVia: 'Internal', status: 'Extension Pending', extensionCount: 0, createdBy: 'AE.JREYES' },
      ...histEwas,
    ],
    gatePasses, eirs, lateEncodings,
    jobOrders: [
      { joNo: 'JO-MNL-000512', chassisNo: breakdown.chassisNo, branchCode: breakdown.branchCode, source: 'Gate In', categories: ['Tires', 'Brakes'], notes: 'Two flat tires, worn brake lining found at gate-in inspection.', workers: ['Laborer A', 'Laborer B'],
        status: 'Draft', isMajor: false, chargeable: true, bom: [], labor: [], createdAt: ago(1), createdBy: 'BG.MNL' },
      { joNo: 'JO-MNL-000498', chassisNo: inRepair.chassisNo, branchCode: inRepair.branchCode, source: 'Scheduled', categories: ['Painting', 'Electrical'], notes: 'Scheduled repaint and lamp replacement.', workers: ['Laborer C'],
        status: 'Ongoing', isMajor: false, chargeable: false, bom: [{ partCode: 'PNT-PRIM', description: 'Primer paint (gal)', qty: 3, unitCost: 1350 }, { partCode: 'ELC-LAMP', description: 'Tail lamp assembly', qty: 2, unitCost: 950 }],
        labor: [{ worker: 'Laborer C', hours: 6, rate: 95, date: ago(2).slice(0, 10), shift: 'Morning' }], createdAt: ago(5), createdBy: 'BG.MNL', approvedBy: 'BG.MNL', confirmedBy: 'DYM.MNL' },
      { joNo: 'JO-MNL-000470', chassisNo: chassis[0].chassisNo, branchCode: chassis[0].branchCode, source: 'Gate In', categories: ['Suspension'], notes: 'Leaf spring replaced.', workers: ['Laborer A'],
        status: 'Closed by R&M', isMajor: false, chargeable: false, bom: [{ partCode: 'SUS-LEAF', description: 'Leaf spring assembly', qty: 1, unitCost: 9800 }], labor: [{ worker: 'Laborer A', hours: 4, rate: 95, date: ago(12).slice(0, 10), shift: 'Morning' }, { worker: 'Laborer B', hours: 3, rate: 110, date: ago(12).slice(0, 10), shift: 'Afternoon' }], createdAt: ago(14), createdBy: 'BG.MNL', closedAt: ago(11) },
    ],
    rescues: [
      // Portal Rescue review: a request on its way (Dispatched) with crew, vehicle, driver, ETA, the status times and who was notified.
      ...(rsc42Unit ? [{ rescueNo: 'RSC-000042', clientCode: 'C-00123', chassisNo: rsc42Unit.chassisNo, locationText: 'STAR Tollway southbound km 82, near Lipa exit', incident: 'Tail and brake lights not working after a hard bump', sceneContactName: 'Ramil Santos', sceneContactPhone: '+63 917 444 1212',
        urgent: false, status: 'Dispatched' as const, requestedAt: addHours(now(), -0.9), requestedVia: 'Portal' as const, branchCode: rsc42Unit.branchCode, chargeable: true, problemType: 'Electrical / lights', loadStatus: 'Loaded' as const,
        verifiedBy: 'CNC.OFF1', confirmedBy: 'AE.JREYES', crew: 'In-house crew', rescueVehicle: 'Service van NCR 4521', driverName: 'Romeo Santos', driverPhone: '+63 917 555 0101', dispatchedAt: addHours(now(), -0.55), eta: addHours(now(), 0.45),
        statusLog: [{ status: 'Requested', at: addHours(now(), -0.9), by: 'client@abclogistics.ph' }, { status: 'Verified', at: addHours(now(), -0.8), by: 'CNC.OFF1' }, { status: 'Confirmed', at: addHours(now(), -0.7), by: 'AE.JREYES' }, { status: 'Dispatched', at: addHours(now(), -0.55), by: 'OPSMGR' }],
        notified: rescueNotes(addHours(now(), -0.9), false, rsc42Unit.branchCode) }] : []),
      { rescueNo: 'RSC-000041', clientCode: 'C-00123', chassisNo: onHire[0]?.chassisNo ?? '', locationText: 'SLEX northbound km 32, near Sta. Rosa exit', incident: 'Blown tire, rear axle', sceneContactName: 'Juan Dela Cruz', sceneContactPhone: '+63 917 222 3344',
        urgent: true, status: 'Requested', requestedAt: addHours(now(), -1), requestedVia: 'Portal', branchCode: 'MNL', chargeable: true,
        problemType: 'Flat / blown tire', loadStatus: 'Loaded', photos: ['rsc41-blown-tire.jpg', 'rsc41-location.jpg'], notified: rescueNotes(addHours(now(), -1), true) }, // review 1.1: load status was blank
      // Review 1.1: RSC-000020 is the ₱18,048.80 e-wallet deduction (EWT-2). BR-11: travel 20 km × 2 × ₱50 = 2,000 + parts 12,650 (BRK-DRUM 8,280 + BRK-PAD 4,370)
      // = 14,650 + 10% service 1,465 = 16,115 + 12% VAT 1,933.80 = 18,048.80.
      // Portal Rescue review: RSC-000020 (60 days ago) was on the unit hired under MNL0880 (75 → 35 days ago), not on a unit hired since October.
      { rescueNo: 'RSC-000020', clientCode: 'C-00123', chassisNo: gatePasses.find((g) => g.gatePassNo === 'MNL0880')?.chassisNo ?? onHire[0]?.chassisNo ?? '', locationText: 'NLEX northbound km 40, Marilao', incident: 'Brake drum cracked, rear axle locking',
        sceneContactName: 'Juan Dela Cruz', sceneContactPhone: '+63 917 222 3344', urgent: false, status: 'Completed', requestedAt: addHours(ago(60), -5), requestedVia: 'Portal', branchCode: 'MNL', problemType: 'Brake problem',
        verifiedBy: 'CNC.OFF1', confirmedBy: 'AE.JREYES', crew: 'In-house crew', rescueVehicle: 'Service van NCR 4521', driverName: 'Romeo Santos', driverPhone: '+63 917 555 0101',
        dispatchedAt: addHours(ago(60), -4.5), eta: addHours(ago(60), -3.5), completedAt: addHours(ago(60), -1),
        chargeable: true, oneWayKm: 20, ratePerKm: 50, tireCost: 0, partsCost: 12650, total: 18048.8, debitMemoNo: 'DM-000021', loadStatus: 'Empty', photos: ['rsc20-brake.jpg'],
        costLines: [{ kind: 'Part', partCode: 'BRK-DRUM', description: 'Brake drum', qty: 1, unitPrice: 8280 }, { kind: 'Part', partCode: 'BRK-PAD', description: 'Brake lining set', qty: 1, unitPrice: 4370 }],
        onsiteAssessment: 'Cracked rear brake drum; drum and lining replaced on site.', beforePhotos: ['rsc20-before.jpg'], afterPhotos: ['rsc20-after.jpg'], clientAckName: 'Juan Dela Cruz', acknowledgedAt: addHours(ago(60), -1), ewalletBalanceAfter: 11951.2 },
      { rescueNo: 'RSC-000038', clientCode: 'C-00230', chassisNo: onHire[3]?.chassisNo ?? '', locationText: 'C5 Road, Taguig', incident: 'Brake lock', sceneContactName: 'Pedro Penduko', sceneContactPhone: '+63 917 111 2233',
        urgent: false, status: 'Completed', requestedAt: ago(6), requestedVia: 'Internal', branchCode: 'MNL', crew: 'Roadside Rescue Partners', dispatchedAt: addHours(ago(6), 0.5), completedAt: addHours(ago(6), 3.25),
        // BR-11: travel 18 km × 2 × ₱50 = 1,800 + parts 4,370 (BRK-PAD rescue price) = 6,170 + 10% = 6,787 + 12% VAT = 7,601.44
        chargeable: true, oneWayKm: 18, ratePerKm: 50, tireCost: 0, partsCost: 4370, total: 7601.44, debitMemoNo: 'DM-000040', verifiedBy: 'CNC.OFF1', confirmedBy: 'AE.JREYES',
        loadStatus: 'Loaded', photos: ['brake-lock-scene.jpg'], rescueVehicle: 'Service van NCR 4521', driverName: 'Romeo Santos', driverPhone: '+63 917 555 0101',
        costLines: [{ kind: 'Part', partCode: 'BRK-PAD', description: 'Brake lining set', qty: 1, unitPrice: 4370 }], onsiteAssessment: 'Rear brake seized; lining replaced on site, unit driven to yard.',
        beforePhotos: ['rsc38-before-1.jpg'], afterPhotos: ['rsc38-after-1.jpg'], clientAckName: 'Pedro Penduko', acknowledgedAt: addHours(ago(6), 3.25), ewalletBalanceAfter: 9398.56 },
      { rescueNo: 'RSC-000040', clientCode: 'C-00123', chassisNo: onHire[5]?.chassisNo ?? '', locationText: 'NLEX southbound km 21, Valenzuela', incident: 'Flat tire, front axle', sceneContactName: 'Mark Villanueva', sceneContactPhone: '+63 917 333 4455',
        // Portal Rescue review: problem type recorded (it was blank on this cancelled request).
        problemType: 'Flat / blown tire',
        urgent: true, status: 'Cancelled', requestedAt: ago(2), requestedVia: 'Portal', branchCode: onHire[5]?.branchCode ?? 'MNL', chargeable: true, loadStatus: 'Empty', urgentAckBy: 'OPSMGR', urgentAckAt: addHours(ago(2), 0.2),
        cancelReason: 'Client driver fixed the tire on site; rescue no longer needed.', cancelledBy: 'OPSMGR', cancelledAt: addHours(ago(2), 0.75) },
      // Hold client blocked at intake (BR-01): logged for audit, never reaches C&C verification.
      { rescueNo: 'RSC-000037', clientCode: 'C-00188', chassisNo: onHire[1]?.chassisNo ?? '', locationText: 'Marcos Highway, Antipolo', incident: 'Air leak, brakes locked', sceneContactName: 'Leo Navarro', sceneContactPhone: '+63 917 777 8899',
        urgent: false, status: 'Blocked', blockedReason: 'Pacific Movers Corp. is ON HOLD for overdue balance. Chassis release, gate pass, repair scheduling and new services are blocked (BR-01).', blockedAt: addHours(now(), -5), requestedAt: addHours(now(), -5), requestedVia: 'Internal', branchCode: onHire[1]?.branchCode ?? 'MNL', chargeable: true, loadStatus: 'Loaded', problemType: 'Brake problem' }, // phoned in; the portal refuses requests while on hold
      { rescueNo: 'RSC-000039', clientCode: 'C-00201', chassisNo: onHire[2]?.chassisNo ?? '', locationText: 'CAVITEX km 14, Kawit', incident: 'Landing leg damaged, cannot detach', sceneContactName: 'Ramon Cruz', sceneContactPhone: '+63 917 444 5566',
        urgent: false, status: 'Dispatched', requestedAt: addHours(now(), -3), requestedVia: 'Internal', branchCode: onHire[2]?.branchCode ?? 'CEB', chargeable: true, loadStatus: 'Loaded', verifiedBy: 'CNC.OFF1', confirmedBy: 'AE.JREYES',
        crew: 'In-house crew', rescueVehicle: 'Wrecker CAV-02 (NBC 7788)', driverName: 'Jun Reyes', driverPhone: '+63 917 666 7788', dispatchedAt: addHours(now(), -2.5) },
    ],
    parts, stock, stockTxns,
    vendors,
    prs: [{ prNo: 'PR-000210', department: 'Operations', requestedBy: 'BG.MNL', justification: 'Replenish tires for rescue and repair stock (low stock).', entityCode: 'DBL', lines: [{ partCode: 'TIR-1100', description: 'Tire 11R22.5 radial', qty: 20, estUnitCost: 14500, uom: 'pc', standardCost: 14500, supplierId: 'V-001' }], status: 'For Approval', workflowId: 'WF-PR-1', createdAt: ago(2),
      supplierId: 'V-001', neededBy: ahead(10).slice(0, 10), priority: 'Urgent', deliveryWarehouse: 'WH-MNL', stockRef: 'Low stock · TIR-1100 @ WH-MNL', attachments: ['quote-tirepro-2026-10.pdf'] }],
    pos: [{ poNo: 'PO-000155', prNo: 'PR-000190', vendorId: 'V-002', terms: '15 days', deliveryDate: ahead(5).slice(0, 10), entityCode: 'DBL', status: 'Issued', createdAt: ago(10), lines: [{ partCode: 'BRK-PAD', description: 'Brake lining set', qty: 30, unitPrice: 3700, qtyReceived: 0 }, { partCode: 'BRK-DRUM', description: 'Brake drum', qty: 10, unitPrice: 7000, qtyReceived: 0 }] },
      // One open PO for the demo vendor (vendor@tirepro.ph) so the portal upload-invoice dialog can be shown.
      { poNo: 'PO-000154', prNo: 'PR-000189', vendorId: 'V-001', terms: '30 days', deliveryDate: ahead(7).slice(0, 10), entityCode: 'DBL', status: 'Issued', createdAt: ago(6), lines: [{ partCode: 'TIR-1100', description: 'Tire 11R22.5 radial', qty: 8, unitPrice: 14500, qtyReceived: 0 }] }],
    rrs: [], vendorInvoices: [{ id: 'VI-1', vendorId: 'V-002', invoiceNo: 'ABP-2026-0911', invoiceDate: ago(1).slice(0, 10), amount: 181000, poNo: 'PO-000155', status: 'Under Review', submittedVia: 'Internal', submittedAt: ago(1) }],
    paymentRequests: [{ docNo: 'PCV-000088', type: 'PCV', referenceType: 'Justification', referenceId: '-', justification: 'Urgent fuses and tape for gate lighting', payee: 'Local hardware', amount: 1850, dueDate: ahead(2).slice(0, 10), entityCode: 'DBL', status: 'Approved', createdAt: ago(1),
      department: 'Operations', requestedBy: 'BG.MNL', fundingSource: 'Petty Cash Fund', lines: [{ description: 'Fuses (box of 10)', category: 'Repairs & maintenance supplies', amount: 650 }, { description: 'Electrical tape and wire nuts', category: 'Repairs & maintenance supplies', amount: 1200 }] }],
    invoices,
    receipts: [...billingReceipts,
      // DBL-EWL-001 demo: Treasury-cleared PR for Southern Haulers' initial e-wallet funding (no wallet yet)
      { receiptNo: 'PR-BTG-00000072', type: 'PR', clientCode: 'C-00215', date: ago(1).slice(0, 10), amount: 15000, method: 'Bank transfer', reference: 'BPI 778120', applications: [], unapplied: 15000, by: 'TREAS', status: 'Cleared', clearedBy: 'TREAS', clearedAt: ago(1).slice(0, 10), notes: 'Initial e-wallet funding (DBL-EWL-001)' }],
    memos: [...billingMemos, { memoNo: 'DM-000021', type: 'Debit', clientCode: 'C-00123', referenceType: 'Rescue', referenceId: 'RSC-000020', amount: 18048.8, reason: 'Rescue charge (BR-11)', status: 'Posted', createdAt: ago(60) }, { memoNo: 'DM-000039', type: 'Debit', clientCode: 'C-00123', referenceType: 'Park & Fix', referenceId: 'PF-2', amount: 2800, reason: 'Park & Fix ABC-CH-2210 — 8 day(s) × ₱350 (DBL-ALO-005)', status: 'Posted', createdAt: ago(12) }, { memoNo: 'DM-000040', type: 'Debit', clientCode: 'C-00230', referenceType: 'Rescue', referenceId: 'RSC-000038', amount: 7601.44, reason: 'Rescue charge (BR-11)', status: 'Posted', createdAt: ago(6) }],
    holdEvents: [{ id: 'HE-1', clientCode: 'C-00188', type: 'Auto Hold', at: ago(15), by: 'system', outstanding: 308000, daysOverdue: 31, invoiceNo: 'INV-MNL-00001050', reason: 'Invoice INV-MNL-00001050 unpaid 31 days past due (BR-02)' }],
    collections: [
      { clientCode: 'C-00188', stage: '2nd Reminder', stageChangedAt: ago(4), nextActionDue: ahead(6).slice(0, 10), acknowledgedAt: ago(13), soaSends: [{ id: 'SS-1', soaNo: 'SOA-2026-00301', at: ago(14), by: 'CNC.OFF1', channel: 'Email', to: 'ap@pacificmovers.ph' }],
        actions: [{ at: ago(4), action: '2nd Reminder', by: 'system' }, { at: ago(9), action: '1st Reminder', by: 'system' }, { at: ago(13), action: 'SOA acknowledged by client', by: 'CNC.OFF1' }, { at: ago(14), action: 'SOA Sent', by: 'CNC.OFF1', notes: 'SOA-2026-00301 by email' }] },
      { clientCode: 'C-00215', stage: 'SOA Sent', stageChangedAt: ago(7), nextActionDue: ago(2).slice(0, 10), soaSends: [{ id: 'SS-2', soaNo: 'SOA-2026-00310', at: ago(7), by: 'CNC.OFF1', channel: 'Courier', to: 'Southern Haulers Co., Batangas City', trackingNo: 'LBC 7781-2201' }],
        actions: [{ at: ago(7), action: 'SOA Sent', by: 'CNC.OFF1', notes: 'SOA-2026-00310 by courier' }] },
    ],
    ewallets: [
      { clientCode: 'C-00123', balance: 11951.2, minimumBalance: 10000, createdAt: ago(200), createdBy: 'ACCTG', receiptNo: 'OR-MNL-00000290', clearedDate: ago(200).slice(0, 10), paymentMethod: 'Bank transfer', bankRef: 'BDO 003311', treasuryRef: 'TRS-2026-0112', treasuryConfirmedBy: 'TREAS', treasuryConfirmedAt: ago(200) },
      { clientCode: 'C-00188', balance: -2500, minimumBalance: 10000, createdAt: ago(190) },
      { clientCode: 'C-00201', balance: 45000, minimumBalance: 10000, createdAt: ago(170) },
      { clientCode: 'C-00230', balance: 9398.56, minimumBalance: 10000, createdAt: ago(150) },
      { clientCode: 'C-00262', balance: 2350, minimumBalance: 10000, createdAt: ago(200) },
    ],
    ewalletTxns: [
      { id: 'EWT-1', clientCode: 'C-00123', at: ago(200), type: 'Replenishment', amount: 30000, balanceAfter: 30000, referenceType: 'Top-up', referenceId: 'OR-MNL-00000290', receiptNo: 'OR-MNL-00000290', treasuryRef: 'TRS-2026-0112', category: 'Top-up', reason: 'Initial funding (Treasury confirmed)', by: 'ACCTG' },
      { id: 'EWT-2', clientCode: 'C-00123', at: ago(60), type: 'Deduction', amount: -18048.8, balanceAfter: 11951.2, referenceType: 'Rescue', referenceId: 'RSC-000020', category: 'Rescue', by: 'system' },
      // Portal E-wallet review: DM-000039 was first deducted, then reversed at the client's request — it will be billed on an invoice instead.
      { id: 'EWT-10', clientCode: 'C-00123', at: ago(11.5), type: 'Deduction', amount: -2800, balanceAfter: 9151.2, referenceType: 'Debit Memo', referenceId: 'DM-000039', category: 'Debit Memo', by: 'ACCTG', reversedById: 'EWT-11' },
      { id: 'EWT-11', clientCode: 'C-00123', at: ago(11), type: 'Reversal', amount: 2800, balanceAfter: 11951.2, referenceType: 'Reversal', referenceId: 'EWT-10', reversesId: 'EWT-10', category: 'Reversal', reason: 'Client asked to settle DM-000039 on its next invoice instead — deduction reversed', by: 'ACCTG' },
      { id: 'EWT-12', clientCode: 'C-00262', at: ago(200), type: 'Replenishment', amount: 10000, balanceAfter: 10000, referenceType: 'Top-up', referenceId: 'OR-MNL-00000299', receiptNo: 'OR-MNL-00000299', category: 'Top-up', reason: 'Initial funding (Treasury confirmed)', by: 'ACCTG' },
      { id: 'EWT-13', clientCode: 'C-00262', at: ago(90), type: 'Deduction', amount: -7650, balanceAfter: 2350, referenceType: 'Repair', referenceId: 'JO-NVL-000077', category: 'Repair', reason: 'Chargeable tire replacement', by: 'system' },
      { id: 'EWT-3', clientCode: 'C-00230', at: ago(150), type: 'Replenishment', amount: 17000, balanceAfter: 17000, referenceType: 'Top-up', referenceId: 'OR-MNL-00000305', receiptNo: 'OR-MNL-00000305', treasuryRef: 'TRS-2026-0140', category: 'Top-up', by: 'ACCTG' },
      { id: 'EWT-4', clientCode: 'C-00230', at: ago(6), type: 'Deduction', amount: -7601.44, balanceAfter: 9398.56, referenceType: 'Debit Memo', referenceId: 'DM-000040', category: 'Rescue', by: 'system' },
      { id: 'EWT-5', clientCode: 'C-00188', at: ago(190), type: 'Replenishment', amount: 10000, balanceAfter: 10000, referenceType: 'Top-up', referenceId: 'OR-MNL-00000317', receiptNo: 'OR-MNL-00000317', treasuryRef: 'TRS-2026-0128', category: 'Top-up', by: 'ACCTG' },
      { id: 'EWT-6', clientCode: 'C-00188', at: ago(40), type: 'Deduction', amount: -12500, balanceAfter: -2500, referenceType: 'Rescue', referenceId: 'RSC-000029', category: 'Rescue', by: 'system' },
      { id: 'EWT-7', clientCode: 'C-00201', at: ago(170), type: 'Replenishment', amount: 45000, balanceAfter: 45000, referenceType: 'Top-up', referenceId: 'OR-CEB-00000040', receiptNo: 'OR-CEB-00000040', treasuryRef: 'TRS-2026-0151', category: 'Top-up', by: 'ACCTG' },
      { id: 'EWT-8', clientCode: 'C-00201', at: ago(30), type: 'Deduction', amount: -5200, balanceAfter: 39800, referenceType: 'Repair', referenceId: 'JO-MNL-000470', category: 'Repair', by: 'system', reversedById: 'EWT-9' },
      { id: 'EWT-9', clientCode: 'C-00201', at: ago(29), type: 'Reversal', amount: 5200, balanceAfter: 45000, referenceType: 'Reversal', referenceId: 'EWT-8', reversesId: 'EWT-8', category: 'Reversal', reason: 'Posted against a non-chargeable JO (JO-MNL-000470) - reversed', by: 'ACCTG' },
    ],
    topups: [
      { id: 'TU-000003', clientCode: 'C-00230', amount: 20000, proofFileName: 'bank-transfer.pdf', status: 'Submitted', submittedAt: ago(0.2), paymentRef: 'TRX-20261111-0193', method: 'Bank transfer (InstaPay)', sendingBank: 'Client bank', transferDate: ago(0.3).slice(0, 10) },
      // Portal top-up review: a rejected request with its reason — the client can resubmit it with the corrected details.
      { id: 'TU-000002', clientCode: 'C-00123', amount: 5000, proofFileName: 'transfer-oct21.png', status: 'Rejected', submittedAt: ago(20), paymentRef: 'TRX-20261021-0042', method: 'Bank transfer (PESONet)', sendingBank: 'Client bank', transferDate: ago(20).slice(0, 10),
        rejectedBy: 'TREAS', rejectedAt: ago(19), rejectReason: 'No matching credit in the Delbros account for this reference and amount. Check the reference on your bank confirmation and resubmit.' },
    ],
    registrations,
    workflows: [...workflows, {
      id: 'WF-PR-1', matrixCode: 'PR_PO', title: 'Purchase request PR-000210 — tires', subjectType: 'pr', subjectId: 'PR-000210', amount: 290000, requestedBy: 'BG.MNL', requestedAt: ago(2), status: 'Pending', currentStep: 0,
      steps: [
        { step: 1, label: 'Department Head', roles: ['DEPT_HEAD'], decision: 'Pending', dueAt: ahead(0.5) },
        { step: 2, label: 'Admin Department', roles: ['APS_MANAGER'], decision: 'Pending' },
        { step: 3, label: 'APS processing', roles: ['APS_OFFICER'], decision: 'Pending' },
        { step: 4, label: 'Final approval — CEO + CHRO (> ₱250,000)', roles: ['CEO', 'CHRO'], decision: 'Pending' },
      ],
    }, ...adminWorkflows],
    notificationRules,
    notifications: [...clientNotifications, ...adminNotifications],
    audit: [
      { id: 'A-EWA-765', at: addHours(now(), -58), actor: 'BG.MNL', action: 'ewa.cancelled', entityType: 'ewa', entityId: 'EU-000765', branchCode: 'CAV', before: { status: 'Active' }, after: { status: 'Cancelled' }, reason: 'Client cancelled the pickup — trucker unavailable', source: 'Staff app' },
      { id: 'A-EWA-770', at: addHours(now(), -16), actor: 'system', action: 'ewa.expired', entityType: 'ewa', entityId: 'EU-000770', branchCode: 'MNL', before: { status: 'Active' }, after: { status: 'Expired', lapsedUnits: 1 }, reason: 'Validity ended (BR-06)', source: 'System' },
      { id: 'A-1', at: ago(15), actor: 'system', action: 'client.hold.applied', entityType: 'client', entityId: 'C-00188', after: { status: 'Hold' }, reason: 'Invoice INV-MNL-00001050 unpaid 31 days past due (BR-02)' }],
    settings: DEFAULT_SETTINGS.map((s) => ({ ...s })),
    // Park & Fix stores CLIENT-OWNED trailers (not in the Delbros fleet, so never in Available / DCIR fleet totals).
    parkFix: [
      { id: 'PF-1', chassisNo: 'MCL-TRL-0458', clientOwned: true, chassisType: 'EQ2', plateNo: 'NBC 4581', clientCode: 'C-00230', branchCode: 'MNL', parkInAt: ago(4), reason: 'Idle', service: 'Park only', dailyRate: 350, status: 'Parked',
        expectedParkOut: ahead(10).slice(0, 10), inReceiptNo: 'PFR-IN-000001', billingStatus: 'Unbilled',
        parkIn: { trucker: 'Metro Haul', truckPlateNo: 'NCR 1122', driverName: 'Pedro Penduko', driverLicenseNo: 'N02-11-000111', inspection: [{ part: 'Tires', statusCode: 'OK', qty: 8, chargeable: 0 }, { part: 'Lights & wiring', statusCode: 'DMG', qty: 1, chargeable: 0 }, { part: 'Landing legs', statusCode: 'OK', qty: 2, chargeable: 0 }], by: 'BG.MNL' } },
      { id: 'PF-2', chassisNo: 'ABC-CH-2210', clientOwned: true, chassisType: 'EQ1', plateNo: 'NAB 2210', clientCode: 'C-00123', branchCode: 'MNL', parkInAt: ago(20), parkOutAt: ago(12), reason: 'Client Request', service: 'Park only', dailyRate: 350, status: 'Released',
        inReceiptNo: 'PFR-IN-000000', outReceiptNo: 'PFR-OUT-000000', billingStatus: 'Billed', debitMemoNo: 'DM-000039', billedAmount: 2800,
        parkIn: { trucker: 'XYZ Trucking', truckPlateNo: 'NAB 5600', driverName: 'Juan Dela Cruz', driverLicenseNo: 'N01-23-456789', inspection: [{ part: 'Tires', statusCode: 'WRN', qty: 8, chargeable: 0 }], by: 'BG.MNL' },
        parkOut: { trucker: 'XYZ Trucking', truckPlateNo: 'NAB 5600', driverName: 'Juan Dela Cruz', driverLicenseNo: 'N01-23-456789', inspection: [{ part: 'Tires', statusCode: 'OK', qty: 8, chargeable: 0 }], by: 'BG.MNL' } },
    ],
    unitRequests: [
      { reqNo: 'UR-000031', clientCode: 'C-00123', contractNo: 'LTL-2026-0045', branchCode: 'MNL', equipmentType: 'EQ1', qty: 2, targetPickupDate: ahead(2).slice(0, 10), requiredParts: 'Twist locks ×4 (client spec)', allocated: [], status: 'Open', createdAt: ago(1), createdBy: 'AE.JREYES' },
      { reqNo: 'UR-000030', clientCode: 'C-00201', contractNo: 'LTL-2026-0051', branchCode: 'CEB', equipmentType: 'EQ8', qty: 1, targetPickupDate: ahead(5).slice(0, 10), allocated: [], status: 'Open', createdAt: ago(2), createdBy: 'AE.JREYES' },
      { reqNo: 'UR-000029', clientCode: 'C-00188', contractNo: 'SPL-2026-0012', branchCode: 'MNL', equipmentType: 'EQ2', qty: 1, targetPickupDate: ahead(1).slice(0, 10), notes: 'Client on credit hold — cannot allocate until lifted.', allocated: [], status: 'Open', createdAt: ago(3), createdBy: 'AE.JREYES' },
      { reqNo: 'UR-000028', clientCode: 'C-00215', contractNo: 'QLP-2026-0007', branchCode: 'BTG', equipmentType: 'EQ5', qty: 1, targetPickupDate: ahead(7).slice(0, 10), requiredParts: 'Extra spare tire', allocated: [], status: 'Open', createdAt: ago(4), createdBy: 'AE.JREYES' },
    ],
    crossBranchCodes: crossBranch,
    contractRequests: [
      { id: 'CRQ-000001', clientCode: 'C-00123', contractNo: 'LTL-2026-0045', kind: 'Amendment', changeArea: 'Branches covered', details: 'Add Batangas, Clark and Cagayan de Oro — our trucks now pick up from these depots.',
        status: 'Approved', submittedAt: ago(160), submittedBy: 'client@abclogistics.ph', decidedAt: ago(155), decidedBy: 'AE.JREYES', decisionNote: 'Branches added to the account (CWS access); rates unchanged.' },
    ],
    seq: { EU: 781, GP: 2000, EIR: 500, JO: 520, RSC: 42, TU: 3, CRQ: 1, INV: 1200, OR: 460, CM: 10, DM: 40, PR: 210, PO: 155, RR: 60, RFP: 30, PCV: 88, CT: 70, CL: 260, WF: 10, LE: 1, SOA: 318, STK: 120,EWT: 10, HL: 1 },
  };
}
