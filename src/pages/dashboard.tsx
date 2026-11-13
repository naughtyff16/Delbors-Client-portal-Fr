// ── SCR-10 Client Self-Service Portal (Dashboard) ──────────────────────────
// Portal dashboard review (2026-11-11) — the items marked "Not met":
//  • hold / accreditation state with blocked quick actions (BR-01)      • overdue amount and the six aging buckets
//  • four e-wallet states (healthy / near minimum / below minimum / negative)
//  • contract, daily rate, hire days and accrued charge per on-hire unit, and a "Request return" action (proposed, Q-PTL-03)
//  • return branch, Gate In date and time, condition, final charges, hire duration and the BR-16 code on returns
//  • trucker, equipment type and cancellation reason in the EWA history  • repair and debit-memo charges with where they are settled
//  • service rating form  • cash bond withdrawal offered only when something is refundable (BR-14)
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  FileText,
  LifeBuoy,
  ShieldOff,
  Star,
  Truck,
} from "lucide-react";
import { api } from "../lib/api-client";
import {
  AGING_BUCKETS,
  formatDate,
  formatDateTime,
  formatPhp,
} from "../lib/shared";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardHeader,
  DatePicker,
  Field,
  Modal,
  MoneyText,
  PageHeader,
  Select,
  Stack,
  StatusBadge,
  Textarea,
  cn,
} from "../lib/ui";
import { errMessage, useAction, useData } from "../auth";
import {
  AccountRestriction,
  HoldNoticeAfterSignIn,
  restrictionHint,
} from "./restrictions";
import {
  MiniHead,
  PortalStatus,
  WALLET_ORDER,
  WALLET_STATES,
  daysFromToday,
  dueText,
  plural,
  walletRule,
  walletStateOf,
  walletTone,
} from "./portalUi";
import { FeedbackModal } from "./client";

type Dash = Awaited<ReturnType<typeof api.portal.dashboard>>;
type OnHireRow = Dash["onHire"][number];
const linkCls = "font-medium text-brand-600 hover:underline";

export function ClientDashboard() {
  const d = useData(["portal-dash"], () => api.portal.dashboard());
  const ref = useData(["ref"], () => api.ref.all());
  const [returning, setReturning] = useState<OnHireRow | null>(null);
  // Loading placeholder keeps the shape of the two top cards, so the page does not jump when the data arrives.
  if (!d.data)
    return (
      <div aria-busy="true" aria-label="Loading" className="grid gap-5 pt-24 lg:grid-cols-3">
        <div className="h-72 animate-pulse rounded-card bg-ink/5 lg:col-span-2" />
        <div className="h-72 animate-pulse rounded-card bg-ink/5" />
      </div>
    );
  const x = d.data;
  const w = x.ewallet;
  const ws = walletStateOf(w);
  const eqName = (c?: string) =>
    (c && ref.data?.equipmentTypes.find((q) => q.code === c)?.name) ?? c ?? "—";
  const branchName = (c?: string) =>
    (c && ref.data?.branches.find((b) => b.code === c)?.name) ?? c ?? "—";
  const dueIn = x.oldestDue ? daysFromToday(x.oldestDue) : undefined;
  const oldestOverdue = x.oldestDueOverdue || (dueIn != null && dueIn < 0);
  const expIn = x.activeContracts.nearestExpiry
    ? daysFromToday(x.activeContracts.nearestExpiry)
    : undefined;
  const hold = x.client.status === "Hold";
  return (
    <>
      <PageHeader
        title={x.client.clientName}
        meta={<StatusBadge domain="client" value={x.client.status} />}
        description={
          <>
            Account {x.client.clientCode} ·{" "}
            {hold ? (
              <span className="font-medium text-danger">
                On hold — new EWAs and rescue requests are blocked
              </span>
            ) : x.client.status === "Active" ? (
              <span>
                Accredited and in good standing
                {!x.gates.ewa.allowed || !x.gates.rescue.allowed
                  ? " · some services are not enabled for your account"
                  : " · EWA and rescue available"}
              </span>
            ) : (
              x.client.status
            )}
          </>
        }
      />
      {/* BR-01: hold message with what is blocked and who to contact; shown as a notice once after sign-in. */}
      <HoldNoticeAfterSignIn dash={x} />
      <AccountRestriction dash={x} scope="account" className="mb-5" />
      {/* Allow Online = No: the client signs in normally; EWA is restricted with the Account Executive to contact. */}
      {!hold && <AccountRestriction dash={x} scope="ewa" className="mb-5" />}
      {/* The balance owns the screen: what is owed and when it falls due, with the other account figures beside it. */}
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <section className="flex flex-col justify-between gap-10 rounded-card bg-brand-900 p-7 text-white sm:p-8 lg:col-span-2">
          <div>
            <h2 className="text-sm font-medium text-white/75">Unpaid balance</h2>
            <p className="mt-2 text-[clamp(34px,6vw,56px)] font-semibold leading-none tracking-tight tabular">{formatPhp(x.unpaidTotal)}</p>
            <p className="mt-3 text-base text-white/75">
              {plural(x.unpaidCount, "unpaid bill")}
              {x.overdue > 0 ? (
                <> · <span className="font-medium text-white">{x.overdue >= x.unpaidTotal ? "all overdue" : `${formatPhp(x.overdue)} overdue`}</span></>
              ) : x.unpaidCount ? (
                " · none overdue"
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            {/* Review 1.1: amount and overdue state of the oldest due date. */}
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-white/75">
                Oldest due
                {oldestOverdue && <span className="rounded-lg bg-[#fda29b]/20 px-2 py-0.5 text-sm font-medium text-danger-line">Overdue</span>}
              </p>
              <p className="mt-1 flex items-center gap-2 text-lg font-medium">
                {oldestOverdue && <AlertTriangle className="size-5 text-[#fda29b]" aria-hidden />}
                {dueIn == null ? "Nothing due" : formatDate(x.oldestDue)}
              </p>
              {dueIn != null && (
                <p className="mt-0.5 text-sm text-white/75">
                  {formatPhp(x.oldestDueAmount)} · {dueText(dueIn)}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Timeline 2 review (proposed entry point): Pay now opens the oldest unpaid invoice with the proof-of-payment form. */}
              {x.oldestDueInvoices[0] && (
                <Link
                  to={`/client/invoices?open=${x.oldestDueInvoices[0]}&pay=1`}
                  className="inline-flex h-11 items-center rounded-full bg-white/10 px-5 text-sm font-medium text-white transition-[background-color,transform] duration-150 ease-out hover:bg-white/20 active:scale-[0.96]"
                >
                  Pay now
                </Link>
              )}
              <Link
                to="/client/invoices"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-white pl-5 pr-4 text-sm font-medium text-brand-900 transition-[background-color,transform] duration-150 ease-out hover:bg-brand-50 active:scale-[0.96]"
              >
                View invoices
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </div>
        </section>
        <Card className="flex flex-col justify-between gap-5">
          <h2 className="sr-only">Account figures</h2>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-muted">E-wallet</p>
              {w && ws ? (
                <p className="mt-1 text-sm text-muted" title={walletRule(w.minimumBalance)}>
                  <span className="whitespace-nowrap">{WALLET_STATES[ws].label}</span>
                  {ws !== "healthy" && (
                    <Link to="/client/ewallet" className={cn("mt-0.5 block", linkCls)}>
                      Top up
                    </Link>
                  )}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted">No e-wallet yet</p>
              )}
            </div>
            <p
              className={cn(
                "whitespace-nowrap text-2xl font-semibold tracking-tight tabular",
                { danger: "text-danger", warning: "text-warning", success: "text-success", default: "text-ink" }[walletTone(w)],
              )}
            >
              {w ? formatPhp(w.balance) : "—"}
            </p>
          </div>
          <div className="flex items-start justify-between gap-4 border-t border-line pt-5">
            <div>
              <p className="text-sm font-medium text-muted">Units on hire</p>
              {!!x.onHire.length && (
                <p className="mt-1 text-sm text-muted">{formatPhp(x.onHire.reduce((a, u) => a + (u.accrued ?? 0), 0))} accrued</p>
              )}
            </div>
            <p className="text-2xl font-semibold tracking-tight tabular text-ink">{x.onHire.length}</p>
          </div>
          {/* Review 1.1 (RPT-009 / CLT-011): active contracts with the nearest expiry. */}
          <div className="flex items-start justify-between gap-4 border-t border-line pt-5">
            <div>
              <p className="text-sm font-medium text-muted">Active contracts</p>
              <p className="mt-1 text-sm text-muted">
                {x.activeContracts.nearestExpiry ? (
                  <Link
                    to="/client/contracts"
                    className={cn("hover:underline", expIn != null && expIn <= 30 && "font-medium text-warning")}
                  >
                    Expires {formatDate(x.activeContracts.nearestExpiry)}
                  </Link>
                ) : (
                  "No end date"
                )}
              </p>
            </div>
            <p className={cn("text-2xl font-semibold tracking-tight tabular", expIn != null && expIn <= 30 ? "text-warning" : "text-ink")}>
              {x.activeContracts.count}
            </p>
          </div>
        </Card>
      </div>
      <QuickActions x={x} />
      {/* Cards in a row stretch to the same height so no grey gap opens beside the longer list. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <OnHireCard x={x} eqName={eqName} onReturn={setReturning} />
        <AgingCard x={x} dueIn={dueIn} />
        <WalletCard x={x} />
        <ChargesCard x={x} />
        <ServiceRequestsCard x={x} />
        <ReturnsCard x={x} eqName={eqName} branchName={branchName} />
        <EwaHistoryCard x={x} eqName={eqName} />
        <FeedbackCard />
      </div>
      <ReturnRequestModal
        unit={returning}
        x={x}
        eqName={eqName}
        branchName={branchName}
        onClose={() => setReturning(null)}
      />
    </>
  );
}

// ── Quick actions: blocked actions are not links; they say why (BR-01). ──
function QuickActions({ x }: { x: Dash }) {
  const items = [
    { to: "/client/ewa", label: "Create EWA", hint: "Authorise a driver pickup", icon: Truck, scope: "ewa" as const, g: x.gates.ewa },
    { to: "/client/rescue", label: "Request rescue", hint: "Report a breakdown on the road", icon: LifeBuoy, scope: "rescue" as const, g: x.gates.rescue },
    { to: "/client/invoices", label: "View contracts & SOA", hint: "Invoices, balances and statement", icon: FileText, scope: null, g: { allowed: true } },
  ];
  return (
    <div className="mb-5 grid gap-5 sm:grid-cols-3">
      {items.map((q) => {
        const body = (
          <>
            <span
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-full",
                q.g.allowed ? "bg-brand-50 text-brand-600 group-hover:bg-surface" : "bg-surface text-danger",
              )}
            >
              {q.g.allowed ? <q.icon className="size-5" aria-hidden /> : <ShieldOff className="size-5" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-base font-semibold", q.g.allowed ? "text-ink" : "text-ink-2")}>{q.label}</span>
              <span className={cn("block text-sm", q.g.allowed ? "text-muted" : "font-medium text-danger")}>
                {q.g.allowed ? q.hint : q.scope ? restrictionHint(x, q.scope) : "Unavailable"}
              </span>
            </span>
            {q.g.allowed && <ArrowRight className="size-5 shrink-0 text-muted" aria-hidden />}
          </>
        );
        return q.g.allowed ? (
          <Link
            key={q.to}
            to={q.to}
            className="group flex items-center gap-4 rounded-card bg-surface p-5 shadow-card transition-colors duration-150 hover:bg-brand-50"
          >
            {body}
          </Link>
        ) : (
          // Disabled: not clickable, explained in place; the banner above says who to contact.
          <div
            key={q.to}
            role="group"
            aria-disabled="true"
            aria-label={`${q.label} — ${q.scope ? restrictionHint(x, q.scope) : "unavailable"}`}
            className="flex cursor-not-allowed items-center gap-4 rounded-card bg-danger-bg p-5 shadow-card"
          >
            {body}
          </div>
        );
      })}
    </div>
  );
}

// ── Overdue amount and aging (same six buckets as Aging and the SOA) ──
function AgingCard({ x, dueIn }: { x: Dash; dueIn?: number }) {
  const a = x.aging;
  const labels: Record<string, string> = { current: "Not yet due", d1_30: "1–30 days", d31_60: "31–60 days", d61_90: "61–90 days", d91_180: "91–180 days", d180: "Over 180 days" };
  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Balance by age"
        description="Unpaid invoices by days past the due date"
        actions={<Link to="/client/invoices" className="text-sm font-medium text-brand-600 hover:underline">Invoices & SOA</Link>}
      />
      {x.overdue > 0 ? (
        <Banner tone="danger" className="mb-4" title={`${formatPhp(x.overdue)} overdue`}>
          {plural(x.overdueCount, "invoice")} past due, the oldest {plural(x.oldestOverdueDays, "day")}. Please settle it to avoid a credit hold (BR-02).
        </Banner>
      ) : (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="success">Nothing overdue</Badge>
          <span className="text-muted">
            {dueIn == null ? "No unpaid invoices." : <>Next due {formatDate(x.oldestDue)} · {formatPhp(x.oldestDueAmount)} · {dueText(dueIn)}</>}
          </span>
        </p>
      )}
      <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {AGING_BUCKETS.map((b) => {
          const v = a[b.key];
          const late = b.key !== "current" && v > 0;
          return (
            <div key={b.key} className={cn("min-w-0 rounded-xl px-4 py-3", late ? "bg-danger-bg" : "bg-surface-alt")}>
              <dt className="text-sm text-muted">{labels[b.key]}</dt>
              <dd className={cn("mt-0.5 whitespace-nowrap font-semibold tabular", late ? "text-danger" : v > 0 ? "text-ink" : "text-muted")}>{formatPhp(v)}</dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-auto flex justify-between border-t border-line pt-4 text-sm">
        <span className="text-muted">Total unpaid</span>
        <strong className="tabular">{formatPhp(a.total)}</strong>
      </p>
    </Card>
  );
}

// ── On-hire equipment: contract, daily rate, hire days, accrued charge, request return ──
function OnHireCard({ x, eqName, onReturn }: { x: Dash; eqName: (c?: string) => string; onReturn: (u: OnHireRow) => void }) {
  const cols = "lg:grid-cols-[minmax(0,1.5fr)_8rem_6.5rem_7.5rem_4rem_7.5rem_10rem]";
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="On-hire equipment" description="Charges accrue daily at your contract rate until the unit is returned (Gate In)" />
      {x.onHire.length ? (
        <div className="text-sm">
          <MiniHead cols={cn("lg:grid", cols, "sm:hidden")}>
            <span>Unit</span>
            <span>Contract</span>
            <span className="text-right">Daily rate</span>
            <span>On hire since</span>
            <span className="text-right">Days</span>
            <span className="text-right">Accrued</span>
            <span className="text-right">Return</span>
          </MiniHead>
          <ul className="divide-y divide-line">
            {x.onHire.map((u) => (
              <li key={u.chassisNo} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 py-3 last:pb-0 lg:grid lg:gap-3", cols)}>
                <span className="min-w-0 basis-full lg:basis-auto">
                  <span className="font-mono font-medium">{u.chassisNo}</span> <span className="text-muted">· {eqName(u.chassisType)}</span>
                  {/* Timeline 2 review: one rule — every open rescue (Requested to In progress) tags the unit and blocks Request return. */}
                  {u.rescue && (
                    <Link to={`/client/rescue?open=${u.rescue.rescueNo}`} className="ml-2 inline-flex" title={`${u.rescue.rescueNo} · ${u.rescue.detail}`}>
                      <Badge tone="warning">{u.rescue.label} · {u.rescue.rescueNo} {u.rescue.status.toLowerCase()}</Badge>
                    </Link>
                  )}
                </span>
                <span><span className="text-muted lg:hidden">Contract </span><Link to="/client/contracts" className="font-mono text-sm hover:underline">{u.contractNo ?? "—"}</Link></span>
                <span className="tabular lg:text-right"><span className="text-muted lg:hidden">Rate </span>{u.dailyRate != null ? `${formatPhp(u.dailyRate)}/day` : "—"}</span>
                <span className="text-muted" title={u.gatePassNo ? `Gate Out ${u.gatePassNo}` : undefined}><span className="lg:hidden">Since </span>{formatDate(u.gateOut)}</span>
                <span className="tabular lg:text-right"><span className="text-muted lg:hidden">Day </span>{u.hireDays ?? "—"}</span>
                <span className="font-medium tabular lg:text-right"><span className="font-normal text-muted lg:hidden">Accrued </span>{formatPhp(u.accrued)}</span>
                <span className="ml-auto lg:ml-0 lg:text-right">
                  {u.returnRequest ? (
                    <span className="inline-flex flex-col items-end gap-0.5">
                      <Badge tone="info">Return requested</Badge>
                      <span className="text-sm text-muted">{u.returnRequest.requestNo} · {formatDate(u.returnRequest.preferredDate)} · {u.returnRequest.returnBranchCode}</span>
                    </span>
                  ) : u.canRequestReturn ? (
                    <Button size="sm" variant="secondary" onClick={() => onReturn(u)}>Request return</Button>
                  ) : u.rescue ? (
                    <span className="text-sm text-muted" title="Request return is available once the rescue is completed or cancelled">After the rescue</span>
                  ) : (
                    <span className="text-sm text-muted">Not available</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-line pt-4 text-sm text-muted">
            Accrued = days on hire × contract daily rate, before 12% VAT. Days count from the Gate Out day (the pickup day counts). The part already
            billed is in Unpaid bills; the rest goes on your next {x.client.billingCycle.toLowerCase()} invoice. A unit with an open rescue request
            (from Requested until Completed) shows “Under rescue” and is returned after the rescue.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">No units on hire.</p>
      )}
    </Card>
  );
}

/** Ask Delbros to collect an on-hire unit (proposed — Q-PTL-03: Delbros to confirm clients may request returns online). */
function ReturnRequestModal({ unit, x, eqName, branchName, onClose }: { unit: OnHireRow | null; x: Dash; eqName: (c?: string) => string; branchName: (c?: string) => string; onClose: () => void }) {
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const max = new Date(Date.now() + 8 * 3_600_000 + 60 * 86_400_000).toISOString().slice(0, 10);
  const blank = { branch: "", date: "", notes: "" };
  const [v, setV] = useState(blank);
  const [tried, setTried] = useState(false);
  const [last, setLast] = useState(unit);
  if (unit !== last) {
    setLast(unit);
    setV({ ...blank, branch: unit?.branchCode ?? "" });
    setTried(false);
  }
  // Timeline 2 review: the result says what the request created (RTN- reference), who received it, and what happens next.
  const [done, setDone] = useState<Awaited<ReturnType<typeof api.portal.requestReturn>> | null>(null);
  const send = useAction(
    () => api.portal.requestReturn({ chassisNo: unit!.chassisNo, returnBranchCode: v.branch, preferredDate: v.date, notes: v.notes }),
    { onSuccess: (r) => setDone(r) },
  );
  if (done) {
    return (
      <Modal open onClose={() => { setDone(null); onClose(); }} title={`Return requested — ${done.requestNo}`} footer={<Button onClick={() => { setDone(null); onClose(); }}>Done</Button>}>
        <Stack>
          <Banner tone="success" title={`${done.chassisNo} · return at ${branchName(done.returnBranchCode)} on ${formatDate(done.preferredDate)}`}>
            This is a request, not a booking: the branch confirms the Gate In date with you, and the unit shows “Return requested” until it is returned.
            Charges continue until the Gate In day.{done.crossBranch ? " Returning at another branch needs Delbros IT's cross-branch approval code (BR-16) — Delbros arranges it." : ""}
          </Banner>
          <div>
            <p className="mb-2 text-sm font-medium text-muted">Sent to</p>
            <ul className="divide-y divide-line rounded-2xl bg-surface-alt text-sm">
              {done.notified.map((n, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span>{n.recipient}<span className="block text-sm text-muted">{n.channel} · {n.to}</span></span>
                  <Badge tone={n.status === "Queued" ? "warning" : n.status === "Failed" ? "danger" : "success"}>{n.status === "Queued" ? "Queued for sending" : n.status}</Badge>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-sm text-muted">Proposed workflow (Delbros to confirm, Q-PTL-03): Requested → Scheduled by the branch → Completed at Gate In.</p>
        </Stack>
      </Modal>
    );
  }
  if (!unit) return null;
  const options = [...x.returnBranches];
  if (!options.some((b) => b.code === unit.branchCode)) options.unshift({ code: unit.branchCode, name: branchName(unit.branchCode) });
  const cross = !!v.branch && v.branch !== unit.branchCode;
  const fieldErr = (k: string) => (send.error as { fields?: Record<string, string> } | null)?.fields?.[k];
  return (
    <Modal
      open={!!unit}
      onClose={onClose}
      title={`Request return — ${unit.chassisNo}`}
      description="Delbros arranges the return. The branch and your Account Executive will confirm the date before the unit goes in."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={send.isPending} onClick={() => { setTried(true); if (v.branch && v.date) send.mutate(undefined); }}>Send request</Button>
        </>
      }
    >
      <Stack>
        <dl className="grid grid-cols-2 gap-4 rounded-2xl bg-surface-alt p-4 text-sm sm:grid-cols-4">
          <div><dt className="text-sm text-muted">Unit</dt><dd className="mt-0.5 font-medium text-ink">{eqName(unit.chassisType)}</dd></div>
          <div><dt className="text-sm text-muted">Contract</dt><dd className="mt-0.5 font-mono text-sm font-medium text-ink">{unit.contractNo}</dd></div>
          <div><dt className="text-sm text-muted">Released at</dt><dd className="mt-0.5 font-medium text-ink">{branchName(unit.branchCode)}</dd></div>
          <div><dt className="text-sm text-muted">Accrued so far</dt><dd className="mt-0.5 font-medium tabular text-ink">{formatPhp(unit.accrued)}</dd></div>
        </dl>
        <Select
          label="Return branch"
          required
          value={v.branch}
          error={(tried && !v.branch ? "Required" : undefined) ?? fieldErr("returnBranchCode")}
          onChange={(e) => setV({ ...v, branch: e.target.value })}
          options={options.map((b) => ({ value: b.code, label: `${b.name}${b.code === unit.branchCode ? " (where it was released)" : ""}` }))}
        />
        {cross && (
          <Banner tone="info" title="Cross-branch return">
            Returning at {branchName(v.branch)} instead of {branchName(unit.branchCode)} needs an approval code issued by Delbros IT before the gate can accept the
            unit (BR-16). Delbros arranges the code; allow an extra working day.
          </Banner>
        )}
        <Field label="Preferred return date" required error={(tried && !v.date ? "Required" : undefined) ?? fieldErr("preferredDate")} hint="Charges continue until the Gate In day.">
          {(id, describedBy) => (
            <DatePicker id={id} aria-describedby={describedBy} value={v.date} onChange={(date) => setV({ ...v, date })} min={today} max={max} invalid={tried && !v.date} />
          )}
        </Field>
        <Textarea label="Notes (optional)" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="e.g. Driver available after 2 PM; unit is empty" />
        {send.error && <Banner tone="danger">{errMessage(send.error)}</Banner>}
      </Stack>
    </Modal>
  );
}

// ── E-wallet: four states, recent transactions, cash bond withdrawal availability ──
function WalletCard({ x }: { x: Dash }) {
  const w = x.ewallet;
  const ws = walletStateOf(w);
  const b = x.cashBond;
  const why = [
    b.unpaid > 0 && `unpaid invoices ${formatPhp(b.unpaid)}`,
    b.negativeWallet > 0 && `negative e-wallet ${formatPhp(b.negativeWallet)}`,
    b.openDm > 0 && `pending debit memos ${formatPhp(b.openDm)}`,
  ].filter(Boolean) as string[];
  return (
    <Card className="flex flex-col">
      <CardHeader title="Recent e-wallet transactions" description="Used for rescue, repair and debit-memo charges" />
      {w && ws ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              Balance <strong className={cn("tabular", WALLET_STATES[ws].tone === "danger" ? "text-danger" : WALLET_STATES[ws].tone === "warning" ? "text-warning" : "text-success")}>{formatPhp(w.balance)}</strong>{" "}
              <span className="text-muted">· minimum {formatPhp(w.minimumBalance)}</span>
            </span>
            <Badge tone={WALLET_STATES[ws].tone}>{WALLET_STATES[ws].label}</Badge>
          </div>
          {/* The four states and their ranges, with the current one marked. */}
          <ul className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" aria-label="E-wallet states">
            {WALLET_ORDER.map((k) => (
              <li key={k} aria-current={k === ws ? "true" : undefined}
                className={cn("rounded-xl px-3 py-2", k === ws ? "font-medium ring-1 ring-inset ring-current" : "bg-surface-alt text-muted",
                  k === ws && (WALLET_STATES[k].tone === "danger" ? "bg-danger-bg text-danger" : WALLET_STATES[k].tone === "warning" ? "bg-warning-bg text-warning" : "bg-success-bg text-success"))}>
                <span className="block">{WALLET_STATES[k].label}</span>
                <span className="block tabular opacity-80">{WALLET_STATES[k].range(w.minimumBalance)}</span>
              </li>
            ))}
          </ul>
          {(ws === "below" || ws === "negative") && (
            <Banner tone="danger" className="mb-4">
              {ws === "negative"
                ? <>Your e-wallet is negative — charges exceeded the balance by {formatPhp(-w.balance)}.</>
                : <>Your balance is {formatPhp(w.minimumBalance - w.balance)} below the contract minimum.</>}{" "}
              <Link to="/client/ewallet" className="font-medium underline">Request a top-up</Link>.
            </Banner>
          )}
        </>
      ) : (
        <p className="mb-4 text-sm text-muted">No e-wallet yet — it is opened once Delbros confirms your first payment.</p>
      )}
      {x.walletTxns.length ? (
        <ul className="mb-4 divide-y divide-line">
          {x.walletTxns.map((t) => (
            <li key={t.id} className="flex justify-between gap-3 py-3 text-sm first:pt-0">
              <span className="min-w-0">
                <span className="block">{formatDate(t.at)} · {t.type}{t.category && t.category !== "Top-up" ? ` · ${t.category}` : ""}</span>
                <span className="block truncate text-sm text-muted">{[t.referenceType, t.referenceId].filter(Boolean).join(" ")}</span>
              </span>
              <span className="shrink-0 whitespace-nowrap text-right">
                <MoneyText value={t.amount} />
                <span className="block text-sm text-muted">Balance {formatPhp(t.balanceAfter)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-muted">No transactions.</p>
      )}
      <div className="mt-auto flex flex-wrap items-start justify-between gap-2 border-t border-line pt-4 text-sm">
        <span className="min-w-0 flex-1 text-muted">
          Cash bond held {formatPhp(b.held)} · refundable now <span className="text-ink">{formatPhp(b.refundable)}</span>
          {b.withdrawalPending ? (
            <> · <Badge tone="warning">Withdrawal pending</Badge></>
          ) : b.refundable > 0 ? (
            <> · <Link to="/client/ewallet" className={linkCls}>Request withdrawal</Link></>
          ) : b.held > 0 ? (
            // BR-14: nothing to withdraw — say why instead of offering a link that leads nowhere.
            <span className="mt-0.5 block text-sm">
              No withdrawal available{why.length ? ` — ${why.join(" and ")} ${why.length === 1 ? "is" : "are"} deducted from the bond first` : ""}.
            </span>
          ) : null}
        </span>
        <Link to="/client/ewallet" className={linkCls}>View full ledger</Link>
      </div>
    </Card>
  );
}

// ── Repair and debit-memo charges, their source, and where their effect shows ──
function ChargesCard({ x }: { x: Dash }) {
  return (
    <Card className="flex flex-col">
      <div id="charges" className="scroll-mt-24" />
      <CardHeader title="Repair & debit memo charges" description="Charges outside your lease bills, with their source and how each was settled" />
      {x.charges.length ? (
        <ul className="divide-y divide-line">
          {x.charges.slice(0, 5).map((c) => {
            const s = c.settlement;
            return (
              <li key={c.ref} className="py-3 text-sm first:pt-0">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-mono font-medium">{c.ref}</span> <Badge tone="neutral" dot={false}>{c.kind}</Badge>
                    <span className="mt-0.5 block text-sm text-muted">{formatDate(c.at)} · {c.source}{c.reason ? ` · ${c.reason}` : ""}</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-right font-medium tabular">{formatPhp(c.amount)}</span>
                </div>
                <p className="mt-1 text-sm">
                  {s.how === "ewallet" ? (
                    <>Deducted from your e-wallet {formatDate(s.at)} ({s.txnId}) · balance after {formatPhp(s.balanceAfter)} · <Link to="/client/ewallet" className={linkCls}>see ledger</Link></>
                  ) : s.how === "invoice_due" ? (
                    <span className="text-warning">On invoice {s.invoiceNo} · {formatPhp(s.balance)} due {formatDate(s.dueDate)} · <Link to={`/client/invoices?open=${s.invoiceNo}`} className={linkCls}>view invoice</Link></span>
                  ) : s.how === "paid" ? (
                    <span className="text-success">Paid (invoice {s.invoiceNo})</span>
                  ) : s.how === "invoice" ? (
                    <>Applied to invoice {s.invoiceNo}</>
                  ) : s.how === "pending" ? (
                    <span className="text-muted">Awaiting Delbros approval — nothing charged yet</span>
                  ) : (
                    <span className="text-muted">Posted, not yet settled — it will be deducted from your e-wallet or added to your next invoice</span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-muted">No repair or debit-memo charges.</p>
      )}
      <p className="mt-auto border-t border-line pt-4 text-sm text-muted">
        Where to see the effect: e-wallet deductions appear in the <Link to="/client/ewallet" className={linkCls}>E-wallet ledger</Link> with the memo or rescue
        reference; repair invoices and memos applied to invoices appear on <Link to="/client/invoices" className={linkCls}>Invoices & SOA</Link>.
      </p>
    </Card>
  );
}

function ServiceRequestsCard({ x }: { x: Dash }) {
  return (
    <Card>
      <CardHeader
        title="Open service requests"
        description="Rescue requests not yet completed"
        actions={<Link to="/client/rescue" className="text-sm font-medium text-brand-600 hover:underline">All requests</Link>}
      />
      {x.openRescues.length ? (
        <ul className="divide-y divide-line">
          {x.openRescues.map((r) => (
            <li key={r.rescueNo} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm first:pt-0 last:pb-0">
              <span>
                <Link to={`/client/rescue?open=${r.rescueNo}`} className="font-mono font-medium hover:underline">{r.rescueNo}</Link>{" "}
                <span className="text-muted">· {r.chassisNo} · {formatDateTime(r.requestedAt)}{r.urgent ? " · urgent" : ""}</span>
              </span>
              <span className="flex items-center gap-2">
                {r.eta && <span className="text-sm text-muted">ETA {formatDateTime(r.eta)}</span>}
                <PortalStatus domain="rescue" value={r.status} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No open service requests.</p>
      )}
    </Card>
  );
}

// ── Returned equipment: branch, Gate In, condition, final charges, hire duration, BR-16 code ──
function ReturnsCard({ x, eqName, branchName }: { x: Dash; eqName: (c?: string) => string; branchName: (c?: string) => string }) {
  const Item = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
  return (
    <Card className="lg:col-span-2">
      <div id="returns" className="scroll-mt-24" />
      <CardHeader title="Returned equipment" description="Units you have returned (Gate In), with the final hire charges" />
      {x.returns.length ? (
        <ul className="divide-y divide-line">
          {x.returns.map((r) => (
            <li key={r.gatePassNo} className="py-4 text-sm first:pt-0 last:pb-0">
              <p className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-mono font-medium">{r.chassisNo}</span>
                <span className="text-muted">· {eqName(r.chassisType)}</span>
                <Badge tone={r.condition === "Roadworthy" ? "success" : "danger"}>{r.condition}</Badge>
                {r.crossBranch && <Badge tone="purple" icon={<ArrowRightLeft className="size-3" aria-hidden />}>Cross-branch</Badge>}
              </p>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                <Item label="Released (Gate Out)">
                  {formatDateTime(r.hiredAt)}
                  <span className="block text-sm text-muted">{branchName(r.originBranchCode)}{r.outGatePassNo ? ` · ${r.outGatePassNo}` : ""}</span>
                </Item>
                <Item label="Returned (Gate In)">
                  {formatDateTime(r.returnedAt)}
                  <span className="block text-sm text-muted">{branchName(r.branchCode)} · {r.gatePassNo}{r.eirNo && r.eirNo !== "—" ? ` · ${r.eirNo}` : ""}</span>
                </Item>
                <Item label="Hire duration">
                  {r.durationDays != null ? plural(r.durationDays, "day") : "—"}
                  {r.billableDays != null && <span className="block text-sm text-muted">{r.billableDays} billable (pickup and return day both count)</span>}
                </Item>
                <Item label="Final charges (before VAT)">
                  <span className="font-medium tabular">{formatPhp(r.finalCharges)}</span>
                  <span className="block text-sm text-muted">
                    {r.billableDays != null && r.dailyRate != null ? `${r.billableDays} × ${formatPhp(r.dailyRate)}/day = ${formatPhp(r.leaseCharge)}` : "Lease charge pending"}
                    {r.damageCharge > 0 ? ` + damage ${formatPhp(r.damageCharge)}` : " · no damage charges"}
                  </span>
                </Item>
                <Item label="Condition at return">
                  {r.remarks ?? (r.condition === "Roadworthy" ? "No issues noted" : "Repair needed")}
                  {!!r.damage.length && <span className="block text-sm text-muted">Chargeable: {r.damage.map((dm) => `${dm.part} ${formatPhp(dm.amount)}`).join(", ")}</span>}
                </Item>
                <Item label="Cross-branch approval (BR-16)">
                  {r.crossBranch ? (
                    r.approvalCode ? <><span className="font-mono">{r.approvalCode}</span><span className="block text-sm text-muted">IT approval code · {r.originBranchCode} → {r.branchCode}</span></> : <span className="text-warning">Code not recorded</span>
                  ) : (
                    <span className="text-muted">Not needed — returned where released</span>
                  )}
                </Item>
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No returns yet.</p>
      )}
    </Card>
  );
}

// ── EWA history: trucker, equipment type and the cancellation reason ──
function EwaHistoryCard({ x, eqName }: { x: Dash; eqName: (c?: string) => string }) {
  const cols = "lg:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_8.5rem_8.5rem_7rem]";
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="EWA history" actions={<Link to="/client/ewa" className="text-sm font-medium text-brand-600 hover:underline">All EWAs</Link>} />
      {x.ewas.length ? (
        <div className="text-sm">
          <MiniHead cols={cn("lg:grid", cols, "sm:hidden")}>
            <span>EU no.</span>
            <span>Branch · driver</span>
            <span>Trucker · truck</span>
            <span>Equipment</span>
            <span>Created</span>
            <span>Valid until</span>
            <span>Status</span>
          </MiniHead>
          <ul className="divide-y divide-line">
            {x.ewas.map((e) => (
              <li key={e.euNo} className={cn("flex flex-wrap items-center gap-x-4 gap-y-0.5 py-3 last:pb-0 lg:grid lg:gap-3", cols)}>
                <Link to={`/client/ewa?open=${e.euNo}`} className="font-mono font-medium hover:underline">{e.euNo}</Link>
                <span className="min-w-0 truncate">{e.branchCode} · {e.driverName}</span>
                <span className="min-w-0 truncate text-ink-2">{e.trucker} · <span className="text-muted">{e.truckPlateNo}</span></span>
                <span className="min-w-0 truncate text-ink-2">{e.units.map((u) => `${eqName(u.equipmentType)}${u.qty > 1 ? ` × ${u.qty}` : ""}`).join(", ")}</span>
                <span className="text-muted max-lg:hidden">{formatDateTime(e.createdAt)}</span>
                <span className="text-muted"><span className="lg:hidden">Valid until </span>{formatDateTime(e.validUntil)}</span>
                <span className="max-lg:ml-auto">
                  {e.status === "Extension Pending" ? <Badge tone="warning">Extension requested</Badge> : <PortalStatus domain="ewa" value={e.status} />}
                  {/* Timeline 2 review (proposed entry point): cancel an Active EWA before any release — opens the same dialog as the EWA page. */}
                  {e.status === "Active" && e.units.every((u) => u.usedChassis.length === 0) && (
                    <Link to={`/client/ewa?open=${e.euNo}&cancel=1`} className="mt-0.5 block text-sm font-medium text-danger hover:underline">Cancel EWA</Link>
                  )}
                </span>
                {e.status === "Cancelled" && (
                  <span className="basis-full text-sm text-muted lg:col-span-6 lg:col-start-2">
                    Cancelled {formatDateTime(e.cancelledAt)}: <span className="text-ink-2">{e.cancelReason ?? "No reason recorded."}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted">No EWAs yet.</p>
      )}
    </Card>
  );
}

// ── Service rating: 1–5 stars on a chosen service, optional comment; goes to the Account Executive ──
const RATING_TOPICS = ["Overall service", "EWA and gate release", "Rescue", "Repairs", "Billing and statements", "Account Executive", "Client portal"];
const STAR_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
function FeedbackCard() {
  const mine = useData(["portal-feedback"], () => api.portal.myFeedback());
  const blank = { rating: 0, topic: RATING_TOPICS[0], comment: "" };
  const [v, setV] = useState(blank);
  const [hover, setHover] = useState(0);
  const [tried, setTried] = useState(false);
  const [other, setOther] = useState(false);
  const send = useAction(
    () => api.portal.submitFeedback({ category: "Service rating", subject: "", message: v.comment, rating: v.rating, topic: v.topic }),
    { success: (r) => `Thank you — rating ${r.id} sent to your Account Executive`, onSuccess: () => { setV(blank); setTried(false); } },
  );
  const shown = hover || v.rating;
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Rate our service"
        description="Tell us how we did. Your Account Executive reads every rating."
        actions={<Button size="sm" variant="secondary" onClick={() => setOther(true)}>Send other feedback or a request</Button>}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Stack>
          <div>
            <p id="rate-label" className="mb-1.5 text-sm font-medium text-ink">Your rating <span className="text-danger">*</span></p>
            <div role="radiogroup" aria-labelledby="rate-label" className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={v.rating === n} aria-label={`${n} star${n === 1 ? "" : "s"} — ${STAR_WORDS[n]}`}
                  onMouseEnter={() => setHover(n)} onClick={() => setV({ ...v, rating: n })}
                  className="rounded-full p-1 transition-transform duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-brand-600">
                  <Star className={cn("size-7", n <= shown ? "fill-amber-400 text-amber-400" : "text-line")} aria-hidden />
                </button>
              ))}
              <span className="ml-2 text-sm text-muted">{shown ? STAR_WORDS[shown] : "Choose 1 to 5 stars"}</span>
            </div>
            {tried && !v.rating && <p role="alert" className="mt-1.5 text-sm text-danger">Choose a rating</p>}
          </div>
          <Select label="About" value={v.topic} onChange={(e) => setV({ ...v, topic: e.target.value })} options={RATING_TOPICS.map((t) => ({ value: t, label: t }))} />
          <Textarea label="Comment (optional)" value={v.comment} onChange={(e) => setV({ ...v, comment: e.target.value })} placeholder="What went well, or what should we improve?" />
          {send.error && <Banner tone="danger">{errMessage(send.error)}</Banner>}
          <div>
            <Button loading={send.isPending} onClick={() => { setTried(true); if (v.rating) send.mutate(undefined); }}>Send rating</Button>
          </div>
        </Stack>
        <div className="text-sm">
          <p className="mb-2 text-sm font-medium text-muted">Your recent feedback</p>
          {mine.data?.length ? (
            <ul className="divide-y divide-line">
              {mine.data.slice(0, 4).map((f) => (
                <li key={f.id} className="flex justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="min-w-0">
                    <span className="font-mono text-sm font-medium">{f.id}</span>{" "}
                    {f.rating ? <span className="text-amber-500" aria-label={`${f.rating} stars`}>{"★".repeat(f.rating)}<span className="text-line">{"★".repeat(5 - f.rating)}</span></span> : <span className="text-muted">{f.category}</span>}
                    <span className="block truncate text-sm text-muted">{formatDate(f.submittedAt)} · {f.topic ?? f.subject}</span>
                  </span>
                  <Badge tone={f.status === "Submitted" ? "info" : f.status === "Acknowledged" ? "success" : "neutral"}>{f.status === "Submitted" ? "Received" : f.status}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Nothing sent yet.</p>
          )}
        </div>
      </div>
      <FeedbackModal open={other} onClose={() => setOther(false)} />
    </Card>
  );
}
