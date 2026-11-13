// ── Contracts (client view) ────────────────────────────────────────────────
// Portal Contracts review (2026-11-11) — the items marked "Not met":
//  • entitlement for every equipment type ("Not entitled — on request" where 0), with what is on hire and still requestable
//  • lock-in end date and the BR-15 pre-termination fee (proposed formula)        • rate history and the rate card (BR-18)
//  • minimum billing days and renewal notices                                   • several contracts: list, status filter, detail view
//  • the renewal / amendment / termination request form and its status          • branches covered against actual activity
import { useState } from "react";
import { Link } from "react-router";
import { CheckCircle2, FileText } from "lucide-react";
import { api } from "../lib/api-client";
import { CONTRACT_TYPES, formatDate, formatDateTime, formatPhp, preTerminationFee } from "../lib/shared";
import { Badge, Banner, Button, Card, CardHeader, DatePicker, Field, Input, Modal, PageHeader, Segmented, Select, Stack, Textarea, cn } from "../lib/ui";
import { errMessage, useAction, useData } from "../auth";
import { PortalStatus, daysFromToday, plural } from "./portalUi";

type Ct = Awaited<ReturnType<typeof api.portal.contracts>>[number];
const FILTERS = ["All", "Active", "Expired", "Terminated", "Renewed"] as const;

export function ClientContractsPage() {
  const list = useData(["portal-contracts"], () => api.portal.contracts());
  const ref = useData(["ref"], () => api.ref.all());
  const eqName = (c: string) => ref.data?.equipmentTypes.find((e) => e.code === c)?.name ?? c;
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [sel, setSel] = useState<string | null>(null);
  const [req, setReq] = useState<Ct | null>(null);
  const rows = (list.data ?? []).filter((c) => filter === "All" || c.status === filter);
  const current = (list.data ?? []).find((c) => c.contractNo === sel) ?? rows[0];
  return (
    <>
      <PageHeader title="Contracts" description="Your lease contracts — terms, entitlement, daily rates and their history. Select a contract to see its details." />
      <Card className="mb-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Your contracts ({list.data?.length ?? 0})</h2>
          <div className="max-w-full overflow-x-auto">
            <Segmented value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f, label: `${f}${f === "All" ? "" : ` (${(list.data ?? []).filter((c) => c.status === f).length})`}` }))} />
          </div>
        </div>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-sm font-medium text-muted">
                  <th className="py-2 pr-3">Contract</th><th className="pr-3">Type</th><th className="pr-3">Term</th><th className="pr-3">Status</th>
                  <th className="pr-3 text-right">Units</th><th className="pr-3 text-right">On hire</th><th className="text-right">Cash bond</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.contractNo} onClick={() => setSel(c.contractNo)} aria-selected={current?.contractNo === c.contractNo}
                    className={cn("cursor-pointer border-b border-line transition-colors duration-150 last:border-0 hover:bg-brand-50/60", current?.contractNo === c.contractNo && "bg-brand-50")}>
                    <td className="py-3 pr-3 font-mono font-medium text-brand-700">{c.contractNo}</td>
                    <td className="pr-3">{CONTRACT_TYPES[c.contractType]?.name ?? c.contractType}</td>
                    {/* Timeline 2 review: a terminated contract shows its termination date as such — Spot List has no expiry (BR-12). */}
                    <td className="pr-3 whitespace-nowrap">
                      {formatDate(c.effectiveDate)} – {c.status === "Terminated" && c.termination?.effectiveDate ? <>terminated {formatDate(c.termination.effectiveDate)}</> : c.expiryDate ? formatDate(c.expiryDate) : "no expiry"}
                      {c.status === "Terminated" && !c.expiryDate && <span className="block text-sm text-muted">no contractual expiry</span>}
                    </td>
                    <td className="pr-3"><PortalStatus domain="contract" value={c.status} /></td>
                    <td className="pr-3 text-right tabular">{c.unitQty}</td>
                    <td className="pr-3 text-right tabular">{c.onHireUnits.length}</td>
                    <td className="text-right tabular">{c.bondHeld ? formatPhp(c.bondHeld) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">{list.isLoading ? "Loading…" : `No ${filter === "All" ? "" : filter.toLowerCase() + " "}contracts.`}</p>
        )}
      </Card>
      {current && <ContractDetail c={current} eqName={eqName} onRequest={() => setReq(current)} />}
      <ContractRequestDialog c={req} onClose={() => setReq(null)} />
    </>
  );
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{children}</dd>
    </div>
  );
}

function ContractDetail({ c, eqName, onRequest }: { c: Ct; eqName: (c: string) => string; onRequest: () => void }) {
  const left = c.expiryDate && c.status === "Active" ? daysFromToday(c.expiryDate) : undefined;
  const signed = c.history?.find((h) => h.status === "Signed")?.at;
  const notarized = c.history?.find((h) => h.status === "Notarized")?.at;
  const pt = c.preTermination;
  const nextNotice = c.renewalNotices.find((n) => !n.sent);
  const openReq = c.requests.find((r) => r.status === "Submitted" || r.status === "Under review");
  return (
    <Card>
      <CardHeader
        title={<span className="font-mono">{c.contractNo}</span>}
        description={`${CONTRACT_TYPES[c.contractType]?.name ?? c.contractType} (${c.contractType}, class ${c.class}) · ${formatDate(c.effectiveDate)} – ${c.expiryDate ? formatDate(c.expiryDate) : c.status === "Terminated" && c.termination ? `terminated ${formatDate(c.termination.effectiveDate)} (no contractual expiry)` : "no expiry"} · version ${c.version ?? 1}`}
        actions={
          <span className="flex flex-col items-end gap-1.5">
            <PortalStatus domain="contract" value={c.status} />
            {left != null && <span className={cn("text-sm", left <= 30 ? "font-medium text-warning" : "text-muted")}>{left < 0 ? "Past end date" : left === 0 ? "Ends today" : `Expires in ${plural(left, "day")}`}</span>}
          </span>
        }
      />
      {c.status === "Terminated" && c.termination && (
        <Banner tone="info" className="mb-4" title={`Terminated ${formatDate(c.termination.effectiveDate)}`}>{c.termination.reason}</Banner>
      )}
      {c.status === "Expired" && <Banner tone="info" className="mb-4" title={`Expired ${formatDate(c.expiryDate)}`}>The contract reached its end date. Units still out under it are billed until returned.</Banner>}
      {/* Timeline 2 review: renewal state and what happened to the cash bond, on every contract (inactive ones especially). */}
      {(c.renewal || (c.status !== "Active" && c.bonds.length > 0)) && (
        <dl className="mb-6 grid gap-x-6 gap-y-4 rounded-2xl bg-surface-alt p-4 text-sm sm:grid-cols-2">
          {c.renewal && (
            <Term label="Renewal">
              {c.renewal.state}{c.renewal.date ? ` · ${formatDate(c.renewal.date)}` : ""}{c.renewal.successor ? ` → ${c.renewal.successor}` : ""}
              {c.renewal.note && <span className="block text-sm font-normal text-muted">{c.renewal.note}</span>}
            </Term>
          )}
          {c.status !== "Active" && (
            <Term label="Cash bond">
              {c.bonds.length ? c.bonds.map((b) => (
                <span key={b.id} className="block">
                  {formatPhp(b.amount)} received {formatDate(b.dateReceived)} ({b.receiptRef}) — {b.outcome ? `${b.outcome.kind.toLowerCase()} ${formatDate(b.outcome.at)}, ref ${b.outcome.reference}` : b.status.toLowerCase()}
                  {b.outcome && <span className="block text-sm font-normal text-muted">{b.outcome.note}</span>}
                </span>
              )) : "No cash bond on this contract"}
            </Term>
          )}
        </dl>
      )}

      {/* Terms, with the lock-in end, BR-15 fee, minimum billing days and renewal notices. */}
      <dl className="mb-6 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
        <Term label="Billing cycle">{c.billingCycle}</Term>
        <Term label="Credit term">{c.creditTermDays} days from invoice date</Term>
        <Term label="Cash bond held">{formatPhp(c.bondHeld)}</Term>
        <Term label="E-wallet minimum">{c.ewalletMinimum != null ? formatPhp(c.ewalletMinimum) : "—"}</Term>
        <Term label="Lock-in period (BR-15)">
          {c.lockInMonths ? <>{c.lockInMonths} months<span className="block text-sm font-normal text-muted">ends {formatDate(c.lockInEnd)}</span></> : "None"}
        </Term>
        <Term label="Pre-termination fee (BR-15)">
          {!c.lockInMonths ? "None — no lock-in" : c.status !== "Active" ? "—" : pt.inLockIn ? (
            <>{formatPhp(pt.fee)} if ended today
              <span className="block text-sm font-normal text-muted">{pt.chargeableDays} of {pt.remainingDays} lock-in days left (max {pt.capDays}) × {formatPhp(pt.dailyTotal)}/day for {plural(pt.unitsOnHire, "unit")} on hire · proposed</span></>
          ) : <>None<span className="block text-sm font-normal text-muted">lock-in ended {formatDate(c.lockInEnd)}</span></>}
        </Term>
        <Term label="Minimum billing">{plural(c.minBillingDays, "day")} per release<span className="block text-sm font-normal text-muted">pickup day counts · proposed</span></Term>
        <Term label="Renewal notices">
          {c.renewalNotices.length ? (
            <>{c.renewalNotices.map((n) => `${n.monthsBefore} mo ${formatDate(n.date)}${n.sent ? " ✓" : ""}`).join(" · ")}
              <span className="block text-sm font-normal text-muted">{nextNotice ? `next on ${formatDate(nextNotice.date)}` : "all sent"} · DBL-CLT-011</span></>
          ) : "—"}
        </Term>
        <Term label="Late payment interest">{c.penalties.lateInterestPct}% per month</Term>
        <Term label="Non-return penalty">{formatPhp(c.penalties.nonReturn)} per unit</Term>
        <Term label="Dishonored check">{formatPhp(c.penalties.dishonoredCheck)}</Term>
        {/* Timeline 2 review: the fourth penalty in the Screen Inventory, and the DBL-CLT-008 fields (internal-only scope to be confirmed). */}
        <Term label="Deferred check">{formatPhp(c.penalties.deferredCheck)}<span className="block text-sm font-normal text-muted">contract value · rule pending approval</span></Term>
        <Term label="Payment method">{c.paymentMethod}</Term>
        <Term label="Client signatory">{c.signatory ? <>{c.signatory.name}<span className="block text-sm font-normal text-muted">{c.signatory.email}</span></> : "—"}</Term>
        <Term label="Region">{c.regionName}</Term>
        <Term label="Units contracted">{c.unitQty}</Term>
        <Term label="Signed">{signed ? formatDate(signed) : "—"}</Term>
        <Term label="Notarized">{notarized ? formatDate(notarized) : "—"}</Term>
      </dl>

      {/* Entitlement and daily rates for every equipment type. */}
      <h3 className="mb-1.5 text-base font-semibold tracking-tight text-ink">Equipment, entitlement and daily rates</h3>
      <p className="mb-3 text-sm text-muted">Daily rates per unit, before 12% VAT · current version effective {formatDate(c.rateHistory?.at(-1)?.validFrom ?? c.effectiveDate)}. Rates follow the approved {c.contractType} rate card (BR-18).</p>
      <div className="mb-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-sm font-medium text-muted">
              <th className="py-2 pr-3">Equipment type</th><th className="pr-3 text-right">Daily rate</th><th className="pr-3 text-right">Rate card</th>
              <th className="pr-3 text-right" title="Indemnity / loss value per unit — charged if a unit is lost or force-inbounded (BR-17)">Indemnity / loss</th>
              <th className="pr-3 text-right">Entitled</th><th className="pr-3 text-right">On hire</th>{c.status === "Active" && <><th className="pr-3 text-right">On open EWAs</th><th className="text-right">Can still request</th></>}
            </tr>
          </thead>
          <tbody>
            {c.entitlement.map((e) => (
              <tr key={e.equipmentType} className={cn("border-b border-line last:border-0", e.entitled === 0 && "text-muted")}>
                <td className="py-2.5 pr-3">{eqName(e.equipmentType)}</td>
                <td className="pr-3 text-right tabular">{formatPhp(e.dailyRate)}</td>
                <td className="pr-3 text-right tabular text-muted">{e.rateCard != null ? (e.rateCard === e.dailyRate ? "same" : formatPhp(e.rateCard)) : "—"}</td>
                <td className="pr-3 text-right tabular">{formatPhp(e.indemnity)}</td>
                <td className="pr-3 text-right">{e.entitled == null ? <span className="text-sm">within the contract total</span> : e.entitled === 0 ? <span className="text-sm">Not entitled — on request</span> : <span className="tabular">{e.entitled}</span>}</td>
                <td className={cn("pr-3 text-right tabular", e.onHire > (e.entitled ?? Infinity) && "font-medium text-danger")}>{e.onHire || "—"}</td>
                {c.status === "Active" && <><td className="pr-3 text-right tabular">{e.pending || "—"}</td><td className="text-right tabular">{e.entitled === 0 ? "—" : e.remaining ?? "—"}</td></>}
              </tr>
            ))}
          </tbody>
          {c.entitlementTotals && (
            <tfoot>
              <tr className="font-medium"><td className="pt-2" colSpan={4}>Total</td><td className="pt-2 pr-3 text-right tabular">{c.entitlement.reduce((a, e) => a + (e.entitled ?? 0), 0) || c.unitQty} of {c.unitQty}</td>
                <td className="pt-2 pr-3 text-right tabular">{c.entitlementTotals.onHire}</td><td className="pt-2 pr-3 text-right tabular">{c.entitlementTotals.pending}</td><td className="pt-2 text-right tabular">{c.entitlementTotals.remaining}</td></tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mb-6 text-sm text-muted">
        “Not entitled — on request”: the type is on the rate card but not in this contract’s allocation; ask your Account Executive to add it
        (an amendment). Every unit on hire is of an entitled type. Indemnity / loss is the value charged per unit if it is lost or brought back by
        Force Inbound (BR-17). Where a rate differs in size order (for example the 20ft flatbed above the
        45ft chassis), the contract follows the approved rate card — Delbros to confirm the card.
      </p>

      {/* BR-18 rate history. */}
      {!!c.rateHistory?.length && (
        <div className="mb-5">
          <h3 className="mb-1.5 text-base font-semibold tracking-tight text-ink">Rate history</h3>
          <ul className="divide-y divide-line rounded-2xl bg-surface-alt text-sm">
            {[...c.rateHistory].reverse().map((v, i, all) => {
              const prev = all[i + 1];
              const changed = prev ? v.rates.filter((r) => prev.rates.find((p) => p.equipmentType === r.equipmentType)?.dailyRate !== r.dailyRate) : [];
              return (
                <li key={v.version} className="px-4 py-3">
                  <span className="font-medium">Version {v.version}</span> <span className="text-muted">· {formatDate(v.validFrom)} – {v.validTo ? formatDate(v.validTo) : "current"}</span>
                  <span className="block text-sm text-muted">{v.reason}</span>
                  {changed.length ? (
                    <span className="block text-sm">{changed.map((r) => `${eqName(r.equipmentType)} ${formatPhp(prev!.rates.find((p) => p.equipmentType === r.equipmentType)?.dailyRate)} → ${formatPhp(r.dailyRate)}`).join(" · ")}</span>
                  ) : !prev ? <span className="block text-sm text-muted">{v.rates.map((r) => `${eqName(r.equipmentType)} ${formatPhp(r.dailyRate)}`).join(" · ")}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Branches covered = the branches enabled for the account; every release and EWA should be inside them. */}
      <h3 className="mb-1.5 text-base font-semibold tracking-tight text-ink">Branches covered</h3>
      <p className="mb-2 text-sm text-ink-2">
        {c.branches.covered.map((b) => b.name).join(", ")}
        <span className="block text-sm text-muted">The branches enabled for your account — the same list New EWA offers. Pickups and releases happen only at these branches. Every covered branch is listed below, with zeros where there has been no activity yet.</span>
      </p>
      {!!c.branches.activity.length && (
        <div className="mb-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-sm font-medium text-muted"><th className="py-2 pr-3">Branch</th><th className="pr-3 text-right">EWAs</th><th className="pr-3 text-right">Releases</th><th className="pr-3 text-right">On hire now</th><th className="text-right">Covered</th></tr></thead>
            <tbody>
              {c.branches.activity.map((a) => (
                <tr key={a.code} className="border-b border-line last:border-0">
                  <td className="py-2.5 pr-3">{a.name}</td><td className="pr-3 text-right tabular">{a.ewas}</td><td className="pr-3 text-right tabular">{a.releases}</td><td className="pr-3 text-right tabular">{a.onHire || "—"}</td>
                  <td className="text-right">{a.covered ? <Badge tone="success" dot={false}>Yes</Badge> : <Badge tone="danger" dot={false}>No</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={cn("mb-6 text-sm", c.branches.outside.length ? "text-danger" : "text-muted")}>
        {c.branches.outside.length ? `Activity outside the covered branches: ${c.branches.outside.join(", ")} — your Account Executive will review it.` : "All EWAs and releases under this contract are inside the covered branches."}
      </p>

      <div className="mb-5 text-sm">
        <p className="mb-2 text-sm font-medium text-muted">Units on hire under this contract ({c.onHireUnits.length})</p>
        {c.onHireUnits.length ? (
          <p className="flex flex-wrap gap-x-4 gap-y-1">{c.onHireUnits.map((u) => <span key={u.chassisNo}><span className="font-mono">{u.chassisNo}</span> <span className="text-muted">· {eqName(u.chassisType)} · {u.branchCode}</span></span>)}</p>
        ) : <p className="text-muted">None at the moment.</p>}
      </div>

      {/* Requests sent from the portal, with their status. */}
      {!!c.requests.length && (
        <div className="mb-5">
          <p className="mb-2 text-sm font-medium text-muted">Your requests on this contract</p>
          <ul className="divide-y divide-line rounded-2xl bg-surface-alt text-sm">
            {c.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <span className="min-w-0">
                  <span className="font-mono">{r.id}</span> · {r.kind}{r.changeArea ? ` — ${r.changeArea}` : ""}{r.termMonths ? ` — ${r.termMonths} months` : ""}{r.effectiveDate ? ` — from ${formatDate(r.effectiveDate)}` : ""}
                  <span className="block text-sm text-muted">Sent {formatDateTime(r.submittedAt)} · {r.details}</span>
                  {r.feeEstimate != null && <span className="block text-sm text-muted">Pre-termination fee estimate {formatPhp(r.feeEstimate)}</span>}
                  {r.decisionNote && <span className="block text-sm">{r.status} {formatDate(r.decidedAt)}{r.decidedByName ? ` by ${r.decidedByName}` : ""}: {r.decisionNote}</span>}
                </span>
                <Badge tone={r.status === "Approved" ? "success" : r.status === "Declined" ? "danger" : r.status === "Withdrawn" ? "neutral" : "warning"}>{r.status === "Submitted" ? "Sent — awaiting review" : r.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-sm">
        {!!c.documents?.length && (
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {c.documents.map((doc, i) => (
              <li key={i} className="flex items-center gap-1.5"><FileText className="size-4 text-muted" /><span className="text-muted">{doc.kind}</span><span className="font-mono text-sm text-ink">{doc.fileName}</span></li>
            ))}
          </ul>
        )}
        {c.status === "Active" && (
          <span className="ml-auto flex flex-col items-end gap-1.5">
            <Button size="sm" variant="secondary" onClick={onRequest}>Request renewal / amendment / termination</Button>
            {openReq && <span className="text-sm text-warning">{openReq.id} {openReq.kind.toLowerCase()} awaiting review</span>}
          </span>
        )}
      </div>
    </Card>
  );
}

const CHANGE_AREAS = ["Equipment types or quantities", "Branches covered", "Daily rates", "Billing cycle or credit term", "Signatory or contact", "Other"];
/** Renewal / amendment / termination request: the fields for each kind, the BR-15 fee estimate for a termination, and the result. */
function ContractRequestDialog({ c, onClose }: { c: Ct | null; onClose: () => void }) {
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const blank = { kind: "Renewal" as "Renewal" | "Amendment" | "Termination", details: "", termMonths: 12, changeArea: "", effectiveDate: "" };
  const [v, setV] = useState(blank);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<Awaited<ReturnType<typeof api.portal.requestContractChange>> | null>(null);
  const [last, setLast] = useState<Ct | null>(null);
  if (c !== last) { setLast(c); setV(blank); setTried(false); setDone(null); }
  const send = useAction(() => api.portal.requestContractChange({ contractNo: c!.contractNo, kind: v.kind, details: v.details, termMonths: v.termMonths, changeArea: v.changeArea, effectiveDate: v.effectiveDate }), { onSuccess: (r) => setDone(r) });
  if (!c) return null;
  const fieldErr = (f: string) => (send.error as { fields?: Record<string, string> } | null)?.fields?.[f];
  const fee = v.kind === "Termination" && v.effectiveDate ? preTerminationFee({ effectiveDate: c.effectiveDate, lockInMonths: c.lockInMonths, asOf: v.effectiveDate, dailyTotal: c.preTermination.dailyTotal, capDays: c.preTermination.capDays }) : undefined;
  const ok = v.details.trim().length >= 10 && (v.kind !== "Renewal" || (v.termMonths >= 1 && v.termMonths <= 60)) && (v.kind !== "Amendment" || !!v.changeArea) && (v.kind !== "Termination" || !!v.effectiveDate);
  return (
    <Modal open onClose={onClose} size="lg" title={done ? "Request sent" : `Request for ${c.contractNo}`}
      description={done ? undefined : "Your Account Executive reviews it with the Sales Director; you can follow the status on this contract."}
      footer={done ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={send.isPending} onClick={() => { setTried(true); if (ok) send.mutate(undefined); }}>Send request</Button></>}>
      {done ? (
        <Stack>
          <div className="rounded-2xl bg-brand-50 p-6 text-center">
            <CheckCircle2 className="mx-auto mb-2 size-6 text-success" aria-hidden />
            <p className="font-mono text-3xl font-semibold tracking-tight text-ink">{done.id}</p>
            <p className="mt-1.5 text-sm text-ink-2">{done.kind} · status <strong>Sent — awaiting review</strong></p>
          </div>
          <Banner tone="info">
            Your Account Executive and the Sales Director have been notified. A renewal or amendment comes back as a new contract version for signing;
            a termination needs Sales Director and Finance approval{done.feeEstimate ? ` and the pre-termination fee (estimate ${formatPhp(done.feeEstimate)}) is billed on your last invoice` : ""}.
            The request and its outcome are listed on the contract.
          </Banner>
        </Stack>
      ) : (
        <Stack>
          <Segmented value={v.kind} onChange={(kind) => setV({ ...blank, kind })} options={["Renewal", "Amendment", "Termination"].map((k) => ({ value: k as typeof v.kind, label: k }))} />
          {v.kind === "Renewal" && (
            <Input label="New term (months)" required type="number" min={1} max={60} value={v.termMonths} onChange={(e) => setV({ ...v, termMonths: Math.trunc(Number(e.target.value)) })}
              error={(tried && !(v.termMonths >= 1 && v.termMonths <= 60) ? "Whole months, 1 to 60" : undefined) ?? fieldErr("termMonths")}
              hint={c.expiryDate ? `Starts after the current end date ${formatDate(c.expiryDate)}` : undefined} />
          )}
          {v.kind === "Amendment" && (
            <Select label="What to change" required value={v.changeArea} placeholder="Select" onChange={(e) => setV({ ...v, changeArea: e.target.value })}
              options={CHANGE_AREAS.map((a) => ({ value: a, label: a }))} error={(tried && !v.changeArea ? "Required" : undefined) ?? fieldErr("changeArea")} />
          )}
          {v.kind === "Termination" && (
            <>
              <Field label="End the contract on" required error={(tried && !v.effectiveDate ? "Required" : undefined) ?? fieldErr("effectiveDate")} hint="All units must be returned by this date">
                {(id, d) => <DatePicker id={id} aria-describedby={d} value={v.effectiveDate} min={today} onChange={(x) => setV({ ...v, effectiveDate: x })} />}
              </Field>
              {fee && (
                <Banner tone={fee.inLockIn ? "warning" : "info"} title={fee.inLockIn ? `Inside the lock-in — estimated fee ${formatPhp(fee.fee)}` : "After the lock-in — no pre-termination fee"}>
                  {fee.inLockIn
                    ? `Lock-in ends ${formatDate(fee.lockInEnd)}: ${fee.remainingDays} days left, charged up to ${c.preTermination.capDays} days × ${formatPhp(c.preTermination.dailyTotal)}/day for the units on hire (BR-15, proposed formula).`
                    : `Lock-in ${fee.lockInEnd ? `ended ${formatDate(fee.lockInEnd)}` : "does not apply"}. Normal charges up to the end date still apply.`}
                </Banner>
              )}
            </>
          )}
          <Textarea label="Details" required value={v.details} onChange={(e) => setV({ ...v, details: e.target.value })}
            error={(tried && v.details.trim().length < 10 ? "At least 10 characters" : undefined) ?? fieldErr("details")}
            placeholder={v.kind === "Renewal" ? "e.g. Renew for 12 months with the same units" : v.kind === "Amendment" ? "e.g. Add two 40ft flatbeds to our entitlement" : "e.g. Moving operations to Cebu; all units returned by the date"} />
          {send.error && <Banner tone="danger">{errMessage(send.error)}</Banner>}
          <p className="text-sm text-muted">For a general question use <Link to="/client" className="text-brand-600 hover:underline">Send feedback</Link> in your account menu.</p>
        </Stack>
      )}
    </Modal>
  );
}
