// ── SCR-40 E-wallet & cash bond (client view) + top-up request ─────────────
// Portal E-wallet / top-up review (2026-11-11) — the items marked "Not met":
//  • Delbros bank details and the reference to quote on the transfer          • top-up states, pending count, rejection + resubmission
//  • top-up form: transfer date, method and sending bank, suggested amounts, rules, upload limits, remarks, confirmation, duplicate check
//  • every ledger type with its sign (top-up, rescue, repair, debit memo, termination lease, refund, adjustment, reversal)
//  • cash bond history and the refund breakdown (BR-14, BR-15), the withdrawal dialog with its result
//  • date range filter and paging on the ledger · Official vs Provisional receipts · direct Treasury postings · what a low balance affects
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { CheckCircle2, Copy, Landmark, Upload, Wallet, X } from "lucide-react";
import { api } from "../lib/api-client";
import {
  TOPUP_METHODS,
  TOPUP_RULES,
  WALLET_NEAR_FACTOR,
  formatDate,
  formatDateTime,
  formatPhp,
  manilaDay,
  topupReference,
} from "../lib/shared";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardHeader,
  DataTable,
  DatePicker,
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
  Textarea,
  cn,
  useToast,
  type ColumnDef,
} from "../lib/ui";
import { errMessage, useAction, useData } from "../auth";
import { WALLET_STATES, walletRule, walletStateOf, walletTone } from "./portalUi";

type Fund = "E-wallet" | "Cash bond";
interface LedgerRow { id: string; fund: Fund; at: string; type: string; sign: "in" | "out" | "none"; amount: number; balanceAfter: number; reference: ReactNode; search: string }
type Ledger = Awaited<ReturnType<typeof api.ewallet.ledger>>;
type Topup = Ledger["topups"][number];
type Bond = Awaited<ReturnType<typeof api.portal.cashBonds>>[number];

/** Every e-wallet entry type, its sign and when it happens (the header names repair and debit-memo charges, so all are listed). */
const LEDGER_TYPES: { type: string; sign: "+" | "−" | "±"; when: string }[] = [
  { type: "Top-up", sign: "+", when: "Your transfer, after Treasury confirms it (Official Receipt issued)" },
  { type: "Rescue", sign: "−", when: "Rescue charge after completion (BR-11), via a debit memo" },
  { type: "Repair", sign: "−", when: "Chargeable repair from a job order" },
  { type: "Debit memo", sign: "−", when: "Other charges raised as a debit memo (e.g. Park & Fix, damage)" },
  { type: "Contract-termination lease", sign: "−", when: "Lease owed when a contract ends early" },
  { type: "Refund", sign: "−", when: "Balance paid back to you when the account closes" },
  { type: "Adjustment", sign: "±", when: "Correction approved by Finance, with a reason" },
  { type: "Reversal", sign: "±", when: "Undoes an earlier entry; both stay on the ledger" },
];

/** Delbros's receiving account and the reference to quote (from app-config / settings; demo placeholder until approved). */
export function PayeeBox({ clientCode, compact }: { clientCode?: string; compact?: boolean }) {
  // Timeline 2 review: the receiving account of the entity that bills this client (Delbros Leasing, Nakamura for Mindanao, KNEX) — proposed, Treasury to confirm.
  const p = api.auth.payeeFor(clientCode);
  const toast = useToast();
  const ref = clientCode ? topupReference(clientCode) : "";
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Copy is blocked by this browser — select the text and copy it manually");
    }
  };
  return (
    <div className={cn("rounded-lg border border-brand-100 bg-brand-50 text-sm text-ink-2", compact ? "px-3 py-2" : "p-4")}>
      <p className="mb-1 flex items-center gap-1.5 font-medium text-ink"><Landmark className="size-4" aria-hidden /> Pay to</p>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div><dt className="text-xs text-muted">Bank</dt><dd>{p.bank}{p.branch ? ` · ${p.branch}` : ""}</dd></div>
        <div><dt className="text-xs text-muted">Account name</dt><dd>{p.accountName}</dd></div>
        {p.accountNo && (
          <div><dt className="text-xs text-muted">Account no.</dt>
            <dd className="flex items-center gap-1 font-mono">{p.accountNo}
              <button type="button" className="text-brand-600" aria-label="Copy account number" onClick={() => void copy(p.accountNo, "Account number")}><Copy className="size-3.5" /></button></dd></div>
        )}
        {ref && (
          <div><dt className="text-xs text-muted">Reference to quote on the transfer</dt>
            <dd className="flex items-center gap-1 font-mono font-semibold text-ink">{ref}
              <button type="button" className="text-brand-600" aria-label="Copy reference" onClick={() => void copy(ref, "Reference")}><Copy className="size-3.5" /></button></dd></div>
        )}
      </dl>
      <p className="mt-1 text-xs text-muted">Billing entity: {p.entityName} — {p.basis}.</p>
      {p.isDemo && <p className="mt-1 text-xs text-warning">Demo account details — the approved {p.entityName} account replaces these before release.</p>}
    </div>
  );
}

export function ClientEwalletPage() {
  const dash = useData(["portal-dash"], () => api.portal.dashboard());
  const code = dash.data?.client.clientCode;
  const led = useData(["portal-ledger", code], () => api.ewallet.ledger(code!), !!code);
  const bonds = useData(["portal-cashbonds"], () => api.portal.cashBonds());
  const [topup, setTopup] = useState<{ open: boolean; resubmit?: Topup }>({ open: false });
  const [fund, setFund] = useState<"All" | Fund>("E-wallet");
  const [typeF, setTypeF] = useState("");
  const [fromF, setFromF] = useState("");
  const [toF, setToF] = useState("");
  const w = led.data?.wallet;
  const ws = walletStateOf(w);
  const pending = (led.data?.topups ?? []).filter((x) => x.status === "Submitted" || x.status === "Confirmed by Treasury");
  // Ledger rows: e-wallet entries with their category, and the cash bond history (received, withdrawal requested, refunded, applied).
  const postedByRequest = new Set((led.data?.topups ?? []).map((t) => t.txnId).filter(Boolean));
  const walletRows: LedgerRow[] = (led.data?.txns ?? []).map((x) => {
    const cat = x.category ?? x.type;
    const type = x.type === "Replenishment" ? "Top-up" : x.type === "Deduction" ? cat : x.type;
    const direct = x.type === "Replenishment" && !postedByRequest.has(x.id);
    return {
      id: x.id, fund: "E-wallet", at: x.at, type, sign: x.amount > 0 ? "in" : x.amount < 0 ? "out" : "none", amount: x.amount, balanceAfter: x.balanceAfter,
      search: `${type} ${x.referenceType} ${x.referenceId ?? ""} ${x.receiptNo ?? ""} ${x.reason ?? ""}`,
      reference: (
        <span className="block leading-tight">
          {x.referenceType === "Rescue" ? (
            <>Rescue <Link to={`/client/rescue?open=${x.referenceId}`} className="font-mono text-brand-600 hover:underline">{x.referenceId}</Link></>
          ) : x.type === "Reversal" ? (
            <>Reverses <span className="font-mono">{x.reversesId}</span></>
          ) : (
            <>{x.referenceType !== "Top-up" && `${x.referenceType} `}<span className="font-mono">{x.referenceId}</span></>
          )}
          {x.receiptNo && <span className="ml-1"><Badge tone="success" dot={false}>Official receipt</Badge></span>}
          {x.reversedById && <span className="ml-1"><Badge tone="neutral" dot={false}>Reversed by {x.reversedById}</Badge></span>}
          {(x.reason || direct) && (
            <span className="block text-xs text-muted">
              {[x.reason, direct ? "Posted directly by Treasury — no portal request needed (e.g. the opening deposit)" : ""].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
      ),
    };
  });
  const bondRows: LedgerRow[] = (led.data?.bond.entries ?? []).map((e) => ({
    id: e.id, fund: "Cash bond", at: e.at, type: e.entry, sign: e.amount > 0 ? "in" : e.amount < 0 ? "out" : "none", amount: e.amount, balanceAfter: e.balanceAfter,
    search: `${e.entry} ${e.reference} ${e.contractNo ?? ""}`,
    reference: (
      <span className="block leading-tight">
        <span className="font-mono">{e.reference}</span>{e.contractNo ? ` · ${e.contractNo}` : ""}
        <span className="block text-xs text-muted">{"reason" in e && e.reason ? `${e.status} · ${e.reason}` : e.status}</span>
      </span>
    ),
  }));
  const inRange = (r: LedgerRow) => (!fromF || manilaDay(r.at) >= fromF) && (!toF || manilaDay(r.at) <= toF);
  const rows = [...(fund !== "Cash bond" ? walletRows : []), ...(fund !== "E-wallet" ? bondRows : [])]
    .filter((r) => inRange(r) && (!typeF || r.type === typeF))
    .sort((a, b) => a.at.localeCompare(b.at));
  const typeOptions = [...new Set([...(fund !== "Cash bond" ? LEDGER_TYPES.map((t) => t.type) : []), ...(fund !== "E-wallet" ? bondRows.map((r) => r.type) : [])])];
  return (
    <>
      <PageHeader
        title="E-wallet & cash bond"
        description="Your e-wallet is used for rescue, repair and debit-memo charges — keep it above the minimum. Your cash bond is a separate security fund held against your contract. Times are Philippine time (PHT)."
        actions={<Button icon={<Wallet className="size-4" />} onClick={() => setTopup({ open: true })}>Request top-up</Button>}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="E-wallet balance" value={w ? <MoneyText value={w.balance} /> : "—"} tone={walletTone(w)}
          hint={w && ws ? <span title={walletRule(w.minimumBalance)}>{WALLET_STATES[ws].label} — {WALLET_STATES[ws].advice.toLowerCase()}</span> : undefined} />
        <KpiTile label="E-wallet minimum" value={w ? formatPhp(w.minimumBalance) : "—"} hint="Set in your contract (BR-04)" />
        <KpiTile label="Pending top-ups" value={pending.length} tone={pending.length ? "warning" : "default"}
          hint={pending.length ? `${formatPhp(pending.reduce((a, t) => a + t.amount, 0))} awaiting Treasury` : "None awaiting Treasury"} />
        <KpiTile label="Cash bond held" value={formatPhp(led.data?.bond.held ?? 0)} hint="Separate fund — not usable for charges" />
      </div>
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="How to top up" description="Pay by bank transfer or deposit, then send the request with the proof" />
          <PayeeBox clientCode={code} />
          <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-sm text-ink-2">
            <li>Transfer to the account above and quote the reference.</li>
            <li>Click <strong>Request top-up</strong> and attach the bank confirmation.</li>
            <li>Treasury confirms the credit (usually within 1 working day), then it is posted to your e-wallet with an Official Receipt.</li>
          </ol>
        </Card>
        <LowBalanceCard w={w} />
      </div>
      <BondCard bonds={bonds.data} ledger={led.data} />
      <TopupRequestsCard list={led.data?.topups} onResubmit={(t) => setTopup({ open: true, resubmit: t })} />
      <DataTable<LedgerRow>
        data={rows}
        loading={led.isLoading}
        pageSize={10}
        searchPlaceholder="Search type, reference or receipt…"
        initialSort={[{ id: "at", desc: true }]}
        exportName="my-ledger"
        emptyTitle="No entries for the selected fund, type and dates"
        toolbar={
          <>
            <Segmented value={fund} onChange={(f) => { setFund(f); setTypeF(""); }}
              options={[{ value: "E-wallet", label: "E-wallet" }, { value: "Cash bond", label: "Cash bond" }, { value: "All", label: "All funds" }]} />
            <Select aria-label="Entry type" value={typeF} onChange={(e) => setTypeF(e.target.value)}
              options={[{ value: "", label: "All types" }, ...typeOptions.map((t) => ({ value: t, label: t }))]} />
            <span className="flex items-center gap-1.5 text-sm text-muted">
              <DatePicker aria-label="From" value={fromF} max={toF || undefined} onChange={setFromF} placeholder="From" className="w-36" />–
              <DatePicker aria-label="To" value={toF} min={fromF || undefined} onChange={setToF} placeholder="To" className="w-36" />
              {(fromF || toF) && <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => { setFromF(""); setToF(""); }}>Clear</button>}
            </span>
          </>
        }
        columns={[
          { accessorKey: "at", header: "Date (PHT)", cell: (c) => formatDateTime(c.getValue<string>()) },
          ...(fund === "All" ? [{ accessorKey: "fund", header: "Fund" } as ColumnDef<LedgerRow>] : []),
          {
            accessorKey: "type", header: "Type",
            cell: (c) => <Badge tone={c.row.original.sign === "in" ? "success" : c.row.original.sign === "out" ? "warning" : "neutral"} dot={false}>{c.getValue<string>()}</Badge>,
          },
          { accessorKey: "amount", header: "Amount", meta: { align: "right" }, cell: (c) => (c.getValue<number>() ? <MoneyText value={c.getValue<number>()} /> : <span className="text-muted">—</span>) },
          ...(fund === "All" ? [] : [{ accessorKey: "balanceAfter", header: "Running balance", meta: { align: "right" }, cell: (c) => <MoneyText value={c.getValue<number>()} /> } as ColumnDef<LedgerRow>]),
          { id: "ref", accessorFn: (r) => r.search, header: "Reference", meta: { wrap: true }, cell: (c) => c.row.original.reference },
        ]}
      />
      {fund !== "Cash bond" && (
        <details className="mt-3 rounded-lg border border-line bg-surface p-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink">E-wallet entry types</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {LEDGER_TYPES.map((t) => (
              <li key={t.type}><span className="inline-block w-5 font-mono font-semibold">{t.sign}</span><span className="text-ink">{t.type}</span> <span className="text-muted">— {t.when}</span></li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Receipts: a <strong>Provisional Receipt (PR-)</strong> is issued when a payment is received but not yet cleared; it becomes an
            <strong> Official Receipt (OR-)</strong> once Treasury clears the funds. Top-ups are posted only after clearance, so they always carry an
            Official Receipt. Only cleared money changes your balances.
          </p>
        </details>
      )}
      <TopupDialog
        open={topup.open}
        resubmit={topup.resubmit}
        ledger={led.data}
        clientCode={code}
        onClose={() => setTopup({ open: false })}
      />
    </>
  );
}

/** BR-04: what each balance state means for EWAs and rescues (proposed — Finance to confirm; warnings only, nothing is blocked). */
function LowBalanceCard({ w }: { w?: { balance: number; minimumBalance: number } | null }) {
  const ws = walletStateOf(w);
  return (
    <Card>
      <CardHeader title="E-wallet states and what a low balance affects" description="Proposed rule — Finance to confirm (BR-04)" />
      <ul className="space-y-2 text-sm">
        {/* Timeline 2 review: Healthy is listed with the three low-balance states, so all four bands are explained. */}
        {(["healthy", "near", "below", "negative"] as const).map((k) => (
          <li key={k} className={cn("rounded-md border px-3 py-2", k === ws ? "border-current font-medium" : "border-line", k === ws && (k === "healthy" ? "bg-success-bg text-success" : k === "near" ? "bg-warning-bg text-warning" : "bg-danger-bg text-danger"))}>
            <span className="block">{WALLET_STATES[k].label} <span className="font-normal text-muted">({w ? WALLET_STATES[k].range(w.minimumBalance) : ""})</span></span>
            <span className="block text-xs font-normal text-ink-2">
              {k === "healthy" && "Comfortably above the minimum. Nothing to do; charges are deducted as they arise."}
              {k === "near" && "Reminder to top up. EWAs and rescues work as normal."}
              {k === "below" && "Delbros asks for a top-up to the contract minimum. EWAs and rescues are not blocked; rescue charges are still deducted after the rescue."}
              {k === "negative" && "Charges exceeded the balance. Not blocked, but the shortfall is owed: it is collected by top-up and, if still owed when the contract ends, deducted from your cash bond (BR-14)."}
            </span>
          </li>
        ))}
      </ul>
      {w && ws && ws !== "healthy" && (
        <p className="mt-2 text-xs text-muted">Top up {formatPhp(Math.max(0, w.minimumBalance * WALLET_NEAR_FACTOR - w.balance))} to be back to Healthy.</p>
      )}
    </Card>
  );
}

/** Cash bond: the refund breakdown (BR-14, BR-15) and the withdrawal request with its result. */
function BondCard({ bonds, ledger }: { bonds?: Bond[]; ledger?: Ledger }) {
  const [wd, setWd] = useState<{ bondId: string; amount: number; reason: string } | null>(null);
  const [sent, setSent] = useState<{ amount: number; workflow?: string; early: boolean } | null>(null);
  const wdBond = (bonds ?? []).find((b) => b.id === wd?.bondId);
  const wdReq = useAction(
    () => api.contracts.requestWithdrawal(wd!.bondId, wd!.amount, wd!.reason, { earlyException: !wdBond?.preview.contractEnded }),
    { success: "Withdrawal request sent for approval", onSuccess: (b) => { setSent({ amount: wd!.amount, workflow: b.withdrawals[0]?.workflowId, early: !wdBond?.preview.contractEnded }); } },
  );
  if (!bonds?.length) return null;
  return (
    <Card className="mb-5">
      <CardHeader title="Cash bond" description="Refundable at contract end, less what you owe. Withdrawal requests are reviewed by Delbros (Credit & Collection → Finance → Accounting → Admin)." />
      <ul className="divide-y divide-line">
        {bonds.map((b) => {
          const p = b.preview;
          const pendingWd = b.withdrawals.find((x) => x.status === "Pending" || x.status.startsWith("Approved"));
          // Timeline 2 review: a bond on an ended contract shows how it was closed instead of a refund preview.
          if (b.outcome) {
            return (
              <li key={b.id} className="grid gap-2 py-3 text-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto]">
                <span>
                  <span className="font-semibold">{formatPhp(b.amount)}</span> · <span className="font-mono">{b.contractNo}</span>
                  <span className="block text-xs text-muted">Received {formatDate(b.dateReceived)} · {b.receiptRef} · contract {p.contractStatus?.toLowerCase()}</span>
                </span>
                <span className="text-xs text-ink-2"><strong>{b.outcome.kind} {formatDate(b.outcome.at)}</strong> · {formatPhp(b.outcome.amount)} · ref <span className="font-mono">{b.outcome.reference}</span><span className="block text-muted">{b.outcome.note}</span></span>
                <span className="flex justify-end"><Badge tone="neutral">{b.status}</Badge></span>
              </li>
            );
          }
          const wf = pendingWd ? b.workflows.find((x) => x?.id === pendingWd.workflowId) : undefined;
          return (
            <li key={b.id} className="grid gap-3 py-3 text-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto]">
              <span>
                <span className="font-semibold">{formatPhp(b.amount)}</span> · <span className="font-mono">{b.contractNo ?? "No contract"}</span>
                <span className="block text-xs text-muted">
                  Received {formatDate(b.dateReceived)} · {b.receiptRef}
                  {p.contractStatus ? ` · contract ${p.contractStatus.toLowerCase()}${p.contractExpiry ? ` (${p.contractEnded ? "ended" : "to"} ${formatDate(p.contractExpiry)})` : ""}` : ""}
                </span>
              </span>
              {/* BR-14 refund breakdown, with every deduction named even when it is ₱0. */}
              <table className="w-full text-xs tabular">
                <tbody>
                  {([
                    ["Cash bond", p.bond, ""],
                    ["Unpaid invoices (all unpaid, not only overdue)", -p.unpaid, ""],
                    ["Negative e-wallet balance", -p.negativeWallet, ""],
                    ["Debit memos awaiting approval", -p.pendingDm, ""],
                    // Timeline 2 review: a debit memo posted but not yet settled (DM-000039) is also owed.
                    ["Debit memos posted, not yet settled", -p.postedUnsettledDm, p.unsettledMemos.length ? p.unsettledMemos.join(", ") : ""],
                    ["Pre-termination fee (BR-15)", 0, "only if the contract is ended inside its lock-in"],
                  ] as [string, number, string][]).map(([l, v, note]) => (
                    <tr key={l}>
                      <td className="py-0.5 text-muted">{l}{note && <span className="block text-[11px]">{note}</span>}</td>
                      <td className="text-right">{v < 0 ? `− ${formatPhp(-v)}` : formatPhp(Math.abs(v))}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-line font-semibold text-ink">
                    <td className="pt-1">Refundable now (never below ₱0)</td>
                    <td className="pt-1 text-right">{formatPhp(p.refundable)}</td>
                  </tr>
                </tbody>
              </table>
              <span className="flex flex-col items-end gap-1">
                <Badge tone={b.status === "Held" ? "success" : "warning"}>{b.status === "Withdrawal Pending" ? "Withdrawal pending" : b.status}</Badge>
                {b.status === "Held" ? (
                  <>
                    <Button size="sm" variant="secondary" disabled={p.refundable <= 0} onClick={() => { setSent(null); setWd({ bondId: b.id, amount: p.refundable, reason: "" }); }}>
                      Request withdrawal
                    </Button>
                    {p.refundable <= 0 && <span className="max-w-48 text-right text-xs text-muted">Not available — what you owe is deducted from the bond first</span>}
                  </>
                ) : pendingWd ? (
                  <span className="max-w-56 text-right text-xs text-muted">{formatPhp(pendingWd.amount)} requested {formatDate(pendingWd.requestedAt)} · {pendingWd.status}</span>
                ) : null}
              </span>
              {/* Timeline 2 review: where the withdrawal is — the four approvals, then the refund recorded by Accounting. */}
              {pendingWd && wf && (
                <ol className="flex flex-wrap gap-1 text-[11px] lg:col-span-3" aria-label="Withdrawal approval steps">
                  {wf.steps.map((s, i) => (
                    <li key={s.label} className={cn("rounded-full border px-2 py-0.5", s.decision === "Approved" ? "border-success-line bg-success-bg text-success" : s.decision === "Rejected" ? "border-danger-line bg-danger-bg text-danger" : i === wf.currentStep && wf.status === "Pending" ? "border-warning-line bg-warning-bg text-warning" : "border-line text-muted")}>
                      {i + 1}. {s.label}{s.decision === "Approved" ? ` ✓ ${formatDate(s.decidedAt)}` : s.decision === "Rejected" ? " — rejected" : i === wf.currentStep && wf.status === "Pending" ? " — reviewing" : ""}
                    </li>
                  ))}
                  <li className={cn("rounded-full border px-2 py-0.5", pendingWd.status === "Refunded" ? "border-success-line bg-success-bg text-success" : "border-line text-muted")}>
                    Refund {pendingWd.refund ? `paid ${formatDate(pendingWd.refund.date)} · ${pendingWd.refund.method} · ${pendingWd.refund.reference}` : pendingWd.status.startsWith("Approved") ? "— Accounting to pay" : "after the approvals"}
                  </li>
                </ol>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Refund rule (proposed — Finance to confirm, BR-14): everything you owe when the bond is released is deducted — all unpaid invoices
        (not only overdue ones, since all fall due by contract end), a negative e-wallet balance, debit memos awaiting approval and debit memos
        posted but not yet settled. The BR-15
        pre-termination fee is deducted only when a contract is ended inside its lock-in. Bond history is in the ledger below (Cash bond tab).
        {ledger && ledger.bond.entries.length === 0 ? " No bond entries yet." : ""}
      </p>
      <Modal
        open={!!wd}
        onClose={() => setWd(null)}
        title={sent ? "Withdrawal request sent" : "Request cash bond withdrawal"}
        description={sent ? undefined : "Your request is reviewed by Delbros before any refund."}
        footer={sent ? <Button onClick={() => setWd(null)}>Done</Button> : (
          <>
            <Button variant="secondary" onClick={() => setWd(null)}>Cancel</Button>
            <Button loading={wdReq.isPending} disabled={!wd || wd.amount <= 0 || wd.amount > (wdBond?.preview.refundable ?? 0) || !wd.reason.trim()} onClick={() => wdReq.mutate(undefined)}>Submit request</Button>
          </>
        )}
      >
        {sent ? (
          <Stack>
            <Banner tone="success" title={`${formatPhp(sent.amount)} requested${sent.workflow ? ` · ${sent.workflow}` : ""}`}>
              The bond now shows “Withdrawal pending”. Credit & Collection, Finance, Accounting and Admin approve it in turn; Accounting then records the
              refund (method, date and reference) and the bond moves to Refunded.{sent.early ? " Because the contract has not ended, it is reviewed as an early-withdrawal exception." : ""}
            </Banner>
          </Stack>
        ) : wd && wdBond && (
          <Stack>
            {!wdBond.preview.contractEnded ? (
              <Banner tone="warning" title="Contract still active">
                Contract {wdBond.preview.contractNo} is {wdBond.preview.contractStatus}. The bond is normally refundable at contract end, so this is sent as an early-withdrawal exception.
              </Banner>
            ) : (
              <Banner tone="info" title="Contract ended">Contract {wdBond.preview.contractNo} ended {formatDate(wdBond.preview.contractExpiry)} — the bond is due for refund (BR-14).</Banner>
            )}
            <p className="rounded-lg border border-line p-3 text-sm">
              Cash bond {formatPhp(wdBond.preview.bond)} − what you owe {formatPhp(wdBond.preview.deductions)} = <strong>refundable {formatPhp(wdBond.preview.refundable)}</strong>
            </p>
            <MoneyInput label="Withdrawal amount" required value={wd.amount || ""} onChange={(e) => setWd({ ...wd, amount: Number(e.target.value) })}
              error={wd.amount > wdBond.preview.refundable ? "Cannot exceed the refundable amount" : undefined} hint={`Up to ${formatPhp(wdBond.preview.refundable)}`} />
            <Textarea label="Reason" required value={wd.reason} onChange={(e) => setWd({ ...wd, reason: e.target.value })} placeholder="e.g. Contract ended and all units returned" />
            {wdReq.error && <Banner tone="danger">{errMessage(wdReq.error)}</Banner>}
          </Stack>
        )}
      </Modal>
    </Card>
  );
}

const TOPUP_STEPS = ["Submitted", "Confirmed by Treasury", "Posted"] as const;
/** Top-up requests with their state (Submitted → Confirmed by Treasury → Posted, or Rejected with the reason and Resubmit). */
function TopupRequestsCard({ list, onResubmit }: { list?: Topup[]; onResubmit: (t: Topup) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!list) return null;
  return (
    <Card className="mb-5">
      <CardHeader title="Top-up requests" description="Submitted → Confirmed by Treasury → Posted to your e-wallet (Official Receipt issued), or Rejected with the reason" />
      {list.length ? (
        <ul className="divide-y divide-line">
          {list.map((x) => {
            const step = x.status === "Rejected" ? -1 : TOPUP_STEPS.indexOf(x.status as (typeof TOPUP_STEPS)[number]);
            const resubmitted = list.some((y) => y.resubmitOf === x.id);
            return (
              <li key={x.id} className="py-2.5 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-mono font-medium">{x.id}</span> · {formatPhp(x.amount)}
                    <span className="block text-xs text-muted">
                      Sent {formatDateTime(x.submittedAt)}{x.transferDate ? ` · transferred ${formatDate(x.transferDate)}` : ""}{x.method ? ` · ${x.method}` : ""}
                      {x.paymentRef ? <> · ref <span className="font-mono">{x.paymentRef}</span></> : null}
                      {x.resubmitOf ? ` · resubmission of ${x.resubmitOf}` : ""}
                      {x.checkNo ? ` · check ${x.checkNo} (${x.checkBank}, dated ${formatDate(x.checkDate)})` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge domain="topup" value={x.status} />
                    {x.status === "Rejected" && !resubmitted && <Button size="sm" variant="secondary" onClick={() => onResubmit(x)}>Resubmit</Button>}
                    {x.notified?.length ? <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => setOpenId(openId === x.id ? null : x.id)}>{openId === x.id ? "Hide" : "Who was told"}</button> : null}
                  </span>
                </div>
                {step >= 0 ? (
                  <ol className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
                    {TOPUP_STEPS.map((s, i) => (
                      <li key={s} className={cn("rounded-full border px-2 py-0.5", i <= step ? "border-brand-300 bg-brand-50 text-brand-800" : "border-line text-muted")}>
                        {s}{i === 0 && step === 0 ? " — pending Treasury confirmation" : ""}{i === 1 && x.confirmedAt ? ` · ${formatDate(x.confirmedAt)}` : ""}{i === 2 && x.postedAt ? ` · ${formatDate(x.postedAt)}${x.receiptNo ? ` · ${x.receiptNo}` : ""}` : ""}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-1 text-xs text-danger">
                    Rejected {formatDate(x.rejectedAt)}: {x.rejectReason ?? "No reason given."}
                    {resubmitted ? <span className="text-muted"> · resubmitted</span> : " You can resubmit it with the corrected details."}
                  </p>
                )}
                {openId === x.id && x.notified && (
                  <ul className="mt-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-muted">
                    {x.notified.map((d, i) => <li key={i}>{d.recipient} · {d.to} · <span className="text-success">{d.status}</span></li>)}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">No top-up requests yet. Use <strong>Request top-up</strong> after paying.</p>
      )}
      <p className="mt-2 text-xs text-muted">Treasury can also post a deposit directly (for example the opening deposit at accreditation); those appear only in the ledger, marked “Posted directly by Treasury”.</p>
    </Card>
  );
}

/** Request e-wallet top-up: what Treasury needs to match the transfer, rules, suggested amounts, and the confirmation. */
function TopupDialog({ open, resubmit, ledger, clientCode, onClose }: { open: boolean; resubmit?: Topup; ledger?: Ledger; clientCode?: string; onClose: () => void }) {
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const blank = { amount: 0, transferDate: today, method: "", sendingBank: "", reference: "", file: "", sizeMb: 0, remarks: "", checkNo: "", checkDate: "", checkBank: "" };
  const [v, setV] = useState(blank);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<Awaited<ReturnType<typeof api.ewallet.requestTopup>> | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const k = open ? `${resubmit?.id ?? "new"}` : null;
  if (k !== key) {
    setKey(k);
    setTried(false);
    setDone(null);
    setV(resubmit ? { ...blank, amount: resubmit.amount, method: resubmit.method ?? "", sendingBank: resubmit.sendingBank ?? "", transferDate: resubmit.transferDate ?? today, remarks: `Resubmission of ${resubmit.id}` } : blank);
  }
  const req = useAction(
    () => api.ewallet.requestTopup({ amount: v.amount, transferDate: v.transferDate, method: v.method, sendingBank: v.sendingBank, reference: v.reference, proofFileName: v.file, proofSizeMb: v.sizeMb, remarks: v.remarks, resubmitOf: resubmit?.id,
      ...(byCheck ? { checkNo: v.checkNo, checkDate: v.checkDate, checkBank: v.checkBank } : {}) }),
    { onSuccess: (t) => setDone(t) },
  );
  const w = ledger?.wallet;
  // Timeline 2 review (Screen Inventory, PR entry): a check payment needs the check number, date and drawee bank.
  const byCheck = /\bcheck\b/i.test(v.method);
  const fieldErr = (f: string) => (req.error as { fields?: Record<string, string> } | null)?.fields?.[f];
  const minDate = new Date(Date.now() + 8 * 3_600_000 - TOPUP_RULES.maxAgeDays * 86_400_000).toISOString().slice(0, 10);
  const amountErr = !(v.amount > 0) ? "Enter the amount you paid" : v.amount < TOPUP_RULES.min ? `At least ${formatPhp(TOPUP_RULES.min)}` : v.amount > TOPUP_RULES.max ? `At most ${formatPhp(TOPUP_RULES.max)} per request` : undefined;
  const fileErr = !v.file ? "Upload the bank slip or transfer confirmation" : !/\.(pdf|jpe?g|png)$/i.test(v.file) ? "PDF, JPG or PNG only" : v.sizeMb > TOPUP_RULES.maxFileMb ? `Max ${TOPUP_RULES.maxFileMb} MB — this file is ${v.sizeMb.toFixed(1)} MB` : undefined;
  // Suggested amounts from the current balance (review example: ₱548.80 leaves amber at ₱11,951.20).
  const suggestions = w ? ([
    ["To leave amber (healthy)", Math.max(0, w.minimumBalance * WALLET_NEAR_FACTOR - w.balance)],
    ["To reach the minimum", Math.max(0, w.minimumBalance - w.balance)],
  ] as [string, number][]).filter(([, a], i, all) => a > 0 && all.findIndex(([, b]) => b === a) === i) : [];
  const checkOk = !byCheck || (v.checkNo.trim() && v.checkDate && v.checkBank.trim());
  const submit = () => {
    setTried(true);
    if (!amountErr && !fileErr && v.method && v.reference.trim() && v.transferDate && v.remarks.length <= 200 && checkOk) req.mutate(undefined);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={done ? "Top-up request sent" : resubmit ? `Resubmit top-up — ${resubmit.id}` : "Request e-wallet top-up"}
      description={done ? undefined : "Pay first, then send the details and proof. Treasury confirms the credit and posts it to your e-wallet."}
      size="lg"
      footer={done ? <Button onClick={onClose}>Done</Button> : (<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={req.isPending} onClick={submit}>Submit</Button></>)}
    >
      {done ? (
        <Stack>
          <div className="rounded-lg border border-brand-100 bg-brand-50 p-4 text-center">
            <CheckCircle2 className="mx-auto mb-1 size-6 text-success" aria-hidden />
            <p className="font-mono text-2xl font-bold text-brand-800">{done.id}</p>
            <p className="text-sm text-ink-2">{formatPhp(done.amount)} to your <strong>e-wallet</strong> · status <strong>Pending Treasury confirmation</strong></p>
            {done.checkNo && <p className="text-xs text-muted">Check {done.checkNo} · {done.checkBank} · dated {formatDate(done.checkDate)}</p>}
          </div>
          <Banner tone="info">Treasury will confirm the credit in the Delbros account (usually within 1 working day{done.checkNo ? "; a check counts once it clears" : ""}) and post it to your e-wallet with an Official Receipt. You will be notified; the request is listed under Top-up requests.</Banner>
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Notified</p>
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {done.notified?.map((d, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <span>{d.recipient}<span className="block text-xs text-muted">{d.channel} · {d.to}</span></span>
                  <Badge tone={d.status === "Sent" ? "success" : d.status === "Queued" ? "warning" : "danger"}>{d.status === "Queued" ? "Queued for sending" : d.status}</Badge>
                </li>
              ))}
            </ul>
          </div>
        </Stack>
      ) : (
        <Stack>
          {resubmit && <Banner tone="warning" title={`${resubmit.id} was rejected`}>{resubmit.rejectReason} Correct the details below — use the reference shown on your bank confirmation.</Banner>}
          {/* Timeline 2 review: the fund is named — this request tops up the e-wallet only; the cash bond has its own route (proposed). */}
          <p className="rounded-lg border border-line px-3 py-2 text-sm">
            <span className="text-xs text-muted">Fund</span> <strong>E-wallet</strong> — for rescue, repair and debit-memo charges.
            <span className="block text-xs text-muted">This form does not add to your cash bond. The bond amount is set in your contract; to add to it, ask your Account Executive — Treasury issues an Official Receipt to the bond (proposed route, Delbros to confirm).</span>
          </p>
          <PayeeBox clientCode={clientCode} compact />
          {w && (
            <div className="rounded-lg border border-line bg-surface-alt px-3 py-2 text-sm text-ink-2">
              Current balance <MoneyText value={w.balance} /> · minimum {formatPhp(w.minimumBalance)}
              {/* Timeline 2 review: say so when no top-up is needed (the chip fills the Amount when clicked). */}
              {!suggestions.length && <span className="mt-1 block text-xs text-success">Your balance is Healthy — no top-up is needed. You can still top up any amount from {formatPhp(TOPUP_RULES.min)}.</span>}
              {!!suggestions.length && (
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted">Suggested:</span>
                  {suggestions.map(([l, a]) => (
                    <button key={l} type="button" title="Fills the Amount field" aria-pressed={v.amount === Math.round(a * 100) / 100} className={cn("rounded-full border border-brand-300 px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50", v.amount === Math.round(a * 100) / 100 ? "bg-brand-50" : "bg-surface")} onClick={() => setV({ ...v, amount: Math.round(a * 100) / 100 })}>
                      {formatPhp(a)} — {l.toLowerCase()}
                    </button>
                  ))}
                </span>
              )}
            </div>
          )}
          <FormGrid>
            <MoneyInput label="Amount" required value={v.amount || ""} onChange={(e) => setV({ ...v, amount: Number(e.target.value) })}
              error={(tried ? amountErr : undefined) ?? fieldErr("amount")} hint={`${formatPhp(TOPUP_RULES.min)} to ${formatPhp(TOPUP_RULES.max)}; centavos allowed`} />
            <Field label="Transfer date" required error={(tried && !v.transferDate ? "Required" : undefined) ?? fieldErr("transferDate")} hint={`Today or up to ${TOPUP_RULES.maxAgeDays} days ago`}>
              {(id, d) => <DatePicker id={id} aria-describedby={d} value={v.transferDate} min={minDate} max={today} onChange={(x) => setV({ ...v, transferDate: x })} />}
            </Field>
            <Select label="Payment method" required value={v.method} placeholder="Select" onChange={(e) => setV({ ...v, method: e.target.value })}
              error={(tried && !v.method ? "Required" : undefined) ?? fieldErr("method")} options={TOPUP_METHODS.map((m) => ({ value: m, label: m }))} />
            <Input label="Sending bank (optional)" value={v.sendingBank} onChange={(e) => setV({ ...v, sendingBank: e.target.value })} placeholder="The bank you paid from" />
            <Input label="Bank / payment reference no." required value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })}
              error={(tried && !v.reference.trim() ? "Required" : undefined) ?? fieldErr("reference")} placeholder="e.g. TRX-20261110-0001" hint="As shown on your bank confirmation" />
            {byCheck && (
              <>
                <Input label="Check number" required value={v.checkNo} onChange={(e) => setV({ ...v, checkNo: e.target.value })}
                  error={(tried && !v.checkNo.trim() ? "Check number is required" : undefined) ?? fieldErr("checkNo")} placeholder="e.g. 0081234" />
                <Field label="Check date" required error={(tried && !v.checkDate ? "Check date is required" : undefined) ?? fieldErr("checkDate")} hint="A post-dated check counts once it clears">
                  {(id, d) => <DatePicker id={id} aria-describedby={d} value={v.checkDate} onChange={(x) => setV({ ...v, checkDate: x })} />}
                </Field>
                <Input label="Drawee bank" required value={v.checkBank} onChange={(e) => setV({ ...v, checkBank: e.target.value })}
                  error={(tried && !v.checkBank.trim() ? "Drawee bank is required" : undefined) ?? fieldErr("checkBank")} placeholder="The bank the check is drawn on" />
              </>
            )}
          </FormGrid>
          <Field label="Proof of payment" required error={(tried ? fileErr : undefined) ?? fieldErr("proofFileName")} hint={`One file — PDF, JPG or PNG, max ${TOPUP_RULES.maxFileMb} MB`}>
            {(id, d) => (
              <label htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-line-strong p-4 text-sm text-muted hover:border-brand-300">
                <Upload className="size-5" />
                <span className={cn("min-w-0 flex-1 truncate", v.file && "text-ink")}>{v.file ? `${v.file} · ${v.sizeMb.toFixed(1)} MB` : "Upload the bank slip or transfer confirmation"}</span>
                {v.file && <button type="button" aria-label="Remove file" onClick={(e) => { e.preventDefault(); setV({ ...v, file: "", sizeMb: 0 }); }}><X className="size-4" /></button>}
                <input id={id} aria-describedby={d} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; setV({ ...v, file: f?.name ?? "", sizeMb: f ? f.size / 1048576 : 0 }); e.target.value = ""; }} />
              </label>
            )}
          </Field>
          <Textarea label="Remarks (optional)" value={v.remarks} maxLength={200} hint={`${v.remarks.length}/200`} onChange={(e) => setV({ ...v, remarks: e.target.value })} placeholder="e.g. Paid by our Cebu office" />
          {req.error && <Banner tone="danger">{errMessage(req.error)}</Banner>}
        </Stack>
      )}
    </Modal>
  );
}
