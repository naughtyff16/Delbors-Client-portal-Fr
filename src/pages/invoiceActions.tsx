// ── SUP-07 Invoices & SOA — pieces for the portal invoice review (2026-11-11) ──
//  • net, VAT and total; billing basis (lease = units × days × contract rate; one-off charges are not lease periods)
//  • billing coverage: lease periods run without gaps; the current week is invoiced on the next weekly run
//  • proof of payment and invoice disputes (proposed scope — Delbros to confirm), SOA period with an opening balance
import { useState } from "react";
import { Upload, X } from "lucide-react";
import { api } from "../lib/api-client";
import { addDays, formatDate, formatPhp, manilaDay } from "../lib/shared";
import { Banner, Button, DatePicker, Field, FormGrid, Input, Modal, MoneyInput, Select, Stack, Textarea, cn } from "../lib/ui";
import { errMessage, useAction } from "../auth";

export type InvRow = Awaited<ReturnType<typeof api.billing.invoices>>[number];
export type SoaLine = Awaited<ReturnType<typeof api.credit.soa>>["lines"][number];

/** How the amount is made up, in one sentence (review: INV-MNL-00001118 ₱5,040 = ₱4,500 damage + ₱540 VAT). */
export function billingBasis(i: InvRow) {
  if (i.isLease) {
    const units = i.lines.filter((l) => l.lineType === "Lease" && !l.held);
    const days = units.reduce((a, l) => a + (l.days ?? 0), 0);
    return `Lease: ${units.length} unit${units.length === 1 ? "" : "s"}, ${days} unit-days at the contract daily rates (net ${formatPhp(i.subtotal)}) + 12% VAT ${formatPhp(i.vat)} = ${formatPhp(i.total)}.`;
  }
  const l = i.lines[0];
  return `${i.billType} charge, not a lease bill: ${l?.description ?? i.billType} ${formatPhp(i.subtotal)} + 12% VAT ${formatPhp(i.vat)} = ${formatPhp(i.total)}. Daily rates do not apply.`;
}
/** The "Period" cell: lease periods as a range; one-off charges say what they are and when they arose. */
export function periodLabel(i: InvRow) {
  if (!i.isLease) return `${i.billType} · ${formatDate(i.periodStart)}`;
  return i.periodStart === i.periodEnd ? formatDate(i.periodStart) : `${formatDate(i.periodStart)} – ${formatDate(i.periodEnd)}`;
}

/** Lease billing coverage: the periods invoiced, any gap, and what is not yet invoiced (review: 28–31 Oct gap). */
export function BillingCoverage({ invs, cycle }: { invs: InvRow[]; cycle?: string }) {
  const lease = invs.filter((i) => i.isLease && i.status !== "Cancelled").sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  if (!lease.length) return null;
  const gaps: string[] = [];
  for (let k = 1; k < lease.length; k++) {
    const expected = manilaDay(addDays(`${lease[k - 1].periodEnd}T12:00:00+08:00`, 1));
    if (lease[k].periodStart > expected) gaps.push(`${formatDate(expected)} – ${formatDate(manilaDay(addDays(`${lease[k].periodStart}T12:00:00+08:00`, -1)))}`);
  }
  const last = lease[lease.length - 1];
  const nextStart = manilaDay(addDays(`${last.periodEnd}T12:00:00+08:00`, 1));
  const len = cycle === "Monthly" ? 30 : 7;
  const nextEnd = manilaDay(addDays(`${nextStart}T12:00:00+08:00`, len - 1));
  const nextInvoice = manilaDay(addDays(`${nextEnd}T12:00:00+08:00`, 1));
  return (
    <p className={cn("mb-3 rounded-lg border px-3 py-2 text-sm", gaps.length ? "border-warning-line bg-warning-bg" : "border-line bg-surface")}>
      <span className="font-medium text-ink">Lease billing ({(cycle ?? "weekly").toLowerCase()}):</span>{" "}
      invoiced from {formatDate(lease[0].periodStart)} to {formatDate(last.periodEnd)}{gaps.length ? <span className="text-warning"> — not yet billed: {gaps.join(", ")}</span> : " with no gaps"}.
      {" "}The current period {formatDate(nextStart)} – {formatDate(nextEnd)} accrues daily and is invoiced on {formatDate(nextInvoice)}.
      {" "}<span className="text-muted">Repair, damage and other one-off charges are billed separately and are not lease periods.</span>
    </p>
  );
}

/** SOA for a chosen period: a "Balance brought forward" row, the movements in the period, and the closing balance. */
export function soaForPeriod(lines: SoaLine[], from: string, to: string) {
  const day = (iso: string) => manilaDay(iso);
  const before = from ? lines.filter((l) => day(l.date) < from) : [];
  const opening = before.length ? before[before.length - 1].balance : 0;
  const inPeriod = lines.filter((l) => (!from || day(l.date) >= from) && (!to || day(l.date) <= to));
  const rows = from ? [{ date: `${from}T00:00:00+08:00`, docType: "Balance brought forward", docNo: "", debit: 0, credit: 0, balance: opening } as SoaLine, ...inPeriod] : inPeriod;
  const closing = inPeriod.length ? inPeriod[inPeriod.length - 1].balance : opening;
  return { rows, opening, closing, debits: inPeriod.reduce((a, l) => a + l.debit, 0), credits: inPeriod.reduce((a, l) => a + l.credit, 0) };
}

const METHODS = ["Bank transfer (InstaPay)", "Bank transfer (PESONet)", "Online banking — same bank", "Over-the-counter deposit", "Check deposit"];
/** Proof of payment for an invoice (proposed scope). Does not change the balance — Accounting verifies, Treasury clears. */
export function PaymentAdviceDialog({ inv, onClose }: { inv: InvRow | null; onClose: () => void }) {
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const blank = { amount: 0, paidOn: today, method: "", bank: "", reference: "", file: "", sizeMb: 0, remarks: "" };
  const [v, setV] = useState(blank);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [last, setLast] = useState<InvRow | null>(null);
  if (inv !== last) { setLast(inv); setV({ ...blank, amount: inv?.balance ?? 0 }); setTried(false); setDone(null); }
  const send = useAction(
    () => api.portal.submitPaymentAdvice({ invoiceNo: inv!.invoiceNo, amount: v.amount, paidOn: v.paidOn, method: v.method, bank: v.bank, reference: v.reference, proofFileName: v.file, proofSizeMb: v.sizeMb, remarks: v.remarks }),
    { onSuccess: (a) => setDone(a.id) },
  );
  if (!inv) return null;
  const fieldErr = (f: string) => (send.error as { fields?: Record<string, string> } | null)?.fields?.[f];
  const fileErr = !v.file ? "Attach the proof" : !/\.(pdf|jpe?g|png)$/i.test(v.file) ? "PDF, JPG or PNG only" : v.sizeMb > 5 ? "Max 5 MB" : undefined;
  return (
    <Modal open onClose={onClose} size="lg" title={done ? "Proof of payment sent" : `Send proof of payment — ${inv.invoiceNo}`}
      description={done ? undefined : `Balance ${formatPhp(inv.balance)}. Accounting checks your payment; your balance changes once Treasury clears it (Provisional, then Official Receipt).`}
      footer={done ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={send.isPending} onClick={() => { setTried(true); if (v.amount > 0 && v.method && v.reference.trim() && !fileErr) send.mutate(undefined); }}>Send</Button></>}>
      {done ? (
        <Banner tone="success" title={`${done} received`}>Accounting and Treasury have been notified. The invoice shows “Proof sent” until the payment is verified; you will be notified when the receipt is issued.</Banner>
      ) : (
        <Stack>
          <FormGrid>
            <MoneyInput label="Amount paid" required value={v.amount || ""} onChange={(e) => setV({ ...v, amount: Number(e.target.value) })} error={(tried && !(v.amount > 0) ? "Required" : undefined) ?? fieldErr("amount")} hint={`Up to the balance ${formatPhp(inv.balance)}`} />
            <Field label="Date paid" required error={fieldErr("paidOn")}>{(id, d) => <DatePicker id={id} aria-describedby={d} value={v.paidOn} max={today} onChange={(x) => setV({ ...v, paidOn: x })} />}</Field>
            <Select label="Payment method" required value={v.method} placeholder="Select" onChange={(e) => setV({ ...v, method: e.target.value })} options={METHODS.map((m) => ({ value: m, label: m }))} error={(tried && !v.method ? "Required" : undefined) ?? fieldErr("method")} />
            <Input label="Bank (optional)" value={v.bank} onChange={(e) => setV({ ...v, bank: e.target.value })} placeholder="The bank you paid from" />
            <Input label="Reference / check no." required value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} error={(tried && !v.reference.trim() ? "Required" : undefined) ?? fieldErr("reference")} placeholder="e.g. TRX-20261110-0001" />
          </FormGrid>
          <FileField file={v.file} sizeMb={v.sizeMb} error={(tried ? fileErr : undefined) ?? fieldErr("proofFileName")} onChange={(file, sizeMb) => setV({ ...v, file, sizeMb })} />
          <Textarea label="Remarks (optional)" value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} placeholder="e.g. Payment covers two invoices" />
          {send.error && <Banner tone="danger">{errMessage(send.error)}</Banner>}
        </Stack>
      )}
    </Modal>
  );
}

const DISPUTE_REASONS = ["Wrong number of days", "Wrong rate", "Unit not on hire / already returned", "Charge not agreed", "Duplicate billing", "Other"];
/** Dispute an invoice (proposed scope): the AE and Accounting review it; a correction comes as a credit memo. */
export function DisputeDialog({ inv, onClose }: { inv: InvRow | null; onClose: () => void }) {
  const blank = { reason: "", details: "", amount: 0, file: "" };
  const [v, setV] = useState(blank);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [last, setLast] = useState<InvRow | null>(null);
  if (inv !== last) { setLast(inv); setV(blank); setTried(false); setDone(null); }
  const send = useAction(() => api.portal.disputeInvoice({ invoiceNo: inv!.invoiceNo, reason: v.reason, details: v.details, amountDisputed: v.amount || undefined, attachment: v.file || undefined }), { onSuccess: (d) => setDone(d.id) });
  if (!inv) return null;
  const fieldErr = (f: string) => (send.error as { fields?: Record<string, string> } | null)?.fields?.[f];
  return (
    <Modal open onClose={onClose} size="lg" title={done ? "Dispute sent" : `Dispute ${inv.invoiceNo}`}
      description={done ? undefined : "Your Account Executive and Accounting review it. If the invoice is wrong, a credit memo corrects it; the invoice stays payable until then."}
      footer={done ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={send.isPending} onClick={() => { setTried(true); if (v.reason && v.details.trim().length >= 10) send.mutate(undefined); }}>Send dispute</Button></>}>
      {done ? (
        <Banner tone="success" title={`${done} received`}>Your Account Executive and Accounting have been notified. The invoice shows “Disputed” while it is reviewed; the outcome is shown on the invoice.</Banner>
      ) : (
        <Stack>
          <FormGrid>
            <Select label="Reason" required value={v.reason} placeholder="Select" onChange={(e) => setV({ ...v, reason: e.target.value })} options={DISPUTE_REASONS.map((r) => ({ value: r, label: r }))} error={(tried && !v.reason ? "Required" : undefined) ?? fieldErr("reason")} />
            <MoneyInput label="Amount disputed (optional)" value={v.amount || ""} onChange={(e) => setV({ ...v, amount: Number(e.target.value) })} error={fieldErr("amountDisputed")} hint={`Up to ${formatPhp(inv.total)}`} />
          </FormGrid>
          <Textarea label="What is wrong?" required value={v.details} onChange={(e) => setV({ ...v, details: e.target.value })} error={(tried && v.details.trim().length < 10 ? "At least 10 characters" : undefined) ?? fieldErr("details")} placeholder="e.g. DW-MNL-1003 was returned on 25-Oct but is billed to 27-Oct" />
          <FileField optional file={v.file} sizeMb={0} onChange={(file) => setV({ ...v, file })} />
          {send.error && <Banner tone="danger">{errMessage(send.error)}</Banner>}
        </Stack>
      )}
    </Modal>
  );
}

function FileField({ file, sizeMb, error, optional, onChange }: { file: string; sizeMb: number; error?: string; optional?: boolean; onChange: (file: string, sizeMb: number) => void }) {
  return (
    <Field label={optional ? "Supporting file (optional)" : "Proof of payment"} required={!optional} error={error} hint="One file — PDF, JPG or PNG, max 5 MB">
      {(id, d) => (
        <label htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-line-strong p-4 text-sm text-muted hover:border-brand-300">
          <Upload className="size-5" />
          <span className={cn("min-w-0 flex-1 truncate", file && "text-ink")}>{file ? `${file}${sizeMb ? ` · ${sizeMb.toFixed(1)} MB` : ""}` : "Upload the bank slip, deposit slip or confirmation"}</span>
          {file && <button type="button" aria-label="Remove file" onClick={(e) => { e.preventDefault(); onChange("", 0); }}><X className="size-4" /></button>}
          <input id={id} aria-describedby={d} type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; onChange(f?.name ?? "", f ? f.size / 1048576 : 0); e.target.value = ""; }} />
        </label>
      )}
    </Field>
  );
}
