import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import {
  Camera,
  Clock,
  Copy,
  FileText,
  LifeBuoy,
  LocateFixed,
  Plus,
  ShieldOff,
  Siren,
  Truck,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { api } from "../lib/api-client";
import {
  CONTRACT_TYPES,
  formatDate,
  formatDateTime,
  formatPhp,
  toneFor,
  type StatusDomain,
} from "../lib/shared";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardHeader,
  DataTable,
  Field,
  FormGrid,
  Input,
  KpiTile,
  Modal,
  MoneyInput,
  MoneyText,
  PageHeader,
  Segmented,
  Select,
  Stack,
  StatusBadge,
  Switch,
  Textarea,
  cn,
  useToast,
  type ColumnDef,
} from "../lib/ui";
import { errMessage, useAction, useData } from "../auth";
import logo from "../assets/delbros-logo.png";

// ── SCR-10 Client Self-Service Portal (Dashboard) ──────────────────────────
const LOW_WALLET_FACTOR = 1.25; // UI cue only: warn when the e-wallet is within 25% above the minimum
/** One tone rule for the e-wallet balance on every portal screen (dashboard tile and E-wallet page). */
function walletTone(
  w?: { balance: number; minimumBalance: number } | null,
): "default" | "danger" | "warning" | "success" {
  if (!w) return "default";
  if (w.balance < 0) return "danger";
  return w.balance < w.minimumBalance * LOW_WALLET_FACTOR
    ? "warning"
    : "success";
}
/** Status pill with sentence-case text ("Partially paid", "Extension pending"); colour still comes from the shared status map. */
function PortalStatus({
  domain,
  value,
}: {
  domain: StatusDomain;
  value?: string | null;
}) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <Badge tone={toneFor(domain, value)}>
      {value.charAt(0) + value.slice(1).toLowerCase()}
    </Badge>
  );
}
/** Review 1.1: the amber rule, stated wherever the wallet colour is shown (proposed — Finance to confirm, EWL-004). */
const walletRule = (min: number) =>
  `Amber below ${formatPhp(min * LOW_WALLET_FACTOR)} (125% of the minimum), red below ₱0`;
const daysFromToday = (iso: string) =>
  Math.ceil(
    (new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) /
      86_400_000,
  );
const dueText = (n: number) =>
  n < 0
    ? `overdue ${-n} day${n === -1 ? "" : "s"}`
    : n === 0
      ? "due today"
      : `due in ${n} day${n === 1 ? "" : "s"}`;
const MiniHead = ({
  cols,
  children,
}: {
  cols: string;
  children: ReactNode;
}) => (
  <div
    className={cn(
      "hidden gap-3 border-b border-line pb-2 text-xs font-medium uppercase tracking-wide text-muted sm:grid",
      cols,
    )}
  >
    {children}
  </div>
);

export function ClientDashboard() {
  const d = useData(["portal-dash"], () => api.portal.dashboard());
  const ref = useData(["ref"], () => api.ref.all());
  if (!d.data) return <p className="text-muted">Loading…</p>;
  const x = d.data;
  const w = x.ewallet;
  const eqName = (c: string) =>
    ref.data?.equipmentTypes.find((q) => q.code === c)?.name ?? c;
  const walletLow = walletTone(w) === "warning" || walletTone(w) === "danger";
  const dueIn = x.oldestDue ? daysFromToday(x.oldestDue) : undefined;
  const expIn = x.activeContracts.nearestExpiry
    ? daysFromToday(x.activeContracts.nearestExpiry)
    : undefined;
  return (
    <>
      <PageHeader
        title={x.client.clientName}
        meta={<StatusBadge domain="client" value={x.client.status} />}
        description={`Account ${x.client.clientCode}`}
      />
      {x.client.status === "Hold" && (
        <Banner
          tone="danger"
          className="mb-5"
          title="Your account is on hold"
          actions={
            <Link to="/client/invoices">
              <Button size="sm" variant="danger">
                View balance
              </Button>
            </Link>
          }
        >
          Overdue balance {formatPhp(x.overdue)}. New EWAs, chassis release and
          new services are paused until the balance is settled. Please contact
          Credit &amp; Collection or your Account Executive.
        </Banner>
      )}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          {
            to: "/client/ewa",
            label: "Create EWA",
            hint: "Authorise a driver pickup",
            icon: Truck,
            g: x.gates.ewa,
          },
          {
            to: "/client/rescue",
            label: "Request rescue",
            hint: "Report a breakdown on the road",
            icon: LifeBuoy,
            g: x.gates.rescue,
          },
          {
            to: "/client/invoices",
            label: "View contracts & SOA",
            hint: "Invoices, balances and statement",
            icon: FileText,
            g: { allowed: true },
          },
        ].map((q) => (
          <Link
            key={q.to}
            to={q.to}
            className={cn(
              "flex items-center gap-3 rounded-xl border p-4 transition-colors",
              q.g.allowed
                ? "border-line bg-surface hover:border-brand-300 hover:bg-brand-50"
                : "border-danger-line bg-danger-bg/40",
            )}
          >
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-lg",
                q.g.allowed
                  ? "bg-brand-50 text-brand-600"
                  : "bg-danger-bg text-danger",
              )}
            >
              {q.g.allowed ? (
                <q.icon className="size-5" />
              ) : (
                <ShieldOff className="size-5" />
              )}
            </span>
            <span>
              <span className="block font-semibold text-ink">{q.label}</span>
              <span className="text-xs text-muted">
                {q.g.allowed ? q.hint : "Unavailable — account restricted"}
              </span>
            </span>
          </Link>
        ))}
      </div>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiTile
          label="Unpaid bills"
          value={x.unpaidCount}
          hint={formatPhp(x.unpaidTotal)}
          tone={x.overdue ? "danger" : "default"}
        />
        {/* Review 1.1: amount and overdue state of the oldest due date. */}
        <KpiTile
          label="Oldest due"
          value={
            <span className="[font-variant-numeric:normal]">
              {formatDate(x.oldestDue)}
            </span>
          }
          tone={
            x.oldestDueOverdue || (dueIn != null && dueIn < 0)
              ? "danger"
              : "default"
          }
          hint={
            dueIn == null ? (
              "Nothing due"
            ) : (
              <>
                {formatPhp(x.oldestDueAmount)} · {dueText(dueIn)}
              </>
            )
          }
        />
        <KpiTile
          label="E-wallet"
          value={w ? formatPhp(w.balance) : "—"}
          tone={walletTone(w)}
          hint={
            w ? (
              <span title={walletRule(w.minimumBalance)}>
                Minimum {formatPhp(w.minimumBalance)}
                {walletLow && (
                  <>
                    {" "}
                    ·{" "}
                    <Link
                      to="/client/ewallet"
                      className="font-medium text-brand-600 hover:underline"
                    >
                      Top up
                    </Link>
                  </>
                )}
              </span>
            ) : undefined
          }
        />
        <KpiTile label="Units on hire" value={x.onHire.length} />
        {/* Review 1.1 (RPT-009 / CLT-011): active contracts with the nearest expiry. */}
        <KpiTile
          label="Active contracts"
          value={x.activeContracts.count}
          tone={expIn != null && expIn <= 30 ? "warning" : "default"}
          hint={
            x.activeContracts.nearestExpiry ? (
              <Link to="/client/contracts" className="hover:underline">
                Expires {formatDate(x.activeContracts.nearestExpiry)}
              </Link>
            ) : (
              "No end date"
            )
          }
        />
      </div>
      {/* Cards in a row stretch to the same height so no grey gap opens beside the longer list. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="On-hire equipment" />
          {/* The list is on-hire by definition, so no per-row status pill. */}
          {x.onHire.length ? (
            <ul className="divide-y divide-line">
              {x.onHire.map((c) => (
                <li
                  key={c.chassisNo}
                  className="flex flex-wrap justify-between gap-x-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-mono">{c.chassisNo}</span>{" "}
                    <span className="text-muted">
                      · {eqName(c.chassisType)}
                    </span>
                  </span>
                  <span className="text-muted">
                    On hire since {formatDate(c.gateOut)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No units on hire.</p>
          )}
        </Card>
        <Card className="flex flex-col">
          <CardHeader
            title="E-wallet — recent transactions"
            description={w ? walletRule(w.minimumBalance) : undefined}
          />
          {w && w.balance < w.minimumBalance && (
            <Banner tone="warning" className="mb-3">
              Your balance is below the minimum.{" "}
              <Link to="/client/ewallet" className="font-medium underline">
                Request a top-up
              </Link>
              .
            </Banner>
          )}
          {x.walletTxns.length ? (
            <ul className="divide-y divide-line">
              {x.walletTxns.map((t) => (
                <li
                  key={t.id}
                  className="flex justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block">
                      {formatDate(t.at)} · {t.type}
                      {t.category && t.category !== "Top-up"
                        ? ` · ${t.category}`
                        : ""}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {[t.referenceType, t.referenceId]
                        .filter(Boolean)
                        .join(" ")}
                    </span>
                  </span>
                  <span className="text-right">
                    <MoneyText value={t.amount} />
                    <span className="block text-xs text-muted">
                      Balance {formatPhp(t.balanceAfter)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No transactions.</p>
          )}
          {w && (
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm">
              <span className="text-muted">
                Cash bond held {formatPhp(x.cashBondHeld)} ·{" "}
                <Link
                  to="/client/ewallet"
                  className="text-brand-600 hover:underline"
                >
                  withdrawal
                </Link>
              </span>
              <Link
                to="/client/ewallet"
                className="font-medium text-brand-600 hover:underline"
              >
                View full ledger
              </Link>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Open service requests"
            description="Rescue requests not yet completed"
            actions={
              <Link
                to="/client/rescue"
                className="text-sm text-brand-600 hover:underline"
              >
                All requests →
              </Link>
            }
          />
          {x.openRescues.length ? (
            <ul className="divide-y divide-line">
              {x.openRescues.map((r) => (
                <li
                  key={r.rescueNo}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span>
                    <span className="font-mono">{r.rescueNo}</span>{" "}
                    <span className="text-muted">
                      · {r.chassisNo} · {formatDateTime(r.requestedAt)}
                      {r.urgent ? " · urgent" : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {r.eta && (
                      <span className="text-xs text-muted">
                        ETA {formatDateTime(r.eta)}
                      </span>
                    )}
                    <PortalStatus domain="rescue" value={r.status} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No open service requests.</p>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Returned equipment"
            description="Units you have returned (Gate In)"
          />
          {x.returns.length ? (
            <ul className="divide-y divide-line">
              {x.returns.map((r) => (
                <li
                  key={r.gatePassNo}
                  className="flex flex-wrap justify-between gap-x-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-mono">{r.chassisNo}</span>{" "}
                    <span className="text-muted">
                      · {r.branchCode} · {r.gatePassNo}
                    </span>
                  </span>
                  <span className="text-muted">
                    {formatDate(r.hiredAt)} → returned{" "}
                    {formatDate(r.returnedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No returns yet.</p>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="EWA history"
            actions={
              <Link
                to="/client/ewa"
                className="text-sm text-brand-600 hover:underline"
              >
                All EWAs →
              </Link>
            }
          />
          {x.ewas.length ? (
            <div className="text-sm">
              <MiniHead cols="grid-cols-[8.5rem_1fr_7rem_10rem_10rem_9rem]">
                <span>EU no.</span>
                <span>Branch · driver</span>
                <span>Truck</span>
                <span>Created</span>
                <span>Valid until</span>
                <span>Status</span>
              </MiniHead>
              <ul className="divide-y divide-line">
                {x.ewas.map((e) => (
                  <li
                    key={e.euNo}
                    className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[8.5rem_1fr_7rem_10rem_10rem_9rem] sm:items-center"
                  >
                    <span className="font-mono">{e.euNo}</span>
                    <span className="min-w-0 truncate max-sm:order-3">
                      {e.branchCode} · {e.driverName}
                    </span>
                    <span className="text-muted max-sm:order-4">
                      {e.truckPlateNo}
                    </span>
                    <span className="text-muted max-sm:hidden">
                      {formatDateTime(e.createdAt)}
                    </span>
                    <span className="text-muted max-sm:order-5">
                      {formatDateTime(e.validUntil)}
                    </span>
                    <span className="max-sm:order-2">
                      <PortalStatus domain="ewa" value={e.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted">No EWAs yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}

// ── SCR-14 EWA Creation (portal variant) + EWA list ────────────────────────
const NEAR_EXPIRY_H = 3; // UI hint only: highlight Active EWAs expiring within this many hours
// Review 1.1 — proposed format rules (Operations / Gate to confirm): LTO plate "ABC 1234" / "AB 1234" / "ABC 123"; LTO licence "N01-23-456789".
const PLATE_RE = /^[A-Z]{2,3} ?\d{3,4}$/;
const LICENCE_RE = /^[A-Z]\d{2}-\d{2}-\d{6}$/;
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
              ["Created", formatDateTime(e.createdAt)],
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
  const blankEwa = {
    contractNo: "",
    branchCode: "",
    driverName: "",
    driverLicenseNo: "",
    truckPlateNo: "",
    trucker: "",
    eq: "",
    qty: 1,
  };
  const [v, setV] = useState(blankEwa);
  const [tried, setTried] = useState(false);
  const [created, setCreated] = useState<Awaited<
    ReturnType<typeof api.gate.createEwa>
  > | null>(null);
  const create = useAction(
    () =>
      api.gate.createEwa({
        clientCode: "",
        contractNo: v.contractNo,
        branchCode: v.branchCode,
        driverName: v.driverName.trim(),
        driverLicenseNo: v.driverLicenseNo.trim().toUpperCase(),
        truckPlateNo: v.truckPlateNo.trim().toUpperCase().replace(/\s+/g, " "),
        trucker: v.trucker.trim(),
        units: [{ equipmentType: v.eq, qty: v.qty }],
      }),
    {
      onSuccess: (e) => {
        setOpen(false);
        setTried(false);
        setV(blankEwa);
        setCreated(e);
      },
    },
  );
  // Availability of each equipment type at the chosen branch (review 1.1: quantity cannot exceed what the yard has).
  const avail = useData(
    ["ewa-avail", v.branchCode],
    () => api.gate.availability(v.branchCode),
    !!v.branchCode,
  );
  const need = (val: string | number) =>
    tried && !String(val).trim() ? "Required" : undefined;
  const plateErr =
    v.truckPlateNo.trim() && !PLATE_RE.test(v.truckPlateNo.trim().toUpperCase())
      ? "Use the LTO format, e.g. NAB 5678"
      : undefined;
  const licErr =
    v.driverLicenseNo.trim() &&
    !LICENCE_RE.test(v.driverLicenseNo.trim().toUpperCase())
      ? "Use the LTO format, e.g. N01-23-456789"
      : undefined;
  const maxQty = v.eq && avail.data ? (avail.data[v.eq] ?? 0) : undefined;
  const qtyErr =
    !Number.isInteger(v.qty) || v.qty < 1
      ? "Whole number, at least 1"
      : maxQty != null && v.qty > maxQty
        ? `Only ${maxQty} available at this branch`
        : undefined;
  const missingDriverTruck =
    tried &&
    (!v.driverName.trim() ||
      !v.driverLicenseNo.trim() ||
      !v.truckPlateNo.trim() ||
      !v.trucker.trim());
  const submitEwa = () => {
    setTried(true);
    if (
      !v.contractNo ||
      !v.branchCode ||
      !v.driverName.trim() ||
      !v.driverLicenseNo.trim() ||
      !v.truckPlateNo.trim() ||
      !v.trucker.trim() ||
      !v.eq ||
      qtyErr ||
      plateErr ||
      licErr
    )
      return;
    create.mutate(undefined);
  };
  const [status, setStatus] = useState<
    "All" | "Active" | "Used" | "Expired" | "Cancelled"
  >("All");
  const [branchF, setBranchF] = useState("");
  const copyEu = (euNo: string) => {
    void navigator.clipboard?.writeText(euNo);
    toast.success(`EU no. ${euNo} copied`);
  };
  const gate = dash.data?.gates.ewa;
  const contracts = (dash.data?.contracts ?? []).filter(
    (c) => c.status === "Active",
  );
  const branches = (ref.data?.branches ?? []).filter((b) =>
    dash.data?.client.cwsBranchAccess.includes(b.code),
  );
  // Review 1.1: equipment types limited to the selected contract's rate card, with the count available at the branch.
  const selContract = contracts.find((c) => c.contractNo === v.contractNo);
  const eqOptions = (ref.data?.equipmentTypes ?? [])
    .filter(
      (q) =>
        !selContract ||
        selContract.rates.some((r) => r.equipmentType === q.code),
    )
    .map((q) => ({
      value: q.code,
      label: avail.data
        ? `${q.name} — ${avail.data[q.code] ?? 0} available`
        : q.name,
    }));
  type Row = EwaRow;
  const [view, setView] = useState<Row | null>(null);
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
  const soon = (e: Row) =>
    e.status === "Active" &&
    new Date(e.validUntil).getTime() - Date.now() < NEAR_EXPIRY_H * 3600_000;
  const extAction = (e: Row) =>
    e.status === "Expired" ? (
      <Button
        size="sm"
        variant="secondary"
        icon={<Clock className="size-4" />}
        title="Request an extension (manager approval)"
        onClick={(ev) => {
          ev.stopPropagation();
          setReason("");
          setExt(e);
        }}
      >
        Extend
      </Button>
    ) : e.status === "Extension Pending" ? (
      <span className="text-xs text-warning">Awaiting manager approval</span>
    ) : soon(e) ? (
      <span className="text-xs text-warning">
        Expires soon — extension available once expired
      </span>
    ) : null;
  return (
    <>
      <PageHeader
        title="Electronic Withdrawal Authorizations"
        description="Authorise your driver to pick up units. Each EWA is valid for 24 hours; the driver presents the EU number at the gate. Expired EWAs can be extended with manager approval."
        actions={
          <Button
            icon={<Plus className="size-4" />}
            disabled={!gate?.allowed}
            onClick={() => {
              setTried(false);
              setOpen(true);
            }}
          >
            New EWA
          </Button>
        }
      />
      {gate && !gate.allowed && (
        <Banner tone="danger" className="mb-4" title="EWA creation unavailable">
          {gate.reason}
        </Banner>
      )}
      <DataTable<Row>
        data={(ewas.data ?? []).filter(
          (e) =>
            (status === "All" || e.status === status) &&
            (!branchF || e.branchCode === branchF),
        )}
        loading={ewas.isLoading}
        pageSize={10}
        searchPlaceholder="Search EU no., driver or plate…"
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
          </>
        }
        columns={[
          {
            accessorKey: "euNo",
            header: "EU no.",
            cell: (c) => (
              <span className="font-mono text-[13px] font-semibold text-ink">
                {c.getValue<string>()}
              </span>
            ),
          },
          { accessorKey: "branchCode", header: "Branch" },
          { accessorKey: "driverName", header: "Driver" },
          { accessorKey: "driverLicenseNo", header: "Licence no." },
          { accessorKey: "truckPlateNo", header: "Truck" },
          {
            id: "u",
            header: "Equipment · released",
            cell: (c) =>
              c.row.original.units
                .map(
                  (u) =>
                    `${eqName(u.equipmentType)} ${u.usedChassis.length}/${u.qty}`,
                )
                .join(", "),
          },
          {
            accessorKey: "validUntil",
            header: "Valid until",
            cell: (c) => (
              <span
                className={cn(
                  soon(c.row.original) && "font-medium text-warning",
                )}
              >
                {formatDateTime(c.getValue<string>())}
              </span>
            ),
          },
          {
            accessorKey: "status",
            header: "Status",
            cell: (c) => (
              <PortalStatus domain="ewa" value={c.getValue<string>()} />
            ),
          },
          {
            id: "act",
            header: () => <span className="block text-right">Actions</span>,
            cell: (c) => (
              <span className="flex items-center justify-end gap-2">
                {extAction(c.row.original)}
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
                icon={<Copy className="size-4" />}
                onClick={() => copyEu(view.euNo)}
              >
                Copy EU no.
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
                  `${formatDateTime(view.createdAt)} · ${view.createdVia === "Portal" ? "portal" : "Delbros"}`,
                ],
                ["Valid until", formatDateTime(view.validUntil)],
                ["Extensions granted", view.extensionCount],
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
            {view.status === "Cancelled" && (
              <Banner
                tone="info"
                title={`Cancelled ${formatDateTime(view.cancelledAt)}`}
              >
                {view.cancelReason ?? "No reason recorded."}
              </Banner>
            )}
            {view.status === "Extension Pending" && (
              <Banner tone="warning" title="Extension pending">
                Your request is awaiting manager approval, then IT revalidation.
                The EWA becomes Active again for a fresh validity window once
                approved.
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
        open={!!ext}
        onClose={() => setExt(null)}
        title={`Request extension — ${ext?.euNo ?? ""}`}
        description="Extensions need manager approval and revalidation by Delbros. Once approved the EWA is valid for another 24 hours."
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
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New EWA"
        description="Valid for 24 hours. Your driver presents the EU number at the gate."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={create.isPending} onClick={submitEwa}>
              Create EWA
            </Button>
          </>
        }
      >
        <Stack>
          <FormGrid>
            <Select
              label="Contract"
              required
              error={need(v.contractNo)}
              value={v.contractNo}
              onChange={(e) => setV({ ...v, contractNo: e.target.value })}
              placeholder="Select"
              options={contracts.map((c) => ({
                value: c.contractNo,
                label: `${c.contractNo} · Class ${c.class}`,
              }))}
            />
            <Select
              label="Pickup branch"
              required
              error={need(v.branchCode)}
              value={v.branchCode}
              onChange={(e) => setV({ ...v, branchCode: e.target.value })}
              placeholder="Select"
              options={branches.map((b) => ({ value: b.code, label: b.name }))}
              hint="Branches enabled for your account"
            />
            <Input
              label="Trucker"
              required
              error={need(v.trucker)}
              value={v.trucker}
              onChange={(e) => setV({ ...v, trucker: e.target.value })}
              placeholder="e.g. ABC Trucking Services"
            />
            <Input
              label="Truck plate no."
              required
              error={need(v.truckPlateNo) ?? (tried ? plateErr : undefined)}
              value={v.truckPlateNo}
              onChange={(e) =>
                setV({ ...v, truckPlateNo: e.target.value.toUpperCase() })
              }
              placeholder="e.g. NAB 5678"
            />
            <Input
              label="Driver name"
              required
              error={need(v.driverName)}
              value={v.driverName}
              onChange={(e) => setV({ ...v, driverName: e.target.value })}
              placeholder="e.g. Juan Dela Cruz"
            />
            <Input
              label="Driver licence no."
              required
              error={need(v.driverLicenseNo) ?? (tried ? licErr : undefined)}
              value={v.driverLicenseNo}
              onChange={(e) =>
                setV({ ...v, driverLicenseNo: e.target.value.toUpperCase() })
              }
              placeholder="e.g. N01-23-456789"
            />
            <Select
              label="Equipment type"
              required
              error={need(v.eq)}
              value={v.eq}
              onChange={(e) => setV({ ...v, eq: e.target.value })}
              placeholder={v.contractNo ? "Select" : "Select a contract first"}
              options={eqOptions}
              hint={
                v.branchCode
                  ? "Types on your contract, with units available at the branch"
                  : "Choose the pickup branch to see availability"
              }
            />
            <Input
              label="Quantity"
              required
              type="number"
              min={1}
              max={maxQty || undefined}
              step={1}
              error={
                tried || (maxQty != null && v.qty > maxQty) ? qtyErr : undefined
              }
              value={v.qty}
              onChange={(e) => setV({ ...v, qty: Number(e.target.value) })}
              placeholder="e.g. 1"
            />
          </FormGrid>
          {missingDriverTruck && (
            <Banner tone="danger" title="Missing driver/truck info">
              Enter the trucker, truck plate no., driver name and driver licence
              no. — the gate checks them against the EWA.
            </Banner>
          )}
          {create.error && (
            <Banner tone="danger">{errMessage(create.error)}</Banner>
          )}
        </Stack>
      </Modal>
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
              ]}
            />
            <Banner tone="success">
              Details emailed to{" "}
              {dash.data?.client.email ?? "your registered email"} and sent to
              the {created.branchCode} branch and your Account Executive.
            </Banner>
          </Stack>
        )}
      </Modal>
    </>
  );
}

// ── SCR-22 Rescue Request (client-facing) ──────────────────────────────────
const MAX_PHOTOS = 5;
const MAX_PHOTO_MB = 5; // proposed limit per photo (review 1.1) — confirm with the document service
const PROBLEM_TYPES = [
  "Flat / blown tire",
  "Brake problem",
  "Mechanical breakdown",
  "Electrical / lights",
  "Accident / collision",
  "Other",
];
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
  const [done, setDone] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | undefined>();
  const req = useAction(
    () => api.rescue.request({ ...v, loadStatus: v.loadStatus || undefined }),
    {
      onSuccess: (r) => {
        setDone(r.rescueNo);
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
    if (first) {
      document
        .querySelector<HTMLElement>(`[data-rescue-field="${first}"]`)
        ?.focus();
      return;
    }
    req.mutate(undefined);
  };
  const gate = dash.data?.gates.rescue;
  const w = dash.data?.ewallet;
  type Row = NonNullable<typeof list.data>[number];
  const [view, setView] = useState<Row | null>(null);
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
    const at: Partial<Record<string, string | undefined>> = {
      Requested: r.requestedAt,
      Dispatched: r.dispatchedAt,
      Completed: r.completedAt,
    };
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
      {gate && !gate.allowed && (
        <Banner
          tone="danger"
          className="mb-4"
          title="Rescue requests unavailable"
        >
          {gate.reason}
        </Banner>
      )}
      {/* Review 1.1 (BR-04): requests are still accepted below the minimum; the charge may take the wallet negative. */}
      {gate?.allowed && w && w.balance < w.minimumBalance && (
        <Banner
          tone="warning"
          className="mb-4"
          title="E-wallet below the minimum"
        >
          Balance {formatPhp(w.balance)} (minimum {formatPhp(w.minimumBalance)}
          ). You can still request a rescue; the charge is deducted afterwards
          and may take your balance negative.{" "}
          <Link to="/client/ewallet" className="font-medium underline">
            Request a top-up
          </Link>
          .
        </Banner>
      )}
      {done ? (
        <Card className="mb-5">
          <Stack>
            <Banner
              tone="success"
              title={`Request ${done} received — dispatcher notified`}
            >
              Our team has been alerted. Keep your phone on — the dispatcher
              will call the scene contact. You can follow the status below.
            </Banner>
            <Button variant="secondary" onClick={() => setDone(null)}>
              New request
            </Button>
          </Stack>
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
                  options={PROBLEM_TYPES.map((p) => ({ value: p, label: p }))}
                  hint="Helps the dispatcher bring the right tires and parts"
                />
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
                  <p className="text-xs text-muted">
                    Charges: travel + tires + parts + 10% service fee, plus 12%
                    VAT.
                  </p>
                </div>
              </div>
              {req.error && (
                <Banner tone="danger">{errMessage(req.error)}</Banner>
              )}
            </Stack>
          </Card>
        )
      )}
      <h2 className="mb-2 font-semibold text-ink">My rescue requests</h2>
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
          { accessorKey: "chassisNo", header: "Unit" },
          {
            accessorKey: "problemType",
            header: "Problem",
            meta: { nowrap: true },
            cell: (c) => c.getValue<string>() ?? "—",
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
              <PortalStatus domain="rescue" value={c.getValue<string>()} />
            ),
          },
          {
            accessorKey: "total",
            header: "Charge",
            meta: { align: "right" },
            cell: (c) => (c.getValue() ? formatPhp(c.getValue<number>()) : "—"),
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
                ["Problem type", view.problemType ?? "—"],
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
                  "Crew / vehicle",
                  [view.crew, view.rescueVehicle].filter(Boolean).join(" · ") ||
                    "—",
                ],
                ["Dispatcher ETA", view.eta ? formatDateTime(view.eta) : "—"],
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

type InvRow = Awaited<ReturnType<typeof api.billing.invoices>>[number];
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
            {["Description", "Unit", "Days", "Rate", "Amount"].map((x, k) => (
              <th
                key={x}
                className={cn(cell, k >= 2 ? "text-right" : "text-left")}
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
              <td colSpan={4} className={cell}>
                {l}
              </td>
              <td className={cn(cell, "font-semibold")}>{formatPhp(v)}</td>
            </tr>
          ))}
        </tfoot>
      </table>
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
  const [pay, setPay] = useState<(typeof PAY_FILTERS)[number]>("All");
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
      <DataTable<Row>
        data={(invs.data ?? []).filter(
          (i) => pay === "All" || i.payment === pay,
        )}
        loading={invs.isLoading}
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
            header: "Period",
            cell: (c) =>
              c.row.original.periodStart === c.row.original.periodEnd
                ? formatDate(c.row.original.periodStart)
                : `${formatDate(c.row.original.periodStart)} – ${formatDate(c.row.original.periodEnd)}`,
          },
          {
            accessorKey: "total",
            header: "Amount",
            meta: { align: "right" },
            cell: (c) =>
              cancelled(c.row.original) ? (
                <s>{formatPhp(c.getValue<number>())}</s>
              ) : (
                formatPhp(c.getValue<number>())
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
            accessorKey: "payment",
            header: "Status",
            cell: (c) => (
              <span className="inline-flex items-center gap-1.5">
                <PortalStatus domain="payment" value={c.getValue<string>()} />
                {c.row.original.daysOverdue > 0 &&
                  c.row.original.balance > 0 && (
                    <span className="text-xs text-danger">
                      {c.row.original.daysOverdue} d overdue
                    </span>
                  )}
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
            ? `Invoice date ${formatDate(inv.invoiceDate)} · period ${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd)} · due ${cancelled(inv) ? "—" : formatDate(inv.dueDate)}`
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-1.5">Description</th>
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
                  <td colSpan={3} className="pt-2 text-muted">
                    Net of VAT
                  </td>
                  <td className="whitespace-nowrap pt-2">
                    {formatPhp(inv.subtotal)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={3} className="text-muted">
                    VAT 12%
                  </td>
                  <td className="whitespace-nowrap">{formatPhp(inv.vat)}</td>
                </tr>
                <tr className="font-semibold">
                  <td colSpan={3}>Total</td>
                  <td className="whitespace-nowrap">{formatPhp(inv.total)}</td>
                </tr>
                <tr className="font-semibold">
                  <td colSpan={3}>Balance</td>
                  <td className="whitespace-nowrap">
                    <MoneyText value={inv.balance} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </Stack>
        )}
      </Modal>
      {soa.data && (
        <Card className="mt-5">
          <CardHeader
            title={`Statement of account ${soa.data.soaNo}`}
            description={`${soa.data.client.clientName} (${soa.data.client.clientCode}) · ${soa.data.client.billingCycle} billing · as of ${formatDateTime(soa.data.asOf)}${closing != null ? ` · closing balance ${formatPhp(closing)}` : ""}`}
          />
          <DataTable
            data={soa.data.lines}
            searchable={false}
            columns={[
              {
                accessorKey: "date",
                header: "Date",
                cell: (c) => formatDate(c.getValue<string>()),
              },
              { accessorKey: "docType", header: "Type" },
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
        </Card>
      )}
    </>
  );
}

// ── SCR-40 Ledger (client view) + top-up request ───────────────────────────
type Fund = "E-wallet" | "Cash bond";
interface LedgerRow {
  id: string;
  fund: Fund;
  at: string;
  type: string;
  amount: number;
  balanceAfter: number;
  reference: string;
  refType?: string;
  refId?: string;
}
export function ClientEwalletPage() {
  const dash = useData(["portal-dash"], () => api.portal.dashboard());
  const code = dash.data?.client.clientCode;
  const led = useData(
    ["portal-ledger", code],
    () => api.ewallet.ledger(code!),
    !!code,
  );
  const bonds = useData(["portal-cashbonds"], () => api.portal.cashBonds());
  const [open, setOpen] = useState(false);
  const [fund, setFund] = useState<"All" | Fund>("E-wallet");
  const [t, setT] = useState({ amount: 0, file: "", ref: "" });
  const [tried, setTried] = useState(false);
  const req = useAction(
    () => api.ewallet.requestTopup(t.amount, t.file, t.ref.trim()),
    {
      success:
        "Top-up request sent — we'll confirm your payment and credit your e-wallet",
      onSuccess: () => {
        setOpen(false);
        setTried(false);
        setT({ amount: 0, file: "", ref: "" });
      },
    },
  );
  const submitTopup = () => {
    setTried(true);
    if (t.amount > 0 && t.ref.trim() && t.file) req.mutate(undefined);
  };
  // DBL-CLT-017 cash bond withdrawal request (C&C → Finance → Accounting → Admin; refundable at contract end, BR-14).
  const [wd, setWd] = useState<{
    bondId: string;
    amount: number;
    reason: string;
  } | null>(null);
  const wdBond = (bonds.data ?? []).find((b) => b.id === wd?.bondId);
  const wdReq = useAction(
    () =>
      api.contracts.requestWithdrawal(wd!.bondId, wd!.amount, wd!.reason, {
        earlyException: !wdBond?.preview.contractEnded,
      }),
    {
      success: "Withdrawal request sent for approval",
      onSuccess: () => setWd(null),
    },
  );
  const w = led.data?.wallet;
  // One ledger, two fund types (US-EWL-005/007): E-Wallet transactions + Cash Bond entries, each with its own running balance.
  // Review 1.1 (EWL-003): the charge category (Rescue / Repair / Debit memo) is shown with the type.
  const walletRows: LedgerRow[] = (led.data?.txns ?? []).map((x) => ({
    id: x.id,
    fund: "E-wallet",
    at: x.at,
    type:
      x.category && x.category !== "Top-up" && x.category !== x.type
        ? `${x.type} · ${x.category}`
        : x.type,
    amount: x.amount,
    balanceAfter: x.balanceAfter,
    reference: [x.referenceType, x.referenceId].filter(Boolean).join(" "),
    refType: x.referenceType,
    refId: x.referenceId,
  }));
  const bondEvents = (bonds.data ?? [])
    .flatMap((b) => [
      {
        id: b.id,
        at: b.dateReceived,
        type: "Cash bond received",
        amount: b.amount,
        reference: [b.receiptRef, b.contractNo].filter(Boolean).join(" · "),
        refId: [b.receiptRef, b.contractNo].filter(Boolean).join(" · "),
      },
      ...b.withdrawals
        .filter(
          (x) => x.status.startsWith("Approved") || x.status === "Refunded",
        )
        .map((x) => ({
          id: x.id,
          at: x.requestedAt,
          type: "Cash bond released",
          amount: -b.amount,
          reference: `Refunded ${formatPhp(x.refundable)} · ${x.reason}`,
        })),
    ])
    .sort((a, b) => a.at.localeCompare(b.at));
  let run = 0;
  const bondRows: LedgerRow[] = bondEvents.map((x) => ({
    ...x,
    fund: "Cash bond" as const,
    balanceAfter: (run += x.amount),
  }));
  const bondHeld = (bonds.data ?? [])
    .filter((b) => b.status === "Held" || b.status === "Withdrawal Pending")
    .reduce((a, b) => a + b.amount, 0);
  // Oldest first, like the statement of account, so each fund's running balance reads top to bottom.
  const rows = [
    ...(fund !== "Cash bond" ? walletRows : []),
    ...(fund !== "E-wallet" ? bondRows : []),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <>
      <PageHeader
        title="E-wallet & cash bond"
        description="Your e-wallet is used for rescue, repair and debit-memo charges — keep it above the minimum. Your cash bond is a separate security fund held against your contract."
        actions={
          <Button
            icon={<Wallet className="size-4" />}
            onClick={() => {
              setTried(false);
              setOpen(true);
            }}
          >
            Request top-up
          </Button>
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="E-wallet balance"
          value={w ? <MoneyText value={w.balance} /> : "—"}
          tone={walletTone(w)}
          hint={
            w ? (
              <span title={walletRule(w.minimumBalance)}>
                {w.balance < 0
                  ? "Negative — top up now"
                  : w.balance < w.minimumBalance
                    ? "Below the minimum — please top up"
                    : walletTone(w) === "warning"
                      ? `Close to the minimum (amber below ${formatPhp(w.minimumBalance * LOW_WALLET_FACTOR)})`
                      : "Above the minimum"}
              </span>
            ) : undefined
          }
        />
        <KpiTile
          label="E-wallet minimum"
          value={w ? formatPhp(w.minimumBalance) : "—"}
        />
        <KpiTile
          label="Pending top-ups"
          value={
            (led.data?.topups ?? []).filter(
              (x) => x.status !== "Posted" && x.status !== "Rejected",
            ).length
          }
        />
        <KpiTile
          label="Cash bond held"
          value={formatPhp(bondHeld)}
          hint="Separate fund — not usable for charges"
        />
      </div>
      {!!bonds.data?.length && (
        <Card className="mb-5">
          <CardHeader
            title="Cash bond"
            description="Refundable at contract end, less unpaid balances. Withdrawal requests are reviewed by Delbros."
          />
          <ul className="divide-y divide-line">
            {bonds.data.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-start justify-between gap-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 pt-1.5">
                  {formatPhp(b.amount)} · {b.contractNo ?? "No contract"}
                  {b.preview.contractStatus && (
                    <span className="text-muted">
                      {" "}
                      ({b.preview.contractStatus}
                      {b.preview.contractExpiry
                        ? ` to ${formatDate(b.preview.contractExpiry)}`
                        : ""}
                      )
                    </span>
                  )}{" "}
                  · refundable now{" "}
                  <strong>{formatPhp(b.preview.refundable)}</strong>
                  {/* Review 1.1: show how the refundable amount is worked out, even while the button is disabled. */}
                  <span className="mt-0.5 block text-xs text-muted">
                    Bond {formatPhp(b.preview.bond)} − unpaid invoices{" "}
                    {formatPhp(b.preview.unpaid)}
                    {b.preview.negativeWallet
                      ? ` − negative e-wallet ${formatPhp(b.preview.negativeWallet)}`
                      : ""}
                    {b.preview.openDm
                      ? ` − open debit memos ${formatPhp(b.preview.openDm)}`
                      : ""}{" "}
                    = {formatPhp(b.preview.refundable)} (never below ₱0)
                  </span>
                </span>
                {/* Pill + button sit right on the summary line; the reason is helper text right-aligned under the button. */}
                <span className="flex flex-col items-end gap-1">
                  <span className="flex items-center gap-2">
                    <Badge tone={b.status === "Held" ? "success" : "warning"}>
                      {b.status === "Withdrawal Pending"
                        ? "Withdrawal pending"
                        : b.status}
                    </Badge>
                    {b.status === "Held" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={b.preview.refundable <= 0}
                        aria-describedby={
                          b.preview.refundable <= 0
                            ? `wd-why-${b.id}`
                            : undefined
                        }
                        onClick={() =>
                          setWd({
                            bondId: b.id,
                            amount: b.preview.refundable,
                            reason: "",
                          })
                        }
                      >
                        Request withdrawal
                      </Button>
                    )}
                  </span>
                  {b.status === "Held" && b.preview.refundable <= 0 && (
                    <span
                      id={`wd-why-${b.id}`}
                      className="text-right text-xs text-muted"
                    >
                      Not available — unpaid balances are deducted from the bond
                      first
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Modal
        open={!!wd}
        onClose={() => setWd(null)}
        title="Request cash bond withdrawal"
        description="Your request is reviewed by Delbros before any refund."
        footer={
          <>
            <Button variant="secondary" onClick={() => setWd(null)}>
              Cancel
            </Button>
            <Button
              loading={wdReq.isPending}
              disabled={
                !wd ||
                wd.amount <= 0 ||
                wd.amount > (wdBond?.preview.refundable ?? 0) ||
                !wd.reason.trim()
              }
              onClick={() => wdReq.mutate(undefined)}
            >
              Submit request
            </Button>
          </>
        }
      >
        {wd && wdBond && (
          <Stack>
            {!wdBond.preview.contractEnded && (
              <Banner tone="warning" title="Contract still active">
                Contract {wdBond.preview.contractNo} is{" "}
                {wdBond.preview.contractStatus}. The bond is normally refundable
                at contract end, so this is sent as an early-withdrawal
                exception.
              </Banner>
            )}
            <div className="rounded-lg border border-line p-3 text-sm">
              <p>Cash bond {formatPhp(wdBond.preview.bond)}</p>
              <p>
                Less unpaid invoices {formatPhp(wdBond.preview.unpaid)} ·
                negative e-wallet {formatPhp(wdBond.preview.negativeWallet)} ·
                open debit memos {formatPhp(wdBond.preview.openDm)}
              </p>
              <p className="mt-1 font-semibold">
                Refundable {formatPhp(wdBond.preview.refundable)}
              </p>
            </div>
            <MoneyInput
              label="Withdrawal amount"
              required
              value={wd.amount || ""}
              onChange={(e) => setWd({ ...wd, amount: Number(e.target.value) })}
              error={
                wd.amount > wdBond.preview.refundable
                  ? "Cannot exceed the refundable amount"
                  : undefined
              }
            />
            <Textarea
              label="Reason"
              required
              value={wd.reason}
              onChange={(e) => setWd({ ...wd, reason: e.target.value })}
              placeholder="Why you need the refund now — e.g. contract ended, units returned"
            />
            {wdReq.error && (
              <Banner tone="danger">{errMessage(wdReq.error)}</Banner>
            )}
          </Stack>
        )}
      </Modal>
      {/* Review 1.1 (CLT-018): top-up requests and their status, always visible (pending → confirmed by Treasury → posted, or rejected with a reason). */}
      {led.data && (
        <Card className="mb-5">
          <CardHeader
            title="Top-up requests"
            description="Submitted → confirmed by Treasury → posted to your e-wallet"
          />
          {led.data.topups.length ? (
            <ul className="divide-y divide-line">
              {led.data.topups.map((x) => (
                <li
                  key={x.id}
                  className="flex flex-wrap justify-between gap-2 py-2 text-sm"
                >
                  <span>
                    {formatDateTime(x.submittedAt)} · {formatPhp(x.amount)}
                    {x.paymentRef && (
                      <span className="text-muted">
                        {" "}
                        · ref <span className="font-mono">{x.paymentRef}</span>
                      </span>
                    )}
                    {x.rejectReason && (
                      <span className="text-danger"> · {x.rejectReason}</span>
                    )}
                  </span>
                  <StatusBadge domain="topup" value={x.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              No top-up requests yet. Use <strong>Request top-up</strong> after
              paying by bank transfer.
            </p>
          )}
        </Card>
      )}
      <DataTable<LedgerRow>
        data={rows}
        loading={led.isLoading || bonds.isLoading}
        searchPlaceholder="Search type or reference…"
        initialSort={[{ id: "at", desc: true }]}
        exportName="my-ledger"
        emptyTitle="No transactions for selected fund"
        toolbar={
          <Segmented
            value={fund}
            onChange={setFund}
            options={[
              { value: "E-wallet", label: "E-wallet" },
              { value: "Cash bond", label: "Cash bond" },
              { value: "All", label: "All funds" },
            ]}
          />
        }
        columns={[
          {
            accessorKey: "at",
            header: "Date",
            cell: (c) => formatDateTime(c.getValue<string>()),
          },
          // Fund type only adds information in the combined view; the tab already names the fund otherwise.
          ...(fund === "All"
            ? [
                {
                  accessorKey: "fund",
                  header: "Fund type",
                } as ColumnDef<LedgerRow>,
              ]
            : []),
          {
            accessorKey: "type",
            header: "Type",
            cell: (c) => (
              <Badge
                tone={c.row.original.amount >= 0 ? "success" : "warning"}
                dot={false}
              >
                {c.getValue<string>()}
              </Badge>
            ),
          },
          {
            accessorKey: "amount",
            header: "Amount",
            meta: { align: "right" },
            cell: (c) => <MoneyText value={c.getValue<number>()} />,
          },
          // A running balance only reads correctly within one fund, so it is hidden in the combined view.
          ...(fund === "All"
            ? []
            : [
                {
                  accessorKey: "balanceAfter",
                  header: "Running balance",
                  meta: { align: "right" },
                  cell: (c) => <MoneyText value={c.getValue<number>()} />,
                } as ColumnDef<LedgerRow>,
              ]),
          // Document IDs in mono like the rest of the portal; rescue references open the Rescue page.
          {
            accessorKey: "reference",
            header: "Reference",
            cell: (c) => {
              const r = c.row.original;
              if (!r.refId) return r.reference || "—";
              return (
                <span>
                  {r.refType && `${r.refType} `}
                  {r.refType === "Rescue" ? (
                    <Link
                      to="/client/rescue"
                      className="font-mono text-brand-600 hover:underline"
                    >
                      {r.refId}
                    </Link>
                  ) : (
                    <span className="font-mono">{r.refId}</span>
                  )}
                </span>
              );
            },
          },
        ]}
      />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Request e-wallet top-up"
        description="Pay by bank transfer, then enter the bank reference and upload the proof. We'll confirm your payment and credit your e-wallet."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={req.isPending} onClick={submitTopup}>
              Submit
            </Button>
          </>
        }
      >
        <Stack>
          {led.data?.payeeBank && (
            <p className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-ink-2">
              <span className="font-medium text-ink">Pay to:</span>{" "}
              {led.data.payeeBank}
            </p>
          )}
          {w && (
            <p className="rounded-lg border border-line bg-surface-alt px-3 py-2 text-sm text-ink-2">
              Current balance <MoneyText value={w.balance} /> · minimum{" "}
              {formatPhp(w.minimumBalance)}
              {w.balance < w.minimumBalance && (
                <>
                  {" "}
                  ·{" "}
                  <span className="font-medium text-warning">
                    {formatPhp(w.minimumBalance - w.balance)} needed to reach
                    the minimum
                  </span>
                </>
              )}
            </p>
          )}
          <FormGrid>
            <MoneyInput
              label="Amount"
              required
              error={
                tried && !(t.amount > 0)
                  ? "Enter the amount you paid"
                  : undefined
              }
              value={t.amount || ""}
              onChange={(e) => setT({ ...t, amount: Number(e.target.value) })}
            />
            <Input
              label="Bank / payment reference no."
              required
              error={tried && !t.ref.trim() ? "Required" : undefined}
              value={t.ref}
              onChange={(e) => setT({ ...t, ref: e.target.value })}
              placeholder="e.g. BDO-TRX-0001"
            />
          </FormGrid>
          <Field
            label="Proof of payment"
            required
            error={
              tried && !t.file
                ? "Upload the bank slip or transfer confirmation"
                : undefined
            }
          >
            {(id, d) => (
              <label
                htmlFor={id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-line-strong p-4 text-sm text-muted hover:border-brand-300"
              >
                <Upload className="size-5" />
                <span className={cn(t.file && "text-ink")}>
                  {t.file ||
                    "Upload the bank slip or transfer confirmation (PDF or image)"}
                </span>
                <input
                  id={id}
                  aria-describedby={d}
                  type="file"
                  accept="image/*,application/pdf"
                  className="sr-only"
                  onChange={(e) =>
                    setT({ ...t, file: e.target.files?.[0]?.name ?? "" })
                  }
                />
              </label>
            )}
          </Field>
          {req.error && <Banner tone="danger">{errMessage(req.error)}</Banner>}
        </Stack>
      </Modal>
    </>
  );
}

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

export function ClientContractsPage() {
  const dash = useData(["portal-dash"], () => api.portal.dashboard());
  const ref = useData(["ref"], () => api.ref.all());
  const eq = (c: string) =>
    ref.data?.equipmentTypes.find((e) => e.code === c)?.name ?? c;
  const [req, setReq] = useState<
    { category?: string; subject?: string; reference?: string } | undefined
  >();
  const client = dash.data?.client;
  const branchNames = (client?.cwsBranchAccess ?? [])
    .map((b) => ref.data?.branches.find((x) => x.code === b)?.name ?? b)
    .join(", ");
  const signedOn = (
    c: { history?: { status: string; at: string }[] },
    s: string,
  ) => c.history?.find((h) => h.status === s)?.at;
  const bonds = useData(["portal-cashbonds"], () => api.portal.cashBonds());
  const bondHeld = (no: string) =>
    (bonds.data ?? [])
      .filter(
        (b) =>
          b.contractNo === no &&
          (b.status === "Held" || b.status === "Withdrawal Pending"),
      )
      .reduce((a, b) => a + b.amount, 0);
  const expiry = (c: { status: string; expiryDate?: string }) => {
    if (!c.expiryDate || c.status !== "Active") return null;
    const d = Math.ceil(
      (new Date(c.expiryDate).setHours(0, 0, 0, 0) -
        new Date().setHours(0, 0, 0, 0)) /
        86_400_000,
    );
    return (
      <span
        className={cn(
          "text-xs",
          d <= 30 ? "font-medium text-warning" : "text-muted",
        )}
      >
        {d < 0
          ? "Past expiry date"
          : d === 0
            ? "Expires today"
            : `Expires in ${d} day${d === 1 ? "" : "s"}`}
      </span>
    );
  };
  return (
    <>
      <PageHeader
        title="Contracts"
        description="Your lease contracts, agreed daily rates and terms."
      />
      <Stack>
        {(dash.data?.contracts ?? []).map((c) => {
          const units = (dash.data?.onHire ?? []).filter(
            (u) => u.contractNo === c.contractNo,
          );
          const signed = signedOn(c, "Signed"),
            notarized = signedOn(c, "Notarized");
          return (
            <Card key={c.contractNo}>
              <CardHeader
                title={<span className="font-mono">{c.contractNo}</span>}
                description={`${CONTRACT_TYPES[c.contractType] ? `${CONTRACT_TYPES[c.contractType].name} (${c.contractType})` : c.contractType} · ${formatDate(c.effectiveDate)} – ${c.expiryDate ? formatDate(c.expiryDate) : "open-ended"}`}
                actions={
                  <span className="flex flex-col items-end gap-1">
                    <PortalStatus domain="contract" value={c.status} />
                    {expiry(c)}
                  </span>
                }
              />
              {/* Review 1.1: terms the client needs on the contract page (BR-04, BR-15, branch scope, signature dates). */}
              <div className="mb-4">
                <Dl
                  cols="sm:grid-cols-3 lg:grid-cols-4"
                  rows={[
                    ["Billing cycle", c.billingCycle],
                    [
                      "Credit term",
                      `${c.creditTermDays} days from invoice date`,
                    ],
                    ["Cash bond held", formatPhp(bondHeld(c.contractNo))],
                    [
                      "E-wallet minimum",
                      dash.data?.ewallet
                        ? formatPhp(dash.data.ewallet.minimumBalance)
                        : "—",
                    ],
                    [
                      "Lock-in period",
                      c.lockInMonths ? `${c.lockInMonths} months` : "None",
                    ],
                    [
                      "Late payment interest",
                      `${c.penalties.lateInterestPct}% per month`,
                    ],
                    [
                      "Non-return penalty",
                      `${formatPhp(c.penalties.nonReturn)} per unit`,
                    ],
                    [
                      "Dishonored check",
                      formatPhp(c.penalties.dishonoredCheck),
                    ],
                    ["Units contracted", `${c.unitQty}`],
                    ["Branches covered", branchNames || "—"],
                    ["Signed", signed ? formatDate(signed) : "—"],
                    ["Notarized", notarized ? formatDate(notarized) : "—"],
                  ]}
                />
              </div>
              <p className="mb-2 text-xs text-muted">
                Daily rates per unit, exclusive of 12% VAT · effective{" "}
                {formatDate(c.effectiveDate)}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {c.rates.map((r) => (
                  <div
                    key={r.equipmentType}
                    className="rounded-lg bg-surface-alt px-3 py-2 text-sm"
                  >
                    <p className="text-xs text-muted">{eq(r.equipmentType)}</p>
                    <p className="font-semibold tabular">
                      {formatPhp(r.dailyRate)}/day
                    </p>
                    {!!r.qty && (
                      <p className="text-xs text-muted">
                        Entitled: {r.qty} unit{r.qty === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 border-t border-line pt-3 text-sm">
                <p className="mb-1 text-xs font-medium text-muted">
                  Units on hire under this contract ({units.length})
                </p>
                {units.length ? (
                  <p className="flex flex-wrap gap-x-4 gap-y-1">
                    {units.map((u) => (
                      <span key={u.chassisNo}>
                        <span className="font-mono">{u.chassisNo}</span>{" "}
                        <span className="text-muted">
                          · {eq(u.chassisType)}
                        </span>
                      </span>
                    ))}
                  </p>
                ) : (
                  <p className="text-muted">None at the moment.</p>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-sm">
                {!!c.documents?.length && (
                  <ul className="flex flex-wrap gap-x-5 gap-y-1">
                    {c.documents.map((doc, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <FileText className="size-4 text-muted" />
                        <span className="text-muted">{doc.kind}</span>
                        <span className="font-mono text-[13px] text-ink">
                          {doc.fileName}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {c.status === "Active" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    onClick={() =>
                      setReq({
                        category: "Contract renewal request",
                        subject: `Renewal of ${c.contractNo}`,
                        reference: c.contractNo,
                      })
                    }
                  >
                    Request renewal / amendment / termination
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
        {!dash.data?.contracts.length && (
          <Card>
            <p className="text-sm text-muted">No contracts yet.</p>
          </Card>
        )}
      </Stack>
      <FeedbackModal
        open={!!req}
        onClose={() => setReq(undefined)}
        preset={req}
      />
    </>
  );
}
