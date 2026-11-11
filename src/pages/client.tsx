import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import {
  Camera,
  Clock,
  Copy,
  Eye,
  FileText,
  LifeBuoy,
  LocateFixed,
  Plus,
  Share2,
  ShieldOff,
  Siren,
  Wallet,
  X,
} from "lucide-react";
import { api } from "../lib/api-client";
import {
  RESCUE_PROBLEM_OTHER,
  RESCUE_PROBLEM_TYPES,
  formatDate,
  manilaDay,
  formatDateTime,
  formatPhp,
} from "../lib/shared";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardHeader,
  DataTable,
  DatePicker,
  FormGrid,
  Input,
  KpiTile,
  Modal,
  MoneyText,
  PageHeader,
  Segmented,
  Select,
  Stack,
  Switch,
  Textarea,
  cn,
  useToast,
} from "../lib/ui";
import { errMessage, useAction, useData } from "../auth";
import {
  AccountRestriction,
  restrictionHint,
} from "./restrictions";
import logo from "../assets/delbros-logo.png";
import { EwaDeliveryLog, NewEwaDialog } from "./ewaNew";
import {
  BillingCoverage,
  DisputeDialog,
  PaymentAdviceDialog,
  billingBasis,
  periodLabel,
  soaForPeriod,
  type InvRow,
} from "./invoiceActions";
import {
  EwaHistory,
  TZ,
  TZ_NOTE,
  clientCanCancel,
  ewaShareText,
  isPartial,
  releaseNote,
} from "./ewaList";
import {
  PortalStatus,
  WALLET_STATES,
  daysFromToday,
  useOpenParam,
  walletStateOf,
} from "./portalUi";

// SCR-10 Client Self-Service Portal (Dashboard) lives in ./dashboard.tsx; shared portal helpers in ./portalUi.tsx.

// ── SCR-14 EWA Creation (portal variant) + EWA list ────────────────────────
const NEAR_EXPIRY_H = 3; // UI hint only: highlight Active EWAs expiring within this many hours
// LTO plate / licence format rules: PLATE_RE / LICENCE_RE in lib/shared (also checked by the API). New EWA dialog: ./ewaNew.tsx.
/** Label / value grid used by the portal detail views. */
function Dl({
  rows,
  cols = "sm:grid-cols-2",
}: {
  rows: [string, ReactNode][];
  cols?: string;
}) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-sm", cols)}>
      {rows.map(([l, val]) => (
        <div key={l}>
          <dt className="text-xs text-muted">{l}</dt>
          <dd className="font-medium text-ink">{val ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
type EwaRow = Awaited<ReturnType<typeof api.gate.ewas>>[number];
/** Printed EWA (Print / share) — what the driver shows at the gate. Only mounted while an EWA is open, so it is the only thing on paper. */
function EwaPrint({
  e,
  client,
  eqName,
}: {
  e: Pick<
    EwaRow,
    | "euNo"
    | "contractNo"
    | "branchCode"
    | "trucker"
    | "driverName"
    | "driverLicenseNo"
    | "truckPlateNo"
    | "createdAt"
    | "validUntil"
    | "status"
    | "units"
    | "truckOrcr"
    | "expectedPickupAt"
    | "remarks"
  >;
  client?: string;
  eqName: (c: string) => string;
}) {
  const cell = "border border-black/30 px-2 py-1 text-left";
  return createPortal(
    <div className="print-root">
      <div className="mb-3 flex items-start justify-between border-b-2 border-brand-600 pb-3">
        <div className="flex items-start gap-3">
          <img src={logo} alt="" className="h-12" />
          <div>
            <p className="text-[15px] font-bold tracking-wide">
              DELBROS LEASING
            </p>
            <p>Electronic Withdrawal Authorization</p>
          </div>
        </div>
        <div className="rounded border border-black/60 p-2 text-right">
          <p className="text-[18px] font-bold">{e.euNo}</p>
          <p>Valid until {formatDateTime(e.validUntil)}</p>
          <p>Status {e.status}</p>
        </div>
      </div>
      <table className="mb-3 w-full border-collapse">
        <tbody>
          {(
            [
              ["Client", client],
              ["Contract", e.contractNo],
              ["Pickup branch", e.branchCode],
              ["Trucker", e.trucker],
              ["Driver", e.driverName],
              ["Driver licence no.", e.driverLicenseNo],
              ["Truck plate no.", e.truckPlateNo],
              ["Truck OR/CR no.", e.truckOrcr ?? "Verified at Gate Out"],
              ["Created", formatDateTime(e.createdAt)],
              ...(e.expectedPickupAt ? [["Expected pickup", formatDateTime(e.expectedPickupAt)]] : []),
              ...(e.remarks ? [["Remarks", e.remarks]] : []),
            ] as [string, ReactNode][]
          ).map(([l, v]) => (
            <tr key={l}>
              <th className={cn(cell, "w-48 bg-black/5")}>{l}</th>
              <td className={cell}>{v}</td>
            </tr>
          ))}
          <tr>
            <th className={cn(cell, "bg-black/5")}>Units</th>
            <td className={cell}>
              {e.units
                .map((u) => `${eqName(u.equipmentType)} × ${u.qty}`)
                .join(", ")}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="text-[11px]">
        Valid for 24 hours from creation. The driver presents this EU number and
        a valid licence at the gate. Printed{" "}
        {formatDateTime(new Date().toISOString())} from the client portal.
      </p>
    </div>,
    document.body,
  );
}
export function ClientEwaPage() {
  const dash = useData(["portal-dash"], () => api.portal.dashboard());
  const ewas = useData(["portal-ewas"], () => api.gate.ewas());
  const ref = useData(["ref"], () => api.ref.all());
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // GAT-002: the confirmation after creation (EU number, valid until, full details, email delivery).
  const [created, setCreated] = useState<Awaited<
    ReturnType<typeof api.gate.createEwa>
  > | null>(null);
  const [status, setStatus] = useState<
    "All" | "Active" | "Used" | "Expired" | "Cancelled"
  >("All");
  const [branchF, setBranchF] = useState("");
  // EWA list review: created-date range filter (Manila calendar days).
  const [fromF, setFromF] = useState("");
  const [toF, setToF] = useState("");
  const ewaBlocked = !!dash.data && !dash.data.gates.ewa.allowed;
  /** Copies text; says so only when the browser actually allowed it. */
  const copyText = async (text: string, done: string) => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      toast.success(done);
    } catch {
      toast.error("Copy is blocked by this browser — select the text and copy it manually");
    }
  };
  const copyEu = (euNo: string) => void copyText(euNo, `EU no. ${euNo} copied`);
  type Row = EwaRow;
  const [view, setView] = useState<Row | null>(null);
  // Notification links open the record: /client/ewa?open=EU-000781.
  useOpenParam(ewas.data as Row[] | undefined, (r, id) => r.euNo === id, setView);
  const [ext, setExt] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const extend = useAction(() => api.gate.requestExtension(ext!.euNo, reason), {
    success: () =>
      `Extension requested for ${ext?.euNo} — awaiting manager approval`,
    onSuccess: () => {
      setExt(null);
      setView(null);
      setReason("");
    },
  });
  const eqName = (c: string) =>
    ref.data?.equipmentTypes.find((q) => q.code === c)?.name ?? c;
  // EWA list review: the client cancels its own Active EWA before any release; Delbros can cancel from the staff app.
  const [cancelOf, setCancelOf] = useState<Row | null>(null);
  const [cancelWhy, setCancelWhy] = useState("");
  const cancelEwa = useAction(
    () => api.portal.cancelEwa(cancelOf!.euNo, cancelWhy),
    {
      success: (e) => `${e.euNo} cancelled — the branch has been told`,
      onSuccess: () => {
        setCancelOf(null);
        setView(null);
        setCancelWhy("");
      },
    },
  );
  const shareEwa = async (e: Row) => {
    const text = ewaShareText(e, eqName, dash.data?.client.clientName);
    try {
      if (navigator.share) {
        await navigator.share({ title: `EWA ${e.euNo}`, text });
        return;
      }
    } catch {
      /* cancelled by the user — fall back to copying */
    }
    await copyText(text, `EWA ${e.euNo} details copied — paste them to your driver`);
  };
  const soon = (e: Row) =>
    e.status === "Active" &&
    new Date(e.validUntil).getTime() - Date.now() < NEAR_EXPIRY_H * 3600_000;
  /** Row action under the status pill: request an extension, see the pending step, cancel before release, or the expiry warning. */
  const link = "mt-1 block text-xs font-medium hover:underline";
  const extAction = (e: Row) =>
    e.status === "Expired" ? (
      <button
        type="button"
        className={cn(link, "text-brand-600")}
        title="Request an extension (manager approval, then IT revalidation)"
        onClick={(ev) => {
          ev.stopPropagation();
          setReason("");
          setExt(e);
        }}
      >
        Request extension
      </button>
    ) : e.status === "Extension Pending" ? (
      <span className="mt-1 block text-xs text-warning">
        Awaiting {e.extension?.stepLabel?.toLowerCase() ?? "approval"}
      </span>
    ) : clientCanCancel(e) ? (
      <button
        type="button"
        className={cn(link, "text-danger")}
        title="Cancel this EWA (before any unit is released)"
        onClick={(ev) => {
          ev.stopPropagation();
          setCancelWhy("");
          setCancelOf(e);
        }}
      >
        Cancel EWA
      </button>
    ) : soon(e) ? (
      <span className="mt-1 block text-xs text-warning">Expires soon</span>
    ) : null;
  return (
    <>
      <PageHeader
        title="Electronic Withdrawal Authorizations"
        description={`Authorise your driver to pick up units. Each EWA is valid for 24 hours; the driver presents the EU number at the gate. Expired EWAs can be extended with manager approval. ${TZ_NOTE}`}
        actions={
          <span className="flex flex-col items-end gap-1">
            {/* BR-01: disabled while on hold / Allow Online off, with the reason one click away. */}
            <Button
              icon={<Plus className="size-4" />}
              disabled={ewaBlocked}
              title={ewaBlocked ? restrictionHint(dash.data!, "ewa") : undefined}
              onClick={() => setOpen(true)}
            >
              New EWA
            </Button>
            {ewaBlocked && (
              <button
                type="button"
                className="text-xs font-medium text-danger hover:underline"
                onClick={() => setOpen(true)}
              >
                {restrictionHint(dash.data!, "ewa")} — why?
              </button>
            )}
          </span>
        }
      />
      <AccountRestriction dash={dash.data} scope="ewa" className="mb-4" />{/* hold (BR-01) or Allow Online = No */}
      <DataTable<Row>
        data={(ewas.data ?? []).filter(
          (e) =>
            (status === "All" || e.status === status) &&
            (!branchF || e.branchCode === branchF) &&
            (!fromF || manilaDay(e.createdAt) >= fromF) &&
            (!toF || manilaDay(e.createdAt) <= toF),
        )}
        loading={ewas.isLoading}
        pageSize={8}
        searchPlaceholder="Search EU no., driver, plate, trucker or contract…"
        emptyTitle={
          status === "All" ? "No EWAs yet" : `No ${status.toLowerCase()} EWAs`
        }
        onRowClick={setView}
        toolbar={
          <>
            <Segmented
              value={status}
              onChange={setStatus}
              options={(
                ["All", "Active", "Used", "Expired", "Cancelled"] as const
              ).map((s) => ({ value: s, label: s }))}
            />
            <Select
              aria-label="Branch"
              value={branchF}
              onChange={(e) => setBranchF(e.target.value)}
              options={[
                { value: "", label: "All branches" },
                ...[...new Set((ewas.data ?? []).map((e) => e.branchCode))]
                  .sort()
                  .map((b) => ({ value: b, label: b })),
              ]}
            />
            <span className="flex items-center gap-1.5 text-sm text-muted">
              Created
              <DatePicker
                aria-label="Created from"
                value={fromF}
                max={toF || undefined}
                onChange={setFromF}
                placeholder="From"
                className="w-36"
              />
              –
              <DatePicker
                aria-label="Created to"
                value={toF}
                min={fromF || undefined}
                onChange={setToF}
                placeholder="To"
                className="w-36"
              />
              {(fromF || toF) && (
                <button
                  type="button"
                  className="text-xs font-medium text-brand-600 hover:underline"
                  onClick={() => {
                    setFromF("");
                    setToF("");
                  }}
                >
                  Clear
                </button>
              )}
            </span>
          </>
        }
        columns={[
          {
            // Branch and contract sit under the EU number so the list fits without sideways scrolling.
            id: "euNo",
            accessorFn: (r) => `${r.euNo} ${r.branchCode} ${r.contractNo}`,
            header: "EU no. · branch · contract",
            cell: (c) => (
              <span className="block leading-tight">
                <span className="font-mono text-[13px] font-semibold text-ink">{c.row.original.euNo}</span>
                <span className="block text-xs text-muted">
                  {c.row.original.branchCode} · <span className="font-mono">{c.row.original.contractNo}</span>
                </span>
              </span>
            ),
          },
          {
            // Driver with licence, then truck with trucker — one column so the list fits without sideways scrolling.
            id: "driver",
            accessorFn: (r) =>
              `${r.driverName} ${r.driverLicenseNo} ${r.truckPlateNo} ${r.trucker}`,
            header: "Driver · truck · trucker",
            cell: (c) => (
              <span className="block leading-tight">
                {c.row.original.driverName}{" "}
                <span className="font-mono text-xs text-muted">
                  {c.row.original.driverLicenseNo}
                </span>
                <span className="block text-xs text-muted">
                  {c.row.original.truckPlateNo} · {c.row.original.trucker}
                </span>
              </span>
            ),
          },
          {
            id: "u",
            header: "Equipment · released",
            cell: (c) => {
              const e = c.row.original;
              const note = releaseNote(e);
              const gp = e.gatePasses[0];
              return (
                <span className="block leading-tight">
                  {e.units
                    .map(
                      (u) =>
                        `${eqName(u.equipmentType)} ${u.usedChassis.length}/${u.qty}`,
                    )
                    .join(", ")}
                  {note && (
                    <span className="ml-1 text-xs font-medium text-warning">
                      · {note}
                    </span>
                  )}
                  {/* Used / partly used: the Gate Pass and when the unit left the gate. */}
                  {gp && (
                    <span className="block text-xs text-muted">
                      <span className="font-mono">{gp.gatePassNo}</span> ·{" "}
                      {formatDateTime(gp.at)}
                      {e.gatePasses.length > 1
                        ? ` +${e.gatePasses.length - 1} more`
                        : ""}
                    </span>
                  )}
                </span>
              );
            },
          },
          {
            accessorKey: "createdAt",
            header: `Created (${TZ})`,
            cell: (c) => (
              <span className="block leading-tight">
                {formatDateTime(c.getValue<string>())}
                <span className="block text-xs text-muted">
                  {c.row.original.createdByName}
                </span>
              </span>
            ),
          },
          {
            accessorKey: "validUntil",
            header: `Valid until (${TZ})`,
            cell: (c) => (
              <span
                className={cn(
                  "block leading-tight",
                  soon(c.row.original) && "font-medium text-warning",
                )}
              >
                {formatDateTime(c.getValue<string>())}
                {c.row.original.extensionCount > 0 && (
                  <span className="block text-xs font-normal text-muted">
                    Extended ×{c.row.original.extensionCount}
                  </span>
                )}
              </span>
            ),
          },
          {
            accessorKey: "status",
            header: "Status",
            cell: (c) => (
              <span className="block leading-tight">
                {c.row.original.status === "Extension Pending" ? (
                  <Badge tone="warning">Extension requested</Badge>
                ) : (
                  <PortalStatus domain="ewa" value={c.getValue<string>()} />
                )}
                {extAction(c.row.original)}
                {c.row.original.status === "Cancelled" && (
                  <span
                    className="mt-0.5 block max-w-32 truncate text-xs text-muted"
                    title={c.row.original.cancelReason}
                  >
                    {c.row.original.cancelReason ?? "No reason recorded"}
                  </span>
                )}
              </span>
            ),
          },
          {
            id: "act",
            header: () => <span className="block text-right">Actions</span>,
            cell: (c) => (
              <span className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-2"
                  aria-label={`View EWA ${c.row.original.euNo}`}
                  title="View details, history, print or share"
                  icon={<Eye className="size-4" />}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setView(c.row.original);
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-2"
                  aria-label={`Copy EU no. ${c.row.original.euNo}`}
                  title="Copy EU no. (to share with your driver)"
                  icon={<Copy className="size-4" />}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    copyEu(c.row.original.euNo);
                  }}
                />
              </span>
            ),
          },
        ]}
      />
      {(view ?? created) && (
        <EwaPrint
          e={(view ?? created)!}
          client={dash.data?.client.clientName}
          eqName={eqName}
        />
      )}
      <Modal
        open={!!view}
        onClose={() => setView(null)}
        title={<span className="font-mono">{view?.euNo}</span>}
        description="EWA details"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setView(null)}>
              Close
            </Button>
            <Button
              variant="secondary"
              icon={<FileText className="size-4" />}
              onClick={() => window.print()}
            >
              Print / PDF
            </Button>
            {view && (
              <Button
                variant="secondary"
                icon={<Share2 className="size-4" />}
                onClick={() => void shareEwa(view)}
              >
                Share
              </Button>
            )}
            {view && (
              <Button
                variant="secondary"
                icon={<Copy className="size-4" />}
                onClick={() => copyEu(view.euNo)}
              >
                Copy EU no.
              </Button>
            )}
            {view && clientCanCancel(view) && (
              <Button
                variant="danger"
                onClick={() => {
                  setCancelWhy("");
                  setCancelOf(view);
                }}
              >
                Cancel EWA
              </Button>
            )}
            {view && view.status === "Expired" && (
              <Button
                icon={<Clock className="size-4" />}
                onClick={() => {
                  setReason("");
                  setExt(view);
                }}
              >
                Request extension
              </Button>
            )}
          </>
        }
      >
        {view && (
          <Stack>
            <Dl
              rows={[
                [
                  "Status",
                  <PortalStatus key="s" domain="ewa" value={view.status} />,
                ],
                ["Contract", view.contractNo],
                ["Pickup branch", view.branchCode],
                ["Trucker", view.trucker],
                ["Driver name", view.driverName],
                [
                  "Driver licence no.",
                  <span key="l" className="font-mono">
                    {view.driverLicenseNo}
                  </span>,
                ],
                ["Truck plate no.", view.truckPlateNo],
                [
                  "Created",
                  `${formatDateTime(view.createdAt)} ${TZ} · ${view.createdByName} (${view.createdVia === "Portal" ? "portal" : "Delbros"})`,
                ],
                ["Valid until", `${formatDateTime(view.validUntil)} ${TZ}`],
                ["Extensions granted", view.extensionCount],
                [
                  "Truck OR/CR no.",
                  view.truckOrcr ??
                    view.gatePasses.find((g) => g.truckOrcr)?.truckOrcr ??
                    "Verified at Gate Out",
                ],
                [
                  "Expected pickup",
                  view.expectedPickupAt
                    ? formatDateTime(view.expectedPickupAt)
                    : "Not given",
                ],
                ...(view.remarks
                  ? ([["Remarks", view.remarks]] as [string, ReactNode][])
                  : []),
              ]}
            />
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {view.units.map((u) => (
                <li
                  key={u.equipmentType}
                  className="flex justify-between px-3 py-2"
                >
                  <span>{eqName(u.equipmentType)}</span>
                  <span className="text-muted">
                    {u.usedChassis.length}/{u.qty} released
                    {u.usedChassis.length
                      ? ` · ${u.usedChassis.join(", ")}`
                      : ""}
                    {u.usedChassis.length < u.qty &&
                      u.usedChassis.length > 0 &&
                      ` · ${u.qty - u.usedChassis.length} ${view.status === "Expired" ? "lapsed" : "remaining"}`}
                  </span>
                </li>
              ))}
            </ul>
            {/* Review 1.1: Gate Pass link once the EWA is used, with the truck OR/CR captured at the gate. */}
            {!!view.gatePasses.length && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted">
                  Released at the gate
                </p>
                <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                  {view.gatePasses.map((g) => (
                    <li
                      key={g.gatePassNo}
                      className="flex flex-wrap justify-between gap-2 px-3 py-2"
                    >
                      <span>
                        <span className="font-mono">{g.gatePassNo}</span> ·{" "}
                        {g.chassisNo}
                      </span>
                      <span className="text-muted">
                        {formatDateTime(g.at)}
                        {g.truckOrcr ? ` · ${g.truckOrcr}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Partly released EWA (e.g. 1/2): the rule, so the client knows what happens to the rest. */}
            {isPartial(view) && (
              <Banner
                tone={view.status === "Expired" ? "warning" : "info"}
                title={`Partly released — ${releaseNote(view)}`}
              >
                {view.status === "Expired"
                  ? "The EWA expired before every unit was picked up, so the remaining units lapsed. Units already released stay on hire. Request an extension or create a new EWA for the rest."
                  : `The remaining units can still be picked up with this EU number until ${formatDateTime(view.validUntil)} ${TZ}. At that time any unit not yet released lapses.`}
              </Banner>
            )}
            <EwaHistory e={view} />
            <EwaDeliveryLog
              euNo={view.euNo}
              status={view.status}
              delivery={view.delivery}
            />
            {view.status === "Cancelled" && (
              <Banner
                tone="info"
                title={`Cancelled ${formatDateTime(view.cancelledAt)}`}
              >
                {view.cancelReason ?? "No reason recorded."}
              </Banner>
            )}
            {view.status === "Extension Pending" && (
              <Banner tone="warning" title="Extension requested">
                Your request is awaiting {view.extension?.stepLabel?.toLowerCase() ?? "manager approval"}
                {" "}(manager approval, then IT revalidation). The valid-until time
                changes only once both approve; you will get a notification.
              </Banner>
            )}
            {soon(view) && (
              <Banner tone="warning">
                This EWA expires within {NEAR_EXPIRY_H} hours. If your driver
                cannot reach the gate in time, you can request an extension once
                it expires.
              </Banner>
            )}
          </Stack>
        )}
      </Modal>
      <Modal
        open={!!cancelOf}
        onClose={() => setCancelOf(null)}
        title={`Cancel ${cancelOf?.euNo ?? ""}`}
        description="You can cancel your own EWA while no unit has been released. After a release, call the branch. The branch and your Account Executive are told straight away."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOf(null)}>
              Keep EWA
            </Button>
            <Button
              variant="danger"
              loading={cancelEwa.isPending}
              disabled={!cancelWhy.trim()}
              onClick={() => cancelEwa.mutate(undefined)}
            >
              Cancel EWA
            </Button>
          </>
        }
      >
        <Stack>
          <Textarea
            label="Reason"
            required
            value={cancelWhy}
            onChange={(e) => setCancelWhy(e.target.value)}
            placeholder="e.g. Trucker unavailable; pickup moved to next week"
          />
          {cancelEwa.error && (
            <Banner tone="danger">{errMessage(cancelEwa.error)}</Banner>
          )}
        </Stack>
      </Modal>
      <Modal
        open={!!ext}
        onClose={() => setExt(null)}
        title={`Request extension — ${ext?.euNo ?? ""}`}
        description="Your request shows as “Extension requested”. A manager approves it, then Delbros IT revalidates it; only then is the EWA valid for another 24 hours. The decision appears in the EWA history."
        footer={
          <>
            <Button variant="secondary" onClick={() => setExt(null)}>
              Cancel
            </Button>
            <Button
              loading={extend.isPending}
              disabled={!reason.trim()}
              onClick={() => extend.mutate(undefined)}
            >
              Submit request
            </Button>
          </>
        }
      >
        <Stack>
          <Textarea
            label="Reason for extension"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Truck delayed at port; driver arriving tomorrow 08:00"
          />
          {extend.error && (
            <Banner tone="danger">{errMessage(extend.error)}</Banner>
          )}
        </Stack>
      </Modal>
      <NewEwaDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreated={(e) => {
          setOpen(false);
          setCreated(e);
        }}
        eqName={eqName}
      />
      {/* Review 1.1 (GAT-002): confirmation with the generated EU number, validity and full details; notification sent to the client and Delbros. */}
      <Modal
        open={!!created}
        onClose={() => setCreated(null)}
        title="EWA created"
        description="Share the EU number with your driver. It is valid for 24 hours."
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              icon={<FileText className="size-4" />}
              onClick={() => window.print()}
            >
              Print / PDF
            </Button>
            {created && (
              <Button
                variant="secondary"
                icon={<Copy className="size-4" />}
                onClick={() => copyEu(created.euNo)}
              >
                Copy EU no.
              </Button>
            )}
            <Button onClick={() => setCreated(null)}>Done</Button>
          </>
        }
      >
        {created && (
          <Stack>
            <div className="rounded-lg border border-brand-100 bg-brand-50 p-4 text-center">
              <p className="text-xs uppercase tracking-wide text-muted">
                EU number
              </p>
              <p className="font-mono text-3xl font-bold text-brand-800">
                {created.euNo}
              </p>
              <p className="text-sm text-ink-2">
                Valid until{" "}
                <strong>{formatDateTime(created.validUntil)}</strong>
              </p>
            </div>
            <Dl
              rows={[
                ["Contract", created.contractNo],
                ["Pickup branch", created.branchCode],
                ["Trucker", created.trucker],
                ["Truck plate no.", created.truckPlateNo],
                ["Driver name", created.driverName],
                ["Driver licence no.", created.driverLicenseNo],
                [
                  "Equipment",
                  created.units
                    .map((u) => `${eqName(u.equipmentType)} × ${u.qty}`)
                    .join(", "),
                ],
                ["Created", formatDateTime(created.createdAt)],
                ["Truck OR/CR no.", created.truckOrcr ?? "Verified at Gate Out"],
                [
                  "Expected pickup",
                  created.expectedPickupAt
                    ? formatDateTime(created.expectedPickupAt)
                    : "Not given",
                ],
                ...(created.remarks
                  ? ([["Remarks", created.remarks]] as [string, ReactNode][])
                  : []),
              ]}
            />
            <EwaDeliveryLog
              euNo={created.euNo}
              status={created.status}
              delivery={created.delivery}
            />
            <p className="text-xs text-muted">
              If your driver cannot reach the gate in time, request an extension
              from the EWA list once it expires — it needs manager approval and
              revalidation by Delbros (BR-06).
            </p>
          </Stack>
        )}
      </Modal>
    </>
  );
}

// ── SCR-22 Rescue Request (client-facing) ──────────────────────────────────
const MAX_PHOTOS = 5;
const MAX_PHOTO_MB = 5; // proposed limit per photo (review 1.1) — confirm with the document service
// Problem types and the BR-11 cost lines each usually brings: RESCUE_PROBLEM_TYPES in lib/shared (also checked by the API).
/** Who was told about a rescue request (dispatcher, C&C, branch, AE, client), by channel and status. */
function NotifiedList({ list }: { list?: { at: string; channel: string; audience: string; recipient: string; to: string; status: string }[] }) {
  if (!list?.length) return <p className="text-sm text-muted">No notification log for this request (recorded before notification tracking).</p>;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line text-sm">
      {list.map((d, i) => (
        <li key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2">
          <span className="min-w-0">
            <span className="text-ink">{d.recipient}</span> <span className="text-xs text-muted">· {d.audience}</span>
            <span className="block truncate text-xs text-muted">{d.channel} · {d.to}</span>
          </span>
          <span className="flex items-center gap-2 text-xs text-muted">
            {formatDateTime(d.at)} PHT
            <Badge tone={d.status === "Sent" ? "success" : d.status === "Queued" ? "warning" : "danger"}>{d.status}</Badge>
          </span>
        </li>
      ))}
    </ul>
  );
}
// PH mobile or landline: 0917 123 4567, +63 917 123 4567, (02) 8123 4567.
const PHONE_RE = /^(\+63|0)\s?\(?\d{1,3}\)?[\s-]?\d{3,4}[\s-]?\d{4}$/;
/** Rescue status steps shown as a timeline (review 1.1). Cancelled / Blocked end the line where they happened. */
const RESCUE_STEPS = [
  "Requested",
  "Verified",
  "Confirmed",
  "Dispatched",
  "In Progress",
  "Completed",
] as const;
export function ClientRescuePage() {
  const dash = useData(["portal-dash"], () => api.portal.dashboard());
  const list = useData(["portal-rescues"], () => api.rescue.list());
  const ref = useData(["ref"], () => api.ref.all());
  const eqName = (c: string) =>
    ref.data?.equipmentTypes.find((q) => q.code === c)?.name ?? c;
  const blank = {
    chassisNo: "",
    problemType: "",
    problemDetail: "",
    loadStatus: "" as "" | "Loaded" | "Empty",
    locationText: "",
    incident: "",
    sceneContactName: "",
    sceneContactPhone: "",
    urgent: false,
    lat: undefined as number | undefined,
    lng: undefined as number | undefined,
    photos: [] as string[],
  };
  const [v, setV] = useState(blank);
  // Submission result: reference, "dispatcher notified" and who was told (internal notification status).
  const [done, setDone] = useState<Awaited<ReturnType<typeof api.rescue.request>> | null>(null);
  const [tried, setTried] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | undefined>();
  const req = useAction(
    () => api.rescue.request({ ...v, loadStatus: v.loadStatus || undefined }),
    {
      onSuccess: (r) => {
        setDone(r);
        setV(blank);
        setTried(false);
      },
    },
  );
  const need = (val: string) => (tried && !val.trim() ? "Required" : undefined);
  const phoneErr =
    v.sceneContactPhone.trim() && !PHONE_RE.test(v.sceneContactPhone.trim())
      ? "Enter a PH number, e.g. 0917 123 4567"
      : undefined;
  const submit = () => {
    setTried(true);
    const first = (
      [
        "chassisNo",
        "problemType",
        "loadStatus",
        "locationText",
        "incident",
        "sceneContactName",
        "sceneContactPhone",
      ] as const
    ).find((k) => !v[k].trim() || (k === "sceneContactPhone" && phoneErr));
    const otherMissing = v.problemType === RESCUE_PROBLEM_OTHER && !v.problemDetail.trim();
    if (first || otherMissing) {
      if (!first) {
        document.querySelector<HTMLElement>('[data-rescue-field="problemDetail"]')?.focus();
        return;
      }
      document
        .querySelector<HTMLElement>(`[data-rescue-field="${first}"]`)
        ?.focus();
      return;
    }
    req.mutate(undefined);
  };
  const gate = dash.data?.gates.rescue;
  const w = dash.data?.ewallet;
  const ws = walletStateOf(w);
  const pricingOf = (t?: string) => RESCUE_PROBLEM_TYPES.find((x) => x.value === t);
  type Row = NonNullable<typeof list.data>[number];
  const [view, setView] = useState<Row | null>(null);
  // Notification links open the record: /client/rescue?open=RSC-000041.
  useOpenParam(list.data as Row[] | undefined, (r, id) => r.rescueNo === id, setView);
  const [cancelOf, setCancelOf] = useState<Row | null>(null);
  const [cancelWhy, setCancelWhy] = useState("");
  const cancel = useAction(
    () => api.portal.cancelRescue(cancelOf!.rescueNo, cancelWhy),
    {
      success: (r) => `${r.rescueNo} cancelled — the dispatcher has been told`,
      onSuccess: () => {
        setCancelOf(null);
        setView(null);
        setCancelWhy("");
      },
    },
  );
  const unitLabel = (c: {
    chassisNo: string;
    chassisType: string;
    branchCode?: string;
  }) =>
    `${c.chassisNo} · ${eqName(c.chassisType)}${c.branchCode ? ` · ${c.branchCode}` : ""}`;
  const timeline = (r: Row) => {
    const at: Partial<Record<string, string | undefined>> = Object.fromEntries(
      r.timeline.map((t) => [t.status, t.at]),
    );
    const reached = RESCUE_STEPS.indexOf(
      r.status as (typeof RESCUE_STEPS)[number],
    );
    const ended = r.status === "Cancelled" || r.status === "Blocked";
    return (
      <ol className="flex flex-wrap gap-x-1 gap-y-2 text-xs">
        {RESCUE_STEPS.map((s, i) => {
          const on = !ended ? i <= reached : i === 0;
          return (
            <li
              key={s}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-1",
                on
                  ? "border-brand-300 bg-brand-50 text-brand-800"
                  : "border-line text-muted",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  on ? "bg-brand-600" : "bg-line-strong",
                )}
              />
              {s}
              {on && at[s] ? ` · ${formatDateTime(at[s])}` : ""}
            </li>
          );
        })}
        {ended && (
          <li className="flex items-center gap-1 rounded-full border border-danger-line bg-danger-bg/40 px-2 py-1 text-danger">
            {r.status} · {formatDateTime(r.cancelledAt ?? r.blockedAt)}
          </li>
        )}
      </ol>
    );
  };
  return (
    <>
      <PageHeader
        title="Roadside rescue"
        description="Request emergency assistance for a unit on hire. Charges are deducted from your e-wallet after the rescue."
      />
      <AccountRestriction dash={dash.data} scope="rescue" className="mb-4" />{/* hold (BR-01) or Allow Rescue = No */}
      {/* BR-04: e-wallet balance and state on this page. Proposed rule (Finance to confirm): a rescue is never refused for a low
          balance — it is an emergency; the charge is deducted after the rescue and may take the balance below the minimum or negative. */}
      {w && ws && (
        <div
          className={cn(
            "mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-3 text-sm",
            ws === "healthy"
              ? "border-line bg-surface"
              : ws === "near"
                ? "border-warning-line bg-warning-bg"
                : "border-danger-line bg-danger-bg",
          )}
        >
          <span className="flex items-center gap-2">
            <Wallet className="size-4 text-muted" aria-hidden />
            E-wallet <strong className="tabular">{formatPhp(w.balance)}</strong>
            <Badge tone={WALLET_STATES[ws].tone}>{WALLET_STATES[ws].label}</Badge>
          </span>
          <span className="text-muted">Minimum {formatPhp(w.minimumBalance)}</span>
          <span className="min-w-0 flex-1 text-xs text-ink-2">
            {ws === "healthy" || ws === "near"
              ? "Rescue charges are deducted from your e-wallet after the rescue is completed."
              : "You can still request a rescue — it is never refused for a low balance. The charge is deducted afterwards and will take the balance further down; please top up."}
          </span>
          {ws !== "healthy" && (
            <Link to="/client/ewallet" className="text-sm font-medium text-brand-600 hover:underline">
              Request a top-up
            </Link>
          )}
        </div>
      )}
      {done ? (
        <Card className="mb-5">
          <Stack>
            <Banner
              tone="success"
              title={`Request ${done.rescueNo} received — dispatcher notified`}
            >
              Our team has been alerted{done.urgent ? " (marked urgent — the dispatcher also gets an SMS)" : ""}. Keep your phone on — the
              dispatcher will call {done.sceneContactName} on {done.sceneContactPhone} to confirm the crew and ETA. You can follow the status
              below or open the request for its timeline.
            </Banner>
            <div className="rounded-lg border border-brand-100 bg-brand-50 p-4 text-center">
              <p className="text-xs uppercase tracking-wide text-muted">Reference</p>
              <p className="font-mono text-2xl font-bold text-brand-800">{done.rescueNo}</p>
              <p className="text-sm text-ink-2">
                {done.chassisNo} · {done.problemType}
                {done.problemDetail ? ` — ${done.problemDetail}` : ""} · requested {formatDateTime(done.requestedAt)} PHT
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Notified</p>
              <NotifiedList list={done.notified} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setDone(null)}>
                New request
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const row = (list.data ?? []).find((x) => x.rescueNo === done.rescueNo);
                  if (row) setView(row);
                }}
              >
                Open request
              </Button>
            </div>
          </Stack>
        </Card>
      ) : gate && !gate.allowed ? (
        <Card className="mb-5">
          <CardHeader title="New rescue request" />
          <div className="flex items-start gap-3 text-sm text-ink-2">
            <ShieldOff className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
            <p>
              <strong className="text-danger">{restrictionHint(dash.data!, "rescue")}.</strong> The form is unavailable, so no request is
              created. See the notice above for the reason and who to call. In an emergency, phone your Account Executive — Delbros can
              approve a one-off override (DBL-CNC-001).
            </p>
          </div>
        </Card>
      ) : (
        gate?.allowed && (
          <Card className="mb-5">
            <CardHeader title="New rescue request" />
            <Stack>
              <FormGrid>
                <Select
                  label="Unit"
                  required
                  error={need(v.chassisNo)}
                  data-rescue-field="chassisNo"
                  value={v.chassisNo}
                  onChange={(e) => setV({ ...v, chassisNo: e.target.value })}
                  placeholder="Select your on-hire unit"
                  options={(dash.data?.onHire ?? []).map((c) => ({
                    value: c.chassisNo,
                    label: unitLabel(c),
                  }))}
                  hint="Only your on-hire units are listed"
                />
                <Select
                  label="Problem type"
                  required
                  error={need(v.problemType)}
                  data-rescue-field="problemType"
                  value={v.problemType}
                  onChange={(e) => setV({ ...v, problemType: e.target.value })}
                  placeholder="Select"
                  options={RESCUE_PROBLEM_TYPES.map((p) => ({ value: p.value, label: p.value }))}
                  hint={
                    pricingOf(v.problemType)
                      ? `Usually charged: ${pricingOf(v.problemType)!.pricing}`
                      : "Helps the dispatcher bring the right tires and parts"
                  }
                />
                {v.problemType === RESCUE_PROBLEM_OTHER && (
                  <Input
                    label="Describe the problem"
                    required
                    data-rescue-field="problemDetail"
                    error={tried && !v.problemDetail.trim() ? "Required for Other" : undefined}
                    value={v.problemDetail}
                    onChange={(e) => setV({ ...v, problemDetail: e.target.value })}
                    placeholder="e.g. Landing leg jammed, cannot detach"
                  />
                )}
                <Select
                  label="Load status"
                  required
                  error={need(v.loadStatus)}
                  data-rescue-field="loadStatus"
                  value={v.loadStatus}
                  onChange={(e) =>
                    setV({
                      ...v,
                      loadStatus: e.target.value as "Loaded" | "Empty",
                    })
                  }
                  placeholder="Select"
                  options={[
                    { value: "Loaded", label: "Loaded — container on chassis" },
                    { value: "Empty", label: "Empty" },
                  ]}
                  hint="Helps the dispatcher plan the crew and equipment"
                />
              </FormGrid>
              <div className="flex items-end gap-2">
                <Input
                  wrapperClassName="flex-1"
                  label="Current location"
                  required
                  error={need(v.locationText)}
                  data-rescue-field="locationText"
                  value={v.locationText}
                  onChange={(e) => setV({ ...v, locationText: e.target.value })}
                  placeholder="Address, landmark or highway km"
                />
                <Button
                  variant="secondary"
                  className={cn(need(v.locationText) && "mb-[22px]")}
                  icon={<LocateFixed className="size-4" />}
                  onClick={() =>
                    navigator.geolocation?.getCurrentPosition((p) =>
                      setV((x) => ({
                        ...x,
                        lat: p.coords.latitude,
                        lng: p.coords.longitude,
                        locationText:
                          x.locationText ||
                          `GPS ${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`,
                      })),
                    )
                  }
                >
                  Use my location
                </Button>
              </div>
              <Textarea
                label="What happened?"
                required
                error={need(v.incident)}
                data-rescue-field="incident"
                value={v.incident}
                onChange={(e) => setV({ ...v, incident: e.target.value })}
                placeholder="Describe what happened — e.g. flat tire on the left rear axle"
              />
              <FormGrid>
                <Input
                  label="Contact at scene"
                  required
                  error={need(v.sceneContactName)}
                  data-rescue-field="sceneContactName"
                  value={v.sceneContactName}
                  onChange={(e) =>
                    setV({ ...v, sceneContactName: e.target.value })
                  }
                  placeholder="e.g. Juan Dela Cruz"
                />
                <Input
                  label="Contact number"
                  required
                  error={
                    need(v.sceneContactPhone) ?? (tried ? phoneErr : undefined)
                  }
                  data-rescue-field="sceneContactPhone"
                  value={v.sceneContactPhone}
                  onChange={(e) =>
                    setV({ ...v, sceneContactPhone: e.target.value })
                  }
                  placeholder="e.g. 0917 123 4567"
                />
              </FormGrid>
              <div>
                <label className="flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border-2 border-dashed border-line-strong p-4 text-sm text-muted hover:border-brand-300">
                  <Camera className="size-5" />
                  <span className="min-w-0 flex-1">
                    Supporting photos (optional) — damaged tire, unit, location.
                    Up to {MAX_PHOTOS} images (JPG, PNG or HEIC, max{" "}
                    {MAX_PHOTO_MB} MB each).
                  </span>
                  <span className="inline-flex h-8 items-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink-2">
                    Add photos
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      const ok = files.filter(
                        (f) =>
                          f.type.startsWith("image/") &&
                          f.size <= MAX_PHOTO_MB * 1024 * 1024,
                      );
                      const room = MAX_PHOTOS - v.photos.length;
                      setPhotoErr(
                        ok.length < files.length
                          ? `Skipped ${files.length - ok.length} file(s): images only, max ${MAX_PHOTO_MB} MB each.`
                          : ok.length > room
                            ? `Only ${MAX_PHOTOS} photos allowed — extra files were not added.`
                            : undefined,
                      );
                      setV((x) => ({
                        ...x,
                        photos: [...x.photos, ...ok.map((f) => f.name)].slice(
                          0,
                          MAX_PHOTOS,
                        ),
                      }));
                      e.target.value = "";
                    }}
                  />
                </label>
                {photoErr && (
                  <p className="mt-1 text-xs text-danger">{photoErr}</p>
                )}
                {!!v.photos.length && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {v.photos.map((p, i) => (
                      <li key={p + i}>
                        <Badge tone="info" dot={false}>
                          {p}
                          <button
                            type="button"
                            aria-label={`Remove ${p}`}
                            className="ml-1"
                            onClick={() =>
                              setV((x) => ({
                                ...x,
                                photos: x.photos.filter((_, j) => j !== i),
                              }))
                            }
                          >
                            <X className="size-3" />
                          </button>
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-wrap items-start justify-between gap-4 border-t border-line pt-4">
                <Switch
                  label={
                    <span className="flex items-center gap-1.5">
                      <Siren className="size-4 text-danger" /> Urgent
                    </span>
                  }
                  description="The dispatcher prioritises urgent requests"
                  checked={v.urgent}
                  onChange={(u) => setV({ ...v, urgent: u })}
                />
                <div className="flex flex-col items-end gap-1">
                  <Button
                    icon={<LifeBuoy className="size-4" />}
                    loading={req.isPending}
                    onClick={submit}
                  >
                    Submit request
                  </Button>
                  <details className="max-w-md text-right text-xs text-muted">
                    <summary className="cursor-pointer">
                      Charges: travel + tires + parts + 10% service fee, plus 12% VAT (BR-11)
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-left">
                      {RESCUE_PROBLEM_TYPES.map((t) => (
                        <li key={t.value}>
                          <span className="text-ink-2">{t.value}:</span> {t.pricing}
                        </li>
                      ))}
                      <li className="pt-1">Travel = km to the unit × 2 × the per-km rate. The charge always uses the tires and parts actually used.</li>
                    </ul>
                  </details>
                </div>
              </div>
              {req.error && (
                <Banner tone="danger">{errMessage(req.error)}</Banner>
              )}
            </Stack>
          </Card>
        )
      )}
      <h2 className="mb-1 font-semibold text-ink">My rescue requests</h2>
      <p className="mb-2 text-xs text-muted">
        Requested → Verified (Credit & Collection) → Confirmed → Dispatched (crew on the way, with ETA) → In progress → Completed. You can cancel
        while a request is Requested; after that, call the dispatcher. Times are Philippine time (PHT).
      </p>
      <DataTable<Row>
        data={list.data}
        loading={list.isLoading}
        searchable={false}
        emptyTitle="No rescue requests"
        onRowClick={setView}
        columns={[
          {
            accessorKey: "rescueNo",
            header: "Reference",
            cell: (c) => (
              <button
                type="button"
                className="font-mono text-brand-600 hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  setView(c.row.original);
                }}
              >
                {c.getValue<string>()}
              </button>
            ),
          },
          {
            id: "unit",
            accessorFn: (r) => `${r.chassisNo} ${r.locationText} ${r.sceneContactName}`,
            header: "Unit · location",
            cell: (c) => (
              <span className="block leading-tight">
                <span className="font-mono">{c.row.original.chassisNo}</span>
                {c.row.original.urgent && (
                  <Badge tone="danger" className="ml-1.5" icon={<Siren className="size-3" aria-hidden />}>
                    Urgent
                  </Badge>
                )}
                <span className="block max-w-56 truncate text-xs text-muted" title={c.row.original.locationText}>
                  {c.row.original.locationText}
                </span>
                <span className="block text-xs text-muted">
                  {c.row.original.sceneContactName} · {c.row.original.sceneContactPhone}
                </span>
              </span>
            ),
          },
          {
            accessorKey: "problemType",
            header: "Problem",
            meta: { nowrap: true },
            cell: (c) =>
              c.row.original.problemType ? (
                <span className="block leading-tight">
                  {c.row.original.problemType}
                  {c.row.original.problemDetail && (
                    <span className="block max-w-40 truncate text-xs text-muted">{c.row.original.problemDetail}</span>
                  )}
                </span>
              ) : (
                <span className="text-xs text-muted" title="Recorded before the problem type was required">
                  Not recorded
                </span>
              ),
          },
          {
            accessorKey: "loadStatus",
            header: "Load",
            cell: (c) => c.getValue<string>() ?? "—",
          },
          {
            id: "ph",
            header: "Photos",
            meta: { align: "right" },
            cell: (c) => c.row.original.photos?.length || "—",
          },
          {
            accessorKey: "requestedAt",
            header: "Requested",
            cell: (c) => formatDateTime(c.getValue<string>()),
          },
          {
            accessorKey: "status",
            header: "Status",
            cell: (c) => (
              <span className="block leading-tight">
                <PortalStatus domain="rescue" value={c.getValue<string>()} />
                {(c.row.original.status === "Dispatched" || c.row.original.status === "In Progress") && c.row.original.eta && (
                  <span className="mt-0.5 block text-xs text-muted">ETA {formatDateTime(c.row.original.eta)}</span>
                )}
              </span>
            ),
          },
          {
            accessorKey: "total",
            header: "Charge",
            meta: { align: "right" },
            cell: (c) => (c.getValue() ? formatPhp(c.getValue<number>()) : "—"),
          },
          {
            id: "act",
            header: () => <span className="block text-right">Actions</span>,
            cell: (c) => (
              <span className="flex items-center justify-end gap-1">
                {c.row.original.status === "Requested" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    title="Cancel — possible until Delbros verifies the request"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCancelWhy("");
                      setCancelOf(c.row.original);
                    }}
                  >
                    Cancel
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-2"
                  aria-label={`View ${c.row.original.rescueNo}`}
                  title="Details, timeline, crew and charges"
                  icon={<Eye className="size-4" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    setView(c.row.original);
                  }}
                />
              </span>
            ),
          },
        ]}
      />
      <Modal
        open={!!view}
        onClose={() => setView(null)}
        title={<span className="font-mono">{view?.rescueNo}</span>}
        description="Rescue request details"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setView(null)}>
              Close
            </Button>
            {view?.status === "Requested" && (
              <Button
                variant="danger"
                onClick={() => {
                  setCancelWhy("");
                  setCancelOf(view);
                }}
              >
                Cancel request
              </Button>
            )}
          </>
        }
      >
        {view && (
          <Stack>
            {timeline(view)}
            <Dl
              rows={[
                [
                  "Status",
                  <PortalStatus key="s" domain="rescue" value={view.status} />,
                ],
                [
                  "Unit",
                  <span key="u" className="font-mono">
                    {view.chassisNo}
                  </span>,
                ],
                [
                  "Problem type",
                  view.problemType
                    ? `${view.problemType}${view.problemDetail ? ` — ${view.problemDetail}` : ""}`
                    : "Not recorded (request made before the problem type was required)",
                ],
                ["Usually charged", pricingOf(view.problemType)?.pricing ?? "Travel + tires / parts assessed on site"],
                ["Load status", view.loadStatus ?? "—"],
                [
                  "Requested",
                  `${formatDateTime(view.requestedAt)}${view.urgent ? " · urgent" : ""}`,
                ],
                ["Location", view.locationText],
                ["What happened", view.incident],
                [
                  "Scene contact",
                  `${view.sceneContactName} · ${view.sceneContactPhone}`,
                ],
                [
                  "Crew / vendor · vehicle",
                  [view.crew, view.rescueVehicle].filter(Boolean).join(" · ") ||
                    (view.status === "Requested" || view.status === "Verified" || view.status === "Confirmed" ? "Assigned at dispatch" : "—"),
                ],
                [
                  "Rescue driver",
                  view.driverName ? `${view.driverName}${view.driverPhone ? ` · ${view.driverPhone}` : ""}` : "—",
                ],
                ["Dispatcher ETA", view.eta ? `${formatDateTime(view.eta)} PHT` : "—"],
                [
                  "Unit on hire",
                  view.hire
                    ? `Gate Out ${view.hire.gatePassNo} ${formatDate(view.hire.from)}${view.hire.to ? ` → returned ${formatDate(view.hire.to)} (${view.hire.returnGatePassNo})` : " → still on hire"}`
                    : "—",
                ],
                [
                  "Completed",
                  view.completedAt ? formatDateTime(view.completedAt) : "—",
                ],
                ["Photos", view.photos?.length ? view.photos.join(", ") : "—"],
              ]}
            />
            {/* BR-11 breakdown once completed: travel + tires + parts, +10% service fee, +12% VAT. */}
            {view.charge && (
              <table className="w-full text-sm">
                <tbody className="tabular">
                  {(
                    [
                      [
                        "Travel",
                        `${view.oneWayKm ?? 0} km × 2 × ${formatPhp(view.ratePerKm ?? 0)}`,
                        view.charge.travel,
                      ],
                      ["Tires", "", view.tireCost ?? 0],
                      [
                        "Parts",
                        view.costLines
                          ?.map((l) => `${l.description} × ${l.qty}`)
                          .join(", ") ?? "",
                        view.partsCost ?? 0,
                      ],
                      ["Subtotal", "", view.charge.subtotal],
                      ["Service fee (10%)", "", view.charge.service],
                      ["VAT (12%)", "", view.charge.vat],
                    ] as [string, string, number][]
                  ).map(([l, d, a]) => (
                    <tr key={l} className="border-b border-line">
                      <td className="py-1.5 text-muted">{l}</td>
                      <td className="text-xs text-muted">{d}</td>
                      <td className="text-right">{formatPhp(a)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-1.5">Total charge</td>
                    <td className="text-xs font-normal text-muted">
                      {view.debitMemoNo
                        ? `Debit memo ${view.debitMemoNo} · deducted from the e-wallet`
                        : ""}
                    </td>
                    <td className="text-right">
                      {formatPhp(view.total ?? view.charge.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Notified when the request was made</p>
              <NotifiedList list={view.notified} />
            </div>
            {view.status === "Cancelled" && (
              <Banner tone="info" title="Cancelled">
                {view.cancelReason ?? "No reason recorded."}
              </Banner>
            )}
            {view.status === "Blocked" && (
              <Banner tone="danger" title="Blocked">
                {view.blockedReason}
              </Banner>
            )}
            {view.status === "Requested" && (
              <p className="text-xs text-muted">
                You can cancel while the request is still Requested. Once
                Delbros has verified it, call the dispatcher to cancel.
              </p>
            )}
          </Stack>
        )}
      </Modal>
      <Modal
        open={!!cancelOf}
        onClose={() => setCancelOf(null)}
        title={`Cancel ${cancelOf?.rescueNo ?? ""}`}
        description="The dispatcher is told straight away."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOf(null)}>
              Keep request
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              disabled={!cancelWhy.trim()}
              onClick={() => cancel.mutate(undefined)}
            >
              Cancel request
            </Button>
          </>
        }
      >
        <Textarea
          label="Reason"
          required
          value={cancelWhy}
          onChange={(e) => setCancelWhy(e.target.value)}
          placeholder="e.g. Driver fixed the tire on site"
        />
      </Modal>
    </>
  );
}

// ── SUP-07 Invoices & SOA ───────────────────────────────────────────────────
type Soa = Awaited<ReturnType<typeof api.credit.soa>>;
/** Printed statement of account (the only thing on paper when "Print statement" is used — see index.css .print-root). Same layout as the staff SOA (docs/12). */
function SoaPrint({ s }: { s: Soa }) {
  const addr = [
    s.client.address1,
    s.client.address2,
    s.client.city,
    s.client.zipCode,
    s.client.country,
  ]
    .filter(Boolean)
    .join(", ");
  const pastDue = s.aging.total - s.aging.current;
  const cell = "border border-black/30 px-2 py-1";
  return createPortal(
    <div className="print-root">
      <div className="mb-3 flex break-inside-avoid items-start justify-between border-b-2 border-brand-600 pb-3">
        <div className="flex items-start gap-3">
          <img src={logo} alt="" className="h-12" />
          <div>
            <p className="text-[15px] font-bold tracking-wide">
              DELBROS LEASING
            </p>
            {s.company.address && <p>{s.company.address}</p>}
            {s.company.tin && <p>VAT Reg. TIN {s.company.tin}</p>}
          </div>
        </div>
        <div className="min-w-[200px] rounded border border-black/60 p-2 text-right">
          <p className="text-[13px] font-bold">STATEMENT OF ACCOUNT</p>
          <p>
            No. <span className="font-mono font-semibold">{s.soaNo}</span>
          </p>
          <p>As of {formatDateTime(s.asOf)}</p>
        </div>
      </div>
      <div className="mb-3">
        <p className="font-semibold">
          {s.client.clientName} ({s.client.clientCode})
        </p>
        {addr && <p>{addr}</p>}
        <p>
          Billing: {s.client.billingCycle}
          {s.contracts.length
            ? ` · Contract(s): ${s.contracts.join(", ")}`
            : ""}
        </p>
      </div>
      <table className="mb-3 w-full border-collapse">
        <thead>
          <tr className="bg-black/5">
            {[
              "Current",
              "1–30",
              "31–60",
              "61–90",
              "91–180",
              "Over 180",
              "TOTAL DUE",
            ].map((x) => (
              <th key={x} className={cn(cell, "text-right")}>
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {[
              s.aging.current,
              s.aging.d1_30,
              s.aging.d31_60,
              s.aging.d61_90,
              s.aging.d91_180,
              s.aging.d180,
              s.aging.total,
            ].map((v, i) => (
              <td
                key={i}
                className={cn(
                  cell,
                  "text-right tabular",
                  i === 6 && "font-bold",
                )}
              >
                {formatPhp(v)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {s.lines.length ? (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-black/5">
              {[
                "Date",
                "Type",
                "Doc no.",
                "Due",
                "Debit",
                "Credit",
                "Balance",
              ].map((x, i) => (
                <th
                  key={x}
                  className={cn(cell, i >= 4 ? "text-right" : "text-left")}
                >
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.lines.map((l) => (
              <tr key={l.docType + l.docNo}>
                <td className={cn(cell, "whitespace-nowrap")}>
                  {formatDate(l.date)}
                </td>
                <td className={cell}>{l.docType}</td>
                <td className={cn(cell, "whitespace-nowrap font-mono")}>
                  {l.docNo}
                </td>
                <td className={cn(cell, "whitespace-nowrap")}>
                  {l.due ? formatDate(l.due) : "—"}
                </td>
                <td className={cn(cell, "text-right tabular")}>
                  {l.debit ? formatPhp(l.debit) : ""}
                </td>
                <td className={cn(cell, "text-right tabular")}>
                  {l.credit ? formatPhp(l.credit) : ""}
                </td>
                <td className={cn(cell, "text-right tabular")}>
                  {formatPhp(l.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="rounded border border-black/20 px-2 py-4 text-center">
          No transactions — the account has a zero balance.
        </p>
      )}
      <p className="mt-2 text-right text-[13px] font-bold">
        BALANCE DUE {formatPhp(s.aging.total)}
        {pastDue > 0 && (
          <span className="ml-3">Past due {formatPhp(pastDue)}</span>
        )}
      </p>
      <div className="mt-2 break-inside-avoid text-[11px]">
        <p className="font-semibold">Payment instructions</p>
        <p>
          Deposit / transfer to Delbros Leasing
          {s.company.payeeBank ? ` — ${s.company.payeeBank}` : ""}. Quote the
          SOA and invoice numbers; email the proof to Treasury.
        </p>
        <p className="mt-1">
          {pastDue > 0
            ? "Please settle past-due balances promptly. Kindly disregard if payment has been made."
            : "Thank you — no amount is past due."}
        </p>
      </div>
      <div className="mt-4 flex break-inside-avoid items-end justify-between border-t border-black/40 pt-2 text-[10px]">
        <div>
          {s.company.permit && <p>{s.company.permit}</p>}
          <p>
            Printed {formatDateTime(new Date().toISOString())} from the client
            portal
          </p>
        </div>
        <p className="font-semibold">STATEMENT OF ACCOUNT</p>
      </div>
    </div>,
    document.body,
  );
}

// InvRow, billing basis, coverage, SOA period, proof of payment and disputes: ./invoiceActions.tsx.
/** Printed invoice (review 1.1: invoice view / PDF). */
function InvoicePrint({
  i,
  client,
}: {
  i: InvRow;
  client?: { clientName: string; clientCode: string };
}) {
  const cell = "border border-black/30 px-2 py-1";
  return createPortal(
    <div className="print-root">
      <div className="mb-3 flex items-start justify-between border-b-2 border-brand-600 pb-3">
        <div className="flex items-start gap-3">
          <img src={logo} alt="" className="h-12" />
          <div>
            <p className="text-[15px] font-bold tracking-wide">
              DELBROS LEASING
            </p>
            <p>
              {client?.clientName} ({client?.clientCode})
            </p>
          </div>
        </div>
        <div className="rounded border border-black/60 p-2 text-right">
          <p className="text-[13px] font-bold">
            {i.status === "Cancelled" ? "CANCELLED INVOICE" : "INVOICE"}
          </p>
          <p className="font-mono font-semibold">{i.invoiceNo}</p>
          <p>Invoice date {formatDate(i.invoiceDate)}</p>
          <p>
            Due {formatDate(i.dueDate)} · {i.creditTermDays} days
          </p>
        </div>
      </div>
      <p className="mb-2">
        Period {formatDate(i.periodStart)} – {formatDate(i.periodEnd)}
        {i.contractNo ? ` · Contract ${i.contractNo}` : ""}
      </p>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-black/5">
            {["Description", "Unit", "From – to", "Days", "Rate", "Amount"].map((x, k) => (
              <th
                key={x}
                className={cn(cell, k >= 3 ? "text-right" : "text-left")}
              >
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {i.lines.map((l) => (
            <tr key={l.id}>
              <td className={cell}>{l.description}</td>
              <td className={cn(cell, "font-mono")}>{l.chassisNo ?? ""}</td>
              <td className={cell}>{l.from ? `${formatDate(l.from)}${l.to && l.to !== l.from ? ` – ${formatDate(l.to)}` : ""}` : ""}</td>
              <td className={cn(cell, "text-right")}>{l.days ?? ""}</td>
              <td className={cn(cell, "text-right tabular")}>
                {l.rate != null ? formatPhp(l.rate) : ""}
              </td>
              <td className={cn(cell, "text-right tabular")}>
                {formatPhp(l.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="text-right tabular">
          {(
            [
              ["Net of VAT", i.subtotal],
              ["VAT 12%", i.vat],
              ["Total", i.total],
              ["Balance", i.balance],
            ] as [string, number][]
          ).map(([l, v]) => (
            <tr key={l}>
              <td colSpan={5} className={cell}>
                {l}
              </td>
              <td className={cn(cell, "font-semibold")}>{formatPhp(v)}</td>
            </tr>
          ))}
        </tfoot>
      </table>
      <p className="mt-2">{billingBasis(i)}</p>
      {i.cancelReason && <p className="mt-2">Cancelled: {i.cancelReason}</p>}
      <p className="mt-4 text-[10px]">
        Printed {formatDateTime(new Date().toISOString())} from the client
        portal. This is a copy; the official invoice is the one emailed by
        Delbros Billing.
      </p>
    </div>,
    document.body,
  );
}
const PAY_FILTERS = [
  "All",
  "Unpaid",
  "Partially Paid",
  "Overdue",
  "Paid",
  "Cancelled",
] as const;
export function ClientInvoicesPage() {
  const invs = useData(["portal-invoices"], () => api.billing.invoices());
  const dash = useData(["portal-dash"], () => api.portal.dashboard());
  const code = dash.data?.client.clientCode;
  const soa = useData(
    ["portal-soa", code],
    () => api.credit.soa(code!),
    !!code,
  );
  type Row = InvRow;
  const [inv, setInv] = useState<Row | null>(null);
  useOpenParam(invs.data as Row[] | undefined, (r, id) => r.invoiceNo === id, setInv);
  const [pay, setPay] = useState<(typeof PAY_FILTERS)[number]>("All");
  // Invoice review: proof of payment and disputes (proposed scope), SOA period.
  const [advice, setAdvice] = useState<Row | null>(null);
  const [dispute, setDispute] = useState<Row | null>(null);
  const [soaFrom, setSoaFrom] = useState("");
  const [soaTo, setSoaTo] = useState("");
  const soaView = soa.data ? soaForPeriod(soa.data.lines, soaFrom, soaTo) : undefined;
  const awaitingClearance = (invs.data ?? []).flatMap((i) => i.payments.filter((x) => !x.counted && x.status === "Provisional").map((x) => ({ ...x, invoiceNo: i.invoiceNo })));
  const openItem = (r: Row) => r.disputes.find((d) => d.status === "Submitted" || d.status === "Under review") ? "Disputed" : r.advices.find((a) => a.status === "Submitted") ? "Proof sent" : undefined;
  // Only one document is mounted for printing at a time: the statement by default, the open invoice while its view is open.
  const [printInv, setPrintInv] = useState(false);
  const cancelled = (r: Row) =>
    r.payment === "Cancelled" || r.status === "Cancelled";
  const closing = soa.data?.lines.length
    ? soa.data.lines[soa.data.lines.length - 1].balance
    : undefined;
  const terms = invs.data?.find((i) => !cancelled(i))?.creditTermDays;
  const printInvoice = () => {
    setPrintInv(true);
    setTimeout(() => {
      window.print();
      setPrintInv(false);
    }, 60);
  };
  return (
    <>
      <PageHeader
        title="Invoices & statement"
        description={`Your invoices, payment status and statement of account.${terms ? ` Payment terms: ${terms} days from the invoice date; aging counts days past the due date.` : ""}`}
        actions={
          <Button
            variant="secondary"
            disabled={!soa.data}
            onClick={() => window.print()}
            icon={<FileText className="size-4" />}
          >
            Print statement
          </Button>
        }
      />
      {printInv && inv ? (
        <InvoicePrint i={inv} client={dash.data?.client} />
      ) : (
        soa.data && <SoaPrint s={soa.data} />
      )}
      {soa.data && (
        // Total due is its own summary tile (spanning both rows, content centred vertically); the six aging buckets read in order in a 3 × 2 grid beside it.
        <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="col-span-2 grid sm:col-span-1 sm:row-span-2 [&>*]:justify-center">
            <KpiTile
              label="Total due"
              value={formatPhp(soa.data.aging.total)}
              tone={soa.data.aging.total > 0 ? "warning" : "default"}
              hint="Sum of all aging buckets"
            />
          </div>
          {[
            ["Current", soa.data.aging.current],
            ["1–30 days", soa.data.aging.d1_30],
            ["31–60 days", soa.data.aging.d31_60],
            ["61–90 days", soa.data.aging.d61_90],
            ["91–180 days", soa.data.aging.d91_180],
            ["Over 180 days", soa.data.aging.d180],
          ].map(([l, v]) => (
            <KpiTile
              key={l as string}
              label={l}
              value={formatPhp(v as number)}
              tone={(v as number) > 0 && l !== "Current" ? "danger" : "default"}
            />
          ))}
        </div>
      )}
      {invs.data && <BillingCoverage invs={invs.data} cycle={dash.data?.client.billingCycle} />}
      <DataTable<Row>
        data={(invs.data ?? []).filter(
          (i) => pay === "All" || i.payment === pay,
        )}
        loading={invs.isLoading}
        pageSize={8}
        searchPlaceholder="Search invoice no. or unit…"
        exportName="my-invoices"
        emptyTitle={
          pay === "All" ? "No invoices" : `No ${pay.toLowerCase()} invoices`
        }
        onRowClick={setInv}
        rowClassName={(r) => (cancelled(r) ? "text-muted" : undefined)}
        initialSort={[{ id: "invoiceDate", desc: true }]}
        toolbar={
          <>
            <h2 className="mr-2 font-semibold text-ink">Invoices</h2>
            <Segmented
              value={pay}
              onChange={setPay}
              options={PAY_FILTERS.map((p) => ({
                value: p,
                label: p === "Partially Paid" ? "Partly paid" : p,
              }))}
            />
          </>
        }
        columns={[
          {
            accessorKey: "invoiceNo",
            header: "Invoice #",
            cell: (c) => (
              <button
                type="button"
                className="font-mono text-brand-600 hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  setInv(c.row.original);
                }}
              >
                {c.getValue<string>()}
              </button>
            ),
          },
          {
            accessorKey: "invoiceDate",
            header: "Invoice date",
            cell: (c) => formatDate(c.getValue<string>()),
          },
          {
            id: "p",
            header: "Period / basis",
            accessorFn: (r) => periodLabel(r),
            cell: (c) => periodLabel(c.row.original),
          },
          {
            // Net, VAT and total per invoice.
            accessorKey: "total",
            header: "Total (net + VAT)",
            meta: { align: "right" },
            cell: (c) => (
              <span className="block leading-tight">
                {cancelled(c.row.original) ? <s>{formatPhp(c.getValue<number>())}</s> : formatPhp(c.getValue<number>())}
                <span className="block text-xs text-muted">
                  {formatPhp(c.row.original.subtotal)} + {formatPhp(c.row.original.vat)}
                </span>
              </span>
            ),
          },
          {
            accessorKey: "balance",
            header: "Balance",
            meta: { align: "right" },
            cell: (c) => <MoneyText value={c.getValue<number>()} />,
          },
          {
            accessorKey: "dueDate",
            header: "Due",
            cell: (c) =>
              cancelled(c.row.original)
                ? "—"
                : formatDate(c.getValue<string>()),
          },
          {
            accessorKey: "daysOverdue",
            header: "Days overdue",
            meta: { align: "right" },
            cell: (c) => {
              const r = c.row.original;
              if (cancelled(r) || r.balance <= 0) return <span className="text-muted">—</span>;
              if (r.daysOverdue > 0) return <span className="font-medium text-danger">{r.daysOverdue}</span>;
              const n = daysFromToday(r.dueDate);
              return <span className="text-xs text-muted">{n === 0 ? "due today" : `due in ${n} d`}</span>;
            },
          },
          {
            accessorKey: "payment",
            header: "Status",
            cell: (c) => (
              <span className="block leading-tight">
                <PortalStatus domain="payment" value={c.getValue<string>()} />
                {openItem(c.row.original) && (
                  <span className="mt-0.5 block text-xs text-warning">{openItem(c.row.original)}</span>
                )}
              </span>
            ),
          },
          {
            id: "act",
            header: () => <span className="block text-right">Actions</span>,
            cell: (c) => (
              <span className="flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-2"
                  aria-label={`View ${c.row.original.invoiceNo}`}
                  title="Details, units billed, payments, PDF"
                  icon={<Eye className="size-4" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    setInv(c.row.original);
                  }}
                />
              </span>
            ),
          },
        ]}
      />
      <Modal
        open={!!inv}
        onClose={() => setInv(null)}
        title={<span className="font-mono">{inv?.invoiceNo}</span>}
        description={
          inv
            ? `Invoice date ${formatDate(inv.invoiceDate)} · ${inv.isLease ? `period ${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd)}` : periodLabel(inv)} · due ${cancelled(inv) ? "—" : formatDate(inv.dueDate)}`
            : undefined
        }
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setInv(null)}>
              Close
            </Button>
            <Button
              variant="secondary"
              icon={<FileText className="size-4" />}
              onClick={printInvoice}
            >
              Print / PDF
            </Button>
            {inv && !cancelled(inv) && inv.balance > 0 && (
              <>
                <Button variant="secondary" onClick={() => setDispute(inv)}>
                  Dispute
                </Button>
                <Button onClick={() => setAdvice(inv)}>Send proof of payment</Button>
              </>
            )}
          </>
        }
      >
        {inv && (
          <Stack>
            <div className="flex flex-wrap items-center gap-2">
              <PortalStatus domain="payment" value={inv.payment} />
              <span className="text-sm text-muted">
                {inv.billType} · {inv.branchName}
                {inv.contractNo && (
                  <>
                    {" "}
                    · contract{" "}
                    <span className="font-mono">{inv.contractNo}</span>
                  </>
                )}{" "}
                · terms {inv.creditTermDays} days
              </span>
            </div>
            {inv.cancelReason && (
              <Banner tone="info" title="Cancelled">
                {inv.cancelReason}
              </Banner>
            )}
            <p className="rounded-lg bg-surface-alt px-3 py-2 text-sm text-ink-2">{billingBasis(inv)}</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-1.5">Description · unit</th>
                  <th>From – to</th>
                  <th className="text-right">Days</th>
                  <th className="text-right">Rate</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l) => (
                  <tr key={l.id} className="border-b border-line last:border-0">
                    <td className="py-1.5">
                      {l.description}
                      {l.chassisNo && (
                        <span className="ml-1 font-mono text-xs text-muted">
                          {l.chassisNo}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-xs text-muted">
                      {l.from ? `${formatDate(l.from)}${l.to && l.to !== l.from ? ` – ${formatDate(l.to)}` : ""}` : "—"}
                    </td>
                    <td className="text-right tabular">{l.days ?? ""}</td>
                    <td className="whitespace-nowrap text-right tabular">
                      {l.rate != null ? formatPhp(l.rate) : ""}
                    </td>
                    <td className="whitespace-nowrap text-right tabular">
                      {formatPhp(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-right tabular">
                <tr>
                  <td colSpan={4} className="pt-2 text-muted">
                    Net of VAT
                  </td>
                  <td className="whitespace-nowrap pt-2">
                    {formatPhp(inv.subtotal)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={4} className="text-muted">
                    VAT 12%
                  </td>
                  <td className="whitespace-nowrap">{formatPhp(inv.vat)}</td>
                </tr>
                <tr className="font-semibold">
                  <td colSpan={4}>Total</td>
                  <td className="whitespace-nowrap">{formatPhp(inv.total)}</td>
                </tr>
                <tr className="font-semibold">
                  <td colSpan={4}>Balance</td>
                  <td className="whitespace-nowrap">
                    <MoneyText value={inv.balance} />
                  </td>
                </tr>
              </tfoot>
            </table>
            {/* Payments (Official / Provisional), credit memos, proof sent and disputes on this invoice. */}
            {!!inv.payments.length && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted">Payments</p>
                <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                  {inv.payments.map((x) => (
                    <li key={x.receiptNo} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>
                        <span className="font-mono">{x.receiptNo}</span>{" "}
                        <Badge tone={x.series === "Official receipt" ? "success" : "warning"} dot={false}>{x.series}</Badge>
                        <span className="block text-xs text-muted">
                          {formatDate(x.date)} · {x.method}{x.bank ? ` · ${x.bank}` : ""}{x.checkNo ? ` · check ${x.checkNo}` : ""}{x.fromPr ? ` · from ${x.fromPr}` : ""}
                          {!x.counted ? ` · ${x.status === "Provisional" ? "awaiting clearance — not yet deducted" : x.status.toLowerCase()}` : ""}
                        </span>
                      </span>
                      <span className="font-medium tabular">{formatPhp(x.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!inv.credits.length && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted">Credit memos applied</p>
                <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                  {inv.credits.map((m) => (
                    <li key={m.memoNo} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                      <span><span className="font-mono">{m.memoNo}</span> <span className="text-xs text-muted">· {m.category ?? "Credit"} · {formatDate(m.appliedAt)}</span><span className="block text-xs text-muted">{m.reason}</span></span>
                      <span className="tabular">− {formatPhp(m.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(!!inv.advices.length || !!inv.disputes.length) && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted">Sent by you</p>
                <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                  {inv.advices.map((a) => (
                    <li key={a.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                      <span><span className="font-mono">{a.id}</span> · proof of payment {formatPhp(a.amount)}<span className="block text-xs text-muted">{formatDate(a.paidOn)} · {a.method} · ref {a.reference} · {a.proofFileName}</span></span>
                      <Badge tone={a.status === "Verified" ? "success" : a.status === "Rejected" ? "danger" : "warning"}>{a.status === "Submitted" ? "Accounting checking" : a.status}</Badge>
                    </li>
                  ))}
                  {inv.disputes.map((d) => (
                    <li key={d.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                      <span><span className="font-mono">{d.id}</span> · dispute: {d.reason}<span className="block text-xs text-muted">{d.details}</span></span>
                      <Badge tone={d.status === "Resolved" ? "success" : d.status === "Rejected" ? "danger" : "warning"}>{d.status}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Stack>
        )}
      </Modal>
      <PaymentAdviceDialog inv={advice} onClose={() => setAdvice(null)} />
      <DisputeDialog inv={dispute} onClose={() => setDispute(null)} />
      {soa.data && (
        <Card className="mt-5">
          <CardHeader
            title={`Statement of account ${soa.data.soaNo}`}
            description={`${soa.data.client.clientName} (${soa.data.client.clientCode}) · ${soa.data.client.billingCycle} billing · as of ${formatDateTime(soa.data.asOf)} PHT${closing != null ? ` · closing balance ${formatPhp(closing)}` : ""}`}
          />
          {/* Statement period: From / To with an opening balance ("Balance brought forward"). */}
          <div className="mb-3">
            <span className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
              Period
              <span className="w-40 shrink-0"><DatePicker aria-label="Statement from" value={soaFrom} max={soaTo || undefined} onChange={setSoaFrom} placeholder="From" className="w-36" /></span>–
              <span className="w-40 shrink-0"><DatePicker aria-label="Statement to" value={soaTo} min={soaFrom || undefined} onChange={setSoaTo} placeholder="To" className="w-36" /></span>
              {(soaFrom || soaTo) && (
                <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => { setSoaFrom(""); setSoaTo(""); }}>
                  All dates
                </button>
              )}
            </span>
          </div>
          {soaView && (soaFrom || soaTo) && (
            <p className="mb-2 text-sm text-ink-2">
              {soaFrom ? formatDate(soaFrom) : "Start"} – {soaTo ? formatDate(soaTo) : "today"}: opening {formatPhp(soaView.opening)} + charges {formatPhp(soaView.debits)} − credits {formatPhp(soaView.credits)} = closing <strong>{formatPhp(soaView.closing)}</strong>
            </p>
          )}
          <DataTable
            data={soaView?.rows ?? soa.data.lines}
            searchable={false}
            pageSize={10}
            columns={[
              {
                accessorKey: "date",
                header: "Date",
                cell: (c) => formatDate(c.getValue<string>()),
              },
              {
                accessorKey: "docType",
                header: "Type",
                cell: (c) => {
                  const t = c.getValue<string>();
                  return /receipt/i.test(t) ? (
                    <Badge tone={/Official/.test(t) ? "success" : "warning"} dot={false}>{t}</Badge>
                  ) : /Memo/.test(t) ? (
                    <Badge tone={/Credit/.test(t) ? "info" : "warning"} dot={false}>{t}</Badge>
                  ) : t === "Balance brought forward" ? <span className="font-medium">{t}</span> : t;
                },
              },
              {
                accessorKey: "docNo",
                header: "Doc no.",
                cell: (c) => {
                  // Invoice lines open the same invoice view as the Invoices table; receipts stay plain text.
                  const hit = (invs.data ?? []).find(
                    (i) => i.invoiceNo === c.getValue<string>(),
                  );
                  return hit ? (
                    <button
                      type="button"
                      className="font-mono text-brand-600 hover:underline"
                      onClick={() => setInv(hit)}
                    >
                      {c.getValue<string>()}
                    </button>
                  ) : (
                    <span className="font-mono">{c.getValue<string>()}</span>
                  );
                },
              },
              // Review 1.1: which invoice a receipt paid, and the reason on a cancellation line.
              {
                accessorKey: "ref",
                header: "Note",
                meta: { wrap: true },
                cell: (c) => (
                  <span className="text-muted">
                    {c.getValue<string>() ?? ""}
                  </span>
                ),
              },
              {
                accessorKey: "debit",
                header: "Debit",
                meta: { align: "right" },
                cell: (c) =>
                  c.getValue<number>() ? formatPhp(c.getValue<number>()) : "",
              },
              {
                accessorKey: "credit",
                header: "Credit",
                meta: { align: "right" },
                cell: (c) =>
                  c.getValue<number>() ? formatPhp(c.getValue<number>()) : "",
              },
              {
                accessorKey: "balance",
                header: "Balance",
                meta: { align: "right" },
                cell: (c) => formatPhp(c.getValue<number>()),
              },
            ]}
          />
          {!!awaitingClearance.length && (
            <p className="mt-3 rounded-lg border border-warning-line bg-warning-bg px-3 py-2 text-sm">
              Awaiting clearance (not yet on the statement):{" "}
              {awaitingClearance.map((x) => `${x.receiptNo} ${formatPhp(x.amount)} for ${x.invoiceNo}`).join("; ")}.
            </p>
          )}
          <p className="mt-3 text-xs text-muted">
            Receipts: a <strong>Provisional Receipt (PR-)</strong> is issued when a payment (for example a check) is received; it becomes an{" "}
            <strong>Official Receipt (OR-)</strong> when Treasury clears the funds, and only then reduces your balance. Credit memos (for example
            withholding tax, or a late-encoding correction under BR-05) appear as Credit Memo rows. Times are Philippine time (PHT).
          </p>
        </Card>
      )}
    </>
  );
}

// SCR-40 E-wallet & cash bond + top-up request: ./ewallet.tsx.

// ── Feedback & requests (review 1.1, DBL-CLT-017) ───────────────────────────
export const FEEDBACK_CATEGORIES = [
  "Feedback / suggestion",
  "Complaint",
  "Billing question",
  "Contract renewal request",
  "Contract amendment request",
  "Contract termination request",
  "Other",
];
export function FeedbackModal({
  open,
  onClose,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  preset?: { category?: string; subject?: string; reference?: string };
}) {
  const blank = {
    category: preset?.category ?? "",
    subject: preset?.subject ?? "",
    message: "",
    reference: preset?.reference ?? "",
  };
  const [f, setF] = useState(blank);
  const [tried, setTried] = useState(false);
  const [lastPreset, setLastPreset] = useState(preset);
  if (preset !== lastPreset) {
    setLastPreset(preset);
    setF(blank);
    setTried(false);
  } // re-open with a new preset → fresh form
  const send = useAction(() => api.portal.submitFeedback(f), {
    success: (r) =>
      `${r.id} sent — your Account Executive will get back to you`,
    onSuccess: () => {
      setF(blank);
      setTried(false);
      onClose();
    },
  });
  const need = (v: string) => (tried && !v.trim() ? "Required" : undefined);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send feedback or a request"
      description="Goes to your Account Executive. You get a reference number straight away."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={send.isPending}
            onClick={() => {
              setTried(true);
              if (f.category && f.subject.trim() && f.message.trim())
                send.mutate(undefined);
            }}
          >
            Send
          </Button>
        </>
      }
    >
      <Stack>
        <FormGrid>
          <Select
            label="Category"
            required
            error={need(f.category)}
            value={f.category}
            onChange={(e) => setF({ ...f, category: e.target.value })}
            placeholder="Select"
            options={FEEDBACK_CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
          <Input
            label="Reference (optional)"
            value={f.reference}
            onChange={(e) => setF({ ...f, reference: e.target.value })}
            placeholder="e.g. LTL-2026-0045, INV-MNL-00001102"
          />
        </FormGrid>
        <Input
          label="Subject"
          required
          error={need(f.subject)}
          value={f.subject}
          onChange={(e) => setF({ ...f, subject: e.target.value })}
          placeholder="e.g. Renew contract for another 12 months"
        />
        <Textarea
          label="Message"
          required
          error={need(f.message)}
          value={f.message}
          onChange={(e) => setF({ ...f, message: e.target.value })}
          placeholder="Tell us what you need"
        />
        {send.error && <Banner tone="danger">{errMessage(send.error)}</Banner>}
      </Stack>
    </Modal>
  );
}

// Contracts (client view): ./contracts.tsx.
