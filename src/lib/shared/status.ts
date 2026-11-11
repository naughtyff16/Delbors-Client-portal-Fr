// Single source of truth for status → tone (docs/03-design-system.md §5).
export type Tone = 'success' | 'warning' | 'danger' | 'danger-solid' | 'info' | 'neutral' | 'purple' | 'brand';

export type StatusDomain =
  | 'client' | 'accreditation' | 'contract' | 'chassis' | 'assessment' | 'ewa' | 'jo' | 'rescue' | 'invoice'
  | 'payment' | 'collection' | 'registration' | 'approval' | 'po' | 'generic' | 'asset' | 'memo' | 'topup' | 'receipt';

const MAP: Record<StatusDomain, Record<string, Tone>> = {
  client: { Active: 'success', Draft: 'neutral', Hold: 'danger', Blacklist: 'danger-solid', Inactive: 'neutral' },
  accreditation: { Draft: 'neutral', 'Pending C&C': 'warning', 'Pending Finance': 'warning', 'Pending VP': 'warning', Approved: 'success', Rejected: 'danger' },
  contract: { Draft: 'neutral', Printed: 'warning', 'Sent to Client': 'info', Signed: 'warning', 'For Notarisation': 'warning', Notarized: 'info', Active: 'success', Expiring: 'warning', Expired: 'danger', Renewed: 'purple', Terminated: 'neutral', 'Pending Approval': 'warning' },
  chassis: {
    New: 'brand', Available: 'success', 'Off Hire': 'success', Allocated: 'info', 'On Hire': 'info', Breakdown: 'danger',
    Unaccounted: 'danger', 'In Repair': 'warning', Rescue: 'warning', Parked: 'purple', Legal: 'purple',
    Converted: 'neutral', Sold: 'neutral', Killed: 'neutral',
  },
  assessment: { Roadworthy: 'success', Unroadworthy: 'danger' },
  ewa: { Active: 'info', Used: 'neutral', 'Partially Used': 'info', Expired: 'neutral', 'Extension Pending': 'warning', Cancelled: 'neutral' },
  jo: { Draft: 'neutral', Approved: 'info', Confirmed: 'info', Ongoing: 'warning', 'On Hold': 'danger', 'Closed by R&M': 'success', 'Closed by EIR Out': 'success' },
  rescue: { Requested: 'warning', Verified: 'info', Confirmed: 'info', Dispatched: 'info', 'In Progress': 'info', Completed: 'success', Cancelled: 'neutral', Blocked: 'danger' },
  invoice: { Draft: 'neutral', Finalized: 'info', Sent: 'info' },
  payment: { Unpaid: 'warning', 'Partially Paid': 'warning', Paid: 'success', Overdue: 'danger', Credited: 'info', Cancelled: 'neutral' },
  receipt: { Provisional: 'warning', Cleared: 'info', 'OR Issued': 'success', Bounced: 'danger', Cancelled: 'neutral' },
  collection: { None: 'neutral', 'SOA Sent': 'info', '1st Reminder': 'warning', '2nd Reminder': 'warning', 'Demand Letter': 'danger' },
  registration: { Current: 'success', Registered: 'success', Pending: 'neutral', Expiring: 'warning', 'Renewal In Progress': 'info', Expired: 'danger-solid' },
  approval: { Pending: 'warning', Approved: 'success', Rejected: 'danger', Escalated: 'warning', Skipped: 'neutral', Cancelled: 'neutral', 'Not started': 'neutral' },
  po: { Draft: 'neutral', 'For Approval': 'warning', Approved: 'info', Issued: 'info', Converted: 'info', 'Partially Received': 'warning', Received: 'success', Paid: 'success', 'On Hold': 'danger', Closed: 'neutral', Cancelled: 'neutral', Rejected: 'danger', Submitted: 'warning', 'Under Review': 'warning' },
  asset: { Available: 'success', 'In-Use': 'info', 'Under Repair': 'warning', Retired: 'neutral', Disposed: 'neutral', 'Pending Approval': 'warning' },
  memo: { 'Pending Approval': 'warning', Posted: 'success', Rejected: 'danger', Approved: 'info', 'Pending': 'warning', Draft: 'neutral', Applied: 'success' },
  topup: { Submitted: 'warning', 'Confirmed by Treasury': 'info', Posted: 'success', Rejected: 'danger' },
  generic: { Active: 'success', Inactive: 'neutral', Parked: 'purple', Released: 'success', 'Parked out': 'success', Billed: 'info', Unbilled: 'warning', Yes: 'success', No: 'neutral' },
};

export function toneFor(domain: StatusDomain, value: string): Tone {
  return MAP[domain]?.[value] ?? MAP.generic[value] ?? 'neutral';
}

export const CHASSIS_STATUSES = ['New', 'Available', 'Allocated', 'On Hire', 'Breakdown', 'In Repair', 'Rescue', 'Parked', 'Unaccounted', 'Legal', 'Converted', 'Sold', 'Killed'] as const;
export const REPAIR_CATEGORIES = ['Tires', 'Suspension', 'Mechanical', 'Electrical', 'Brakes', 'Painting'] as const;
