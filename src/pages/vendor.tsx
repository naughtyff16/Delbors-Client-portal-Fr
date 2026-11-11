import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { api } from '../lib/api-client';
import { formatDate, formatDateTime, formatPhp } from '../lib/shared';
import { Banner, Button, DataTable, Field, FormGrid, Input, KpiTile, Modal, MoneyInput, PageHeader, Select, Stack, StatusBadge } from '../lib/ui';
import { errMessage, useAction, useData } from '../auth';

// ── SCR-33 Vendor Portal (strictly scoped to the signed-in vendor) ─────────
const MAX_FILE_MB = 10; // UI limit for the invoice attachment (proposed — confirm with Procurement / document service)
export function VendorPortalPage() {
  const data = useData(['vendor'], () => api.vendorPortal.data());
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ poNo: '', invoiceNo: '', invoiceDate: new Date().toISOString().slice(0, 10), amount: 0, fileName: '' });
  const [tried, setTried] = useState(false);
  const [tooBig, setTooBig] = useState(false);
  const up =useAction(() => api.vendorPortal.uploadInvoice(v), { success: 'Invoice submitted — status: Submitted', onSuccess: () => { setOpen(false); setTried(false); } });
  const submit = () => { setTried(true); if (v.poNo && v.invoiceNo.trim() && v.invoiceDate && v.amount > 0 && v.fileName) up.mutate(undefined); };
  const openUpload = (poNo = v.poNo) => { setV({ ...v, poNo }); setTried(false); setTooBig(false); setOpen(true); };
  const d = data.data;
  const vendorName = d?.vendor?.name.replace(/\s*\(demo\)\s*$/i, '');
  const openPos = (d?.pos ?? []).filter((p) => !['Closed', 'Cancelled'].includes(p.status));
  const underReview = (d?.invoices ?? []).filter((i) => ['Submitted', 'Under Review'].includes(i.status)).length;
  const paid = (d?.invoices ?? []).filter((i) => i.status === 'Paid').reduce((a, i) => a + i.amount, 0);
  const exportCsv = () => {
    const rows = [['Type', 'Ref', 'Date', 'Amount', 'Status'], ...(d?.pos ?? []).map((p) => ['PO', p.poNo, p.createdAt.slice(0, 10), String(p.total), p.status]), ...(d?.invoices ?? []).map((i) => ['Invoice', i.invoiceNo, i.invoiceDate, String(i.amount), i.status])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'vendor-statement.csv'; a.click(); URL.revokeObjectURL(url);
  };
  type Po = NonNullable<typeof d>['pos'][number];
  type Inv = NonNullable<typeof d>['invoices'][number];
  const [poView, setPoView] = useState<Po | null>(null);
  const selPo = d?.pos.find((p) => p.poNo === v.poNo);
  const invoiced = (poNo: string) => (d?.invoices ?? []).filter((i) => i.poNo === poNo && i.status !== 'Rejected').reduce((a, i) => a + i.amount, 0);
  const poLines = (po: Po) => (
    <table className="w-full text-sm"><thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-1.5">Item</th><th className="text-right">Qty</th><th className="text-right">Received</th><th className="text-right">Unit price</th><th className="text-right">Amount</th></tr></thead>
      <tbody>{po.lines.map((l) => <tr key={l.partCode} className="border-b border-line last:border-0"><td className="py-1.5"><span className="font-mono text-xs">{l.partCode}</span> {l.description}</td><td className="text-right tabular">{l.qty}</td><td className="text-right tabular">{l.qtyReceived}</td><td className="text-right tabular">{formatPhp(l.unitPrice)}</td><td className="text-right tabular">{formatPhp(l.qty * l.unitPrice)}</td></tr>)}</tbody>
      <tfoot><tr className="font-semibold"><td className="py-1.5" colSpan={4}>PO total</td><td className="text-right tabular">{formatPhp(po.total)}</td></tr></tfoot></table>
  );
  return (
    <>
      <PageHeader title={vendorName ?? 'Vendor portal'} description="Upload invoices against your purchase orders, track their status and export your statement. You only ever see your own transactions."
        actions={<span className="flex flex-col items-end gap-1">
          <span className="flex flex-wrap justify-end gap-2"><Button variant="secondary" icon={<Download className="size-4" />} onClick={exportCsv}>Export statement</Button>
            {/* Grey (secondary) when disabled so it never reads as an enabled tinted button; the reason is shown inline for touch users. */}
            <Button variant={openPos.length ? 'primary' : 'secondary'} icon={<Upload className="size-4" />} disabled={!openPos.length} aria-describedby={!openPos.length ? 'upload-why' : undefined} onClick={() => openUpload()}>Upload invoice</Button></span>
          {!openPos.length && d && <span id="upload-why" className="text-xs text-muted">No open purchase orders to invoice</span>}
        </span>} />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiTile label="Open POs" value={openPos.length} />
        <KpiTile label="Invoices under review" value={underReview} tone={underReview ? 'warning' : 'default'} />
        <KpiTile label="Paid" value={formatPhp(paid)} tone={paid ? 'success' : 'default'} hint="All time" />
      </div>
      <h2 className="mb-2 font-semibold">My purchase orders</h2>
      <DataTable<Po> data={d?.pos} loading={data.isLoading} searchable={false} emptyTitle="No purchase orders" emptyHint="Purchase orders issued to you by Delbros appear here. You can upload an invoice once you have an open PO." onRowClick={setPoView} columns={[
        { accessorKey: 'poNo', header: 'PO', cell: (c) => <span className="font-mono">{c.getValue<string>()}</span> }, { accessorKey: 'createdAt', header: 'Issued', cell: (c) => formatDate(c.getValue<string>()) },
        { accessorKey: 'deliveryDate', header: 'Delivery', cell: (c) => formatDate(c.getValue<string>()) }, { accessorKey: 'terms', header: 'Terms' },
        { id: 'items', header: 'Items', cell: (c) => `${c.row.original.lines.length} line${c.row.original.lines.length === 1 ? '' : 's'}` },
        { accessorKey: 'total', header: 'Total', meta: { align: 'right' }, cell: (c) => formatPhp(c.getValue<number>()) }, { accessorKey: 'status', header: 'Status', cell: (c) => <StatusBadge domain="po" value={c.getValue<string>()} /> }]} />
      <Modal open={!!poView} onClose={() => setPoView(null)} title={<span className="font-mono">{poView?.poNo}</span>} description={poView ? `Issued ${formatDate(poView.createdAt)} · delivery ${formatDate(poView.deliveryDate)} · ${poView.terms}` : undefined} size="lg"
        footer={<><Button variant="secondary" onClick={() => setPoView(null)}>Close</Button><Button icon={<Upload className="size-4" />} onClick={() => { openUpload(poView!.poNo); setPoView(null); }}>Upload invoice for this PO</Button></>}>
        {poView && <Stack>{poLines(poView)}<p className="text-sm text-muted">Invoiced so far: {formatPhp(invoiced(poView.poNo))} of {formatPhp(poView.total)}</p></Stack>}
      </Modal>
      <h2 className="mb-2 mt-6 font-semibold">My invoices</h2>
      <DataTable<Inv> data={d?.invoices} loading={data.isLoading} searchable={false} emptyTitle="No invoices submitted" emptyHint="Invoices you upload against a purchase order appear here with their review status." columns={[
        { accessorKey: 'invoiceNo', header: 'Invoice no.', cell: (c) => <span className="font-mono">{c.getValue<string>()}</span> }, { accessorKey: 'poNo', header: 'PO', cell: (c) => <span className="font-mono">{c.getValue<string>()}</span> }, { accessorKey: 'invoiceDate', header: 'Date', cell: (c) => formatDate(c.getValue<string>()) },
        { accessorKey: 'amount', header: 'Amount', meta: { align: 'right' }, cell: (c) => formatPhp(c.getValue<number>()) }, { accessorKey: 'submittedAt', header: 'Submitted', cell: (c) => formatDateTime(c.getValue<string>()) },
        { accessorKey: 'status', header: 'Status', cell: (c) => <StatusBadge domain="po" value={c.getValue<string>()} /> }]} />
      <Modal open={open} onClose={() => setOpen(false)} title="Upload invoice" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={up.isPending} disabled={!d?.pos.length} title={!d?.pos.length ? 'No open purchase orders' : undefined} onClick={submit}>Submit invoice</Button></>}>
        <Stack>
          <FormGrid>
            <Select label="Purchase order" required error={tried && !v.poNo ? 'Required' : undefined} value={v.poNo} onChange={(e) => setV({ ...v, poNo: e.target.value })} placeholder={d?.pos.length ? 'Select' : 'No open purchase orders'} disabled={!d?.pos.length} options={(d?.pos ?? []).map((p) => ({ value: p.poNo, label: `${p.poNo} · ${formatPhp(p.total)}` }))} />
            <Input label="Invoice no." required error={tried && !v.invoiceNo.trim() ? 'Required' : undefined} value={v.invoiceNo} onChange={(e) => setV({ ...v, invoiceNo: e.target.value })} placeholder="e.g. SI-2026-000123" />
            <Input label="Invoice date" type="date" required error={tried && !v.invoiceDate ? 'Required' : undefined} value={v.invoiceDate} onChange={(e) => setV({ ...v, invoiceDate: e.target.value })} />
            <MoneyInput label="Amount" required error={tried && !(v.amount > 0) ? 'Enter the invoice amount' : undefined} value={v.amount || ''} onChange={(e) => setV({ ...v, amount: Number(e.target.value) })} />
          </FormGrid>
          {selPo && <div className="rounded-lg border border-line p-3"><p className="mb-1 text-xs font-medium text-muted">Ordered items on {selPo.poNo}</p>{poLines(selPo)}</div>}
          {selPo && v.amount > selPo.total - invoiced(selPo.poNo) && <Banner tone="warning">Amount exceeds the PO balance not yet invoiced ({formatPhp(selPo.total - invoiced(selPo.poNo))}). Procurement will check it against the PO and receiving report.</Banner>}
          <Field label="Invoice file" required error={tooBig ? `File is larger than ${MAX_FILE_MB} MB` : tried && !v.fileName ? 'Attach the invoice' : undefined}>
            {(id, dsc) => (
              <label htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-line-strong p-4 text-sm text-muted hover:border-brand-300">
                <Upload className="size-5" /><span className={v.fileName ? 'text-ink' : undefined}>{v.fileName || `Attach the invoice (PDF or image, max ${MAX_FILE_MB} MB)`}</span>
                <input id={id} aria-describedby={dsc} type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; const big = !!f && f.size > MAX_FILE_MB * 1024 * 1024; setTooBig(big); setV({ ...v, fileName: f && !big ? f.name : '' }); }} />
              </label>
            )}
          </Field>
          {up.error && <Banner tone="danger">{errMessage(up.error)}</Banner>}
        </Stack>
      </Modal>
    </>
  );
}
