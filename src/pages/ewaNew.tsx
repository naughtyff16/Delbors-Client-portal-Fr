// ── SCR-14 New EWA (portal) ────────────────────────────────────────────────
// Portal New EWA review (2026-11-11) — the items marked "Not met":
//  • blocked states in the dialog: on hold, not accredited, Allow Online off, no eligible branch, no active contract (BR-01)
//  • contract → pickup branch → equipment: the equipment list opens only when both are chosen, with an empty state when nothing is free
//  • free units per type at the branch, and quantity limited by branch stock and the contract entitlement (per type and in total)
//  • more than one equipment type per EWA (proposed — Delbros to confirm; the EWA record and Gate Out already take several lines)
//  • "Missing driver/truck info" and LTO format checks, in the form and in the API
//  • optional truck OR/CR (the yard still checks the original at Gate Out), saved drivers / trucks, expected pickup time and remarks
import { useState } from "react";
import { Mail, Minus, Plus } from "lucide-react";
import { api, ApiError } from "../lib/api-client";
import { LICENCE_RE, PLATE_RE, formatDate, formatDateTime, formatPhp, type EwaDelivery } from "../lib/shared";
import { Badge, Banner, Button, DatePicker, Field, FormGrid, Input, Modal, Select, Stack, Textarea, cn } from "../lib/ui";
import { errMessage, useAction, useData } from "../auth";
import { ContactLine } from "./common";
import { plural } from "./portalUi";

type Created = Awaited<ReturnType<typeof api.gate.createEwa>>;
type Options = Awaited<ReturnType<typeof api.portal.ewaOptions>>;
const pad = (n: number) => String(n).padStart(2, "0");
/** Local 'YYYY-MM-DDTHH:mm' for the date-time picker. */
const localStamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const REMARKS_MAX = 300;

export function NewEwaDialog({ open, onClose, onCreated, eqName }: { open: boolean; onClose: () => void; onCreated: (e: Created) => void; eqName: (c: string) => string }) {
  const opts = useData(["portal-ewa-options"], () => api.portal.ewaOptions(), open);
  const o = opts.data;
  if (!open) return null;
  if (o && !o.blocked) return <EwaForm o={o} onClose={onClose} onCreated={onCreated} eqName={eqName} />;
  return (
    <Modal open onClose={onClose} title="New EWA" size="lg" description={`Valid for ${o?.validityHours ?? 24} hours. Your driver presents the EU number at the gate.`}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {!o ? <p className="text-sm text-muted">Loading…</p> : <Blocked o={o} />}
    </Modal>
  );
}

/** BR-01 and eligibility: what the client sees instead of the form, and who to contact. */
function Blocked({ o }: { o: Options }) {
  const b = o.blocked!;
  return (
    <Banner tone={b.code === "HOLD" || b.code === "NOT_ACCREDITED" || b.code === "ACCOUNT" ? "danger" : "warning"} title={b.title}>
      <p>{b.reason}</p>
      <div className="mt-3 border-t border-current/15 pt-3">
        <p className="text-sm font-medium opacity-80">Who to contact:</p>
        {b.code === "HOLD" && <ContactLine contact={o.creditContact} className="mt-0.5" />}
        <ContactLine contact={o.accountExecutive} className="mt-0.5" />
      </div>
    </Banner>
  );
}

function EwaForm({ o, onClose, onCreated, eqName }: { o: Options; onClose: () => void; onCreated: (e: Created) => void; eqName: (c: string) => string }) {
  const [v, setV] = useState({
    contractNo: o.contracts.length === 1 ? o.contracts[0].contractNo : "",
    branchCode: o.branches.length === 1 ? o.branches[0].code : "",
    trucker: "", truckPlateNo: "", truckOrcr: "", driverName: "", driverLicenseNo: "", pickupAt: "", remarks: "",
  });
  const [lines, setLines] = useState<{ eq: string; qty: number }[]>([{ eq: "", qty: 1 }]);
  const [tried, setTried] = useState(false);
  const ct = o.contracts.find((c) => c.contractNo === v.contractNo);
  const branchName = (code: string) => o.branches.find((b) => b.code === code)?.name ?? code;
  const freeAt = (branch: string, eq: string) => o.availability[branch]?.[eq] ?? 0;
  const ready = !!ct && !!v.branchCode; // the equipment list needs both the contract and the pickup branch
  const typeOf = (eq: string) => ct?.entitlement.types.find((t) => t.equipmentType === eq);
  const capOf = (eq: string) => (ready && eq ? Math.min(freeAt(v.branchCode, eq), typeOf(eq)?.remaining ?? 0) : undefined);
  const contractFreeAt = (branch: string) => (ct ? ct.entitlement.types.reduce((a, t) => a + Math.min(freeAt(branch, t.equipmentType), t.remaining), 0) : 0);
  const noStock = ready && contractFreeAt(v.branchCode) === 0;
  const otherBranches = ready ? o.branches.filter((b) => b.code !== v.branchCode && contractFreeAt(b.code) > 0) : [];
  const total = lines.reduce((a, l) => a + (l.eq ? l.qty || 0 : 0), 0);
  const overContract = !!ct && total > ct.entitlement.contractRemaining;

  const plateErr = v.truckPlateNo.trim() && !PLATE_RE.test(v.truckPlateNo.trim()) ? "Use the LTO format, e.g. NAB 5678" : undefined;
  const licErr = v.driverLicenseNo.trim() && !LICENCE_RE.test(v.driverLicenseNo.trim()) ? "Use the LTO format, e.g. N01-23-456789" : undefined;
  const need = (s: string) => (tried && !s.trim() ? "Required" : undefined);
  const lineErr = (l: { eq: string; qty: number }) => {
    if (!l.eq) return tried ? "Choose an equipment type" : undefined;
    const cap = capOf(l.eq) ?? 0, t = typeOf(l.eq);
    if (!Number.isInteger(l.qty) || l.qty < 1) return "Whole number, at least 1";
    if (l.qty > freeAt(v.branchCode, l.eq)) return `Only ${freeAt(v.branchCode, l.eq)} free at ${branchName(v.branchCode)}`;
    if (t && l.qty > t.remaining) return `Only ${t.remaining} left on your contract`;
    return l.qty > cap ? `At most ${cap}` : undefined;
  };
  const missingDriverTruck = tried && (!v.driverName.trim() || !v.driverLicenseNo.trim() || !v.truckPlateNo.trim() || !v.trucker.trim());
  const now = new Date();
  const pickupMin = localStamp(now), pickupMax = localStamp(new Date(now.getTime() + o.validityHours * 3_600_000));
  const pickupErr = v.pickupAt && (v.pickupAt < pickupMin.slice(0, 16) || v.pickupAt > pickupMax) ? `Within the next ${o.validityHours} hours` : undefined;

  const create = useAction(
    () => api.gate.createEwa({
      clientCode: "", contractNo: v.contractNo, branchCode: v.branchCode, trucker: v.trucker, truckPlateNo: v.truckPlateNo, driverName: v.driverName, driverLicenseNo: v.driverLicenseNo,
      units: lines.filter((l) => l.eq).map((l) => ({ equipmentType: l.eq, qty: l.qty })),
      truckOrcr: v.truckOrcr, expectedPickupAt: v.pickupAt ? new Date(v.pickupAt).toISOString() : undefined, remarks: v.remarks,
    }),
    { onSuccess: (e) => onCreated(e) },
  );
  const submit = () => {
    setTried(true);
    const bad = !v.contractNo || !v.branchCode || !v.trucker.trim() || !v.truckPlateNo.trim() || !v.driverName.trim() || !v.driverLicenseNo.trim()
      || plateErr || licErr || pickupErr || v.remarks.length > REMARKS_MAX || overContract || lines.some((l) => lineErr(l) || !l.eq);
    if (!bad) create.mutate(undefined);
  };
  const serverErr = create.error instanceof ApiError ? create.error : null;

  // Saved drivers and trucks from earlier EWAs: picking one fills the matching licence / trucker / OR-CR when those are still empty.
  const setDriver = (name: string) => {
    const d = o.drivers.find((x) => x.name === name);
    setV((s) => ({ ...s, driverName: name, driverLicenseNo: d && !s.driverLicenseNo ? d.licence : s.driverLicenseNo }));
  };
  const setPlate = (plate: string) => {
    const up = plate.toUpperCase();
    const t = o.trucks.find((x) => x.plate === up);
    setV((s) => ({ ...s, truckPlateNo: up, trucker: t && !s.trucker ? t.trucker : s.trucker, truckOrcr: t?.truckOrcr && !s.truckOrcr ? t.truckOrcr : s.truckOrcr }));
  };
  const truckers = [...new Set(o.trucks.map((t) => t.trucker))];

  const typesOnContract = ct?.entitlement.types ?? [];
  const canAddLine = ready && lines.length < typesOnContract.length && lines.every((l) => l.eq);
  return (
    <Modal open onClose={onClose} title="New EWA" size="lg" description={`Valid for ${o.validityHours} hours. Your driver presents the EU number at the gate.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={create.isPending} onClick={submit}>Create EWA</Button></>}>
    <Stack>
      <FormGrid>
        <Select label="Contract" required error={need(v.contractNo)} value={v.contractNo} placeholder="Select"
          onChange={(e) => { setV({ ...v, contractNo: e.target.value }); setLines([{ eq: "", qty: 1 }]); }}
          options={o.contracts.map((c) => ({ value: c.contractNo, label: `${c.contractNo} · Class ${c.class}${c.expiryDate ? ` · to ${formatDate(c.expiryDate)}` : ""}` }))}
          hint={ct ? `${ct.entitlement.contractRemaining} of ${ct.entitlement.unitQty} units can still be requested (${ct.entitlement.onHire} on hire, ${ct.entitlement.pending} on open EWAs)` : "Step 1 — the contract sets the equipment types and how many you may request"} />
        <Select label="Pickup branch" required error={need(v.branchCode)} value={v.branchCode} placeholder="Select"
          onChange={(e) => { setV({ ...v, branchCode: e.target.value }); setLines((ls) => ls.map((l) => ({ ...l, qty: 1 }))); }}
          options={o.branches.map((b) => ({ value: b.code, label: ct ? `${b.name} — ${contractFreeAt(b.code) ? `${contractFreeAt(b.code)} free` : "none free"}` : b.name }))}
          hint="Step 2 — branches enabled for your account; the count is units free for your contract" />
      </FormGrid>

      {/* Step 3 — equipment: only once both the contract and the pickup branch are chosen. */}
      <div className="rounded-2xl bg-surface-alt p-4">
        <p className="mb-3 text-sm font-medium text-ink">Equipment <span className="text-danger">*</span></p>
        {!ready ? (
          <p className="text-sm text-muted">Choose the contract and the pickup branch first — the list shows only your contract’s equipment types with the units free at that branch.</p>
        ) : noStock ? (
          <Banner tone="warning" title={`No units free at ${branchName(v.branchCode)} for this contract`}>
            {ct!.entitlement.contractRemaining === 0
              ? <>Contract {ct!.contractNo} has no units left to request ({ct!.entitlement.onHire} on hire, {ct!.entitlement.pending} on open EWAs). Return a unit or ask your Account Executive about adding units.</>
              : otherBranches.length ? (
                <>Units are free at:{" "}
                  {otherBranches.map((b, i) => (
                    <span key={b.code}>{i ? ", " : ""}<button type="button" className="font-medium underline" onClick={() => setV({ ...v, branchCode: b.code })}>{b.name} ({contractFreeAt(b.code)})</button></span>
                  ))}. Choose one of these, or ask your Account Executive when stock is expected.</>
              ) : <>None of your enabled branches has a free unit of your contract’s types right now. Your Account Executive can tell you when stock is expected.</>}
          </Banner>
        ) : (
          <Stack>
            {lines.map((l, i) => {
              const t = l.eq ? typeOf(l.eq) : undefined;
              const cap = capOf(l.eq);
              const err = lineErr(l);
              return (
                <div key={i} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-start">
                  <Select label={lines.length > 1 ? `Equipment type ${i + 1}` : "Equipment type"} required value={l.eq} placeholder="Select"
                    error={!l.eq && tried ? "Choose an equipment type" : undefined}
                    onChange={(e) => setLines(lines.map((x, k) => (k === i ? { eq: e.target.value, qty: 1 } : x)))}
                    options={typesOnContract.map((ty) => {
                      const free = freeAt(v.branchCode, ty.equipmentType), left = ty.remaining;
                      const taken = lines.some((x, k) => k !== i && x.eq === ty.equipmentType);
                      return { value: ty.equipmentType, disabled: taken || free === 0 || left === 0,
                        label: `${eqName(ty.equipmentType)} — ${free === 0 ? "none free" : `${free} free`}${left === 0 ? " · none left on contract" : ""}${taken ? " · already added" : ""}` };
                    })}
                    hint={t ? `${freeAt(v.branchCode, l.eq)} free at ${branchName(v.branchCode)} · ${t.remaining} left on your contract${t.entitled != null ? ` (${t.entitled} entitled)` : ""} · ${formatPhp(t.dailyRate)}/day` : undefined} />
                  <Input label="Quantity" required type="number" min={1} max={cap || undefined} step={1} value={l.qty}
                    error={l.eq ? err : undefined} disabled={!l.eq}
                    onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: Math.trunc(Number(e.target.value)) } : x)))} />
                  {lines.length > 1 && (
                    <Button variant="ghost" size="sm" className="sm:mt-8" aria-label={`Remove equipment type ${i + 1}`} icon={<Minus className="size-4" />}
                      onClick={() => setLines(lines.filter((_, k) => k !== i))}>Remove</Button>
                  )}
                </div>
              );
            })}
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
              <span className={cn(overContract && "font-medium text-danger")}>
                {plural(total, "unit")} requested · {ct!.entitlement.contractRemaining} can still be requested on {ct!.contractNo}
                {overContract && " — reduce the quantities"}
              </span>
              {canAddLine && <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => setLines([...lines, { eq: "", qty: 1 }])}>Add another equipment type</Button>}
            </div>
          </Stack>
        )}
      </div>

      <FormGrid>
        <Input label="Trucker" required error={need(v.trucker)} value={v.trucker} placeholder="e.g. ABC Trucking Services"
          suggestions={truckers.map((t) => ({ value: t, hint: "used before" }))} onChange={(e) => setV({ ...v, trucker: e.target.value })} />
        <Input label="Truck plate no." required error={need(v.truckPlateNo) ?? (tried ? plateErr : undefined)} value={v.truckPlateNo} placeholder="e.g. NAB 5678"
          suggestions={o.trucks.map((t) => ({ value: t.plate, hint: t.trucker }))} onChange={(e) => setPlate(e.target.value)} />
        <Input label="Driver name" required error={need(v.driverName)} value={v.driverName} placeholder="e.g. Juan Dela Cruz"
          suggestions={o.drivers.map((d) => ({ value: d.name, hint: d.licence }))} onChange={(e) => setDriver(e.target.value)} />
        <Input label="Driver license no." required error={need(v.driverLicenseNo) ?? (tried ? licErr : undefined)} value={v.driverLicenseNo} placeholder="e.g. N01-23-456789"
          onChange={(e) => setV({ ...v, driverLicenseNo: e.target.value.toUpperCase() })} />
        <Input label="Truck OR/CR no. (optional)" value={v.truckOrcr} placeholder="e.g. OR 4100200 / CR 5200300" hint="The yard checks the original OR/CR at Gate Out"
          onChange={(e) => setV({ ...v, truckOrcr: e.target.value })} />
        <Field label="Expected pickup (optional)" error={pickupErr} hint={`Helps the yard prepare the unit — within the ${o.validityHours}-hour validity`}>
          {(id, d) => <DatePicker id={id} aria-describedby={d} withTime value={v.pickupAt} min={pickupMin.slice(0, 10)} max={pickupMax.slice(0, 10)} invalid={!!pickupErr} onChange={(x) => setV({ ...v, pickupAt: x })} />}
        </Field>
      </FormGrid>
      <Textarea label="Remarks for the yard (optional)" value={v.remarks} maxLength={REMARKS_MAX} placeholder="e.g. Driver arrives after 2 PM; needs twist locks checked"
        hint={`${v.remarks.length}/${REMARKS_MAX}`} onChange={(e) => setV({ ...v, remarks: e.target.value })} />
      {(missingDriverTruck || serverErr?.code === "MISSING_DRIVER_TRUCK_INFO") && (
        <Banner tone="danger" title="Missing driver/truck info">
          Enter the trucker, truck plate no., driver name and driver license no. — the gate checks them against the EWA.
        </Banner>
      )}
      {create.error && serverErr?.code !== "MISSING_DRIVER_TRUCK_INFO" && <Banner tone="danger">{errMessage(create.error)}</Banner>}
    </Stack>
    </Modal>
  );
}

/**
 * GAT-002 / N08: who the full-detail EWA email went to (client and Delbros), when, and its delivery status; "Resend email" while the EWA is usable.
 * The mock records each send as Sent — the mail service supplies the real status.
 */
export function EwaDeliveryLog({ euNo, status, delivery }: { euNo: string; status: string; delivery?: EwaDelivery[] }) {
  const [log, setLog] = useState<EwaDelivery[]>(delivery ?? []);
  const [last, setLast] = useState(delivery);
  if (delivery !== last) { setLast(delivery); setLog(delivery ?? []); }
  const resend = useAction(() => api.gate.resendEwaEmail(euNo), {
    success: (r) => `EWA email queued again for ${plural(r.length, "recipient")}`,
    onSuccess: (r) => setLog((l) => [...l, ...r]),
  });
  const usable = status === "Active" || status === "Partially Used";
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted">EWA email (full details)</p>
        {usable && !!log.length && <Button size="sm" variant="ghost" icon={<Mail className="size-4" />} loading={resend.isPending} onClick={() => resend.mutate(undefined)}>Resend email</Button>}
      </div>
      {log.length ? (
        <ul className="divide-y divide-line rounded-2xl bg-surface-alt text-sm">
          {log.map((d, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3">
              <span className="min-w-0">
                <span className="text-ink">{d.recipient}</span> <span className="text-muted">· {d.audience}</span>
                <span className="block truncate text-sm text-muted">{d.to}</span>
              </span>
              <span className="flex items-center gap-2 text-sm text-muted">
                {formatDateTime(d.at)}{d.resend ? " · resent" : ""}
                <Badge tone={d.status === "Sent" ? "success" : d.status === "Queued" ? "warning" : "danger"}>{d.status}</Badge>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No email log for this EWA (created before email tracking).</p>
      )}
    </div>
  );
}
