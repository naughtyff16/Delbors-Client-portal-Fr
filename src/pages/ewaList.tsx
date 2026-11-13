// ── SCR-14 EWA list (portal) — pieces for the EWA list review (2026-11-11) ──
//  • extension flow and history (requested → manager approval → IT revalidation → new valid-until), GAT-003 / BR-06
//  • partly released EWAs: "1/2 released · 1 remaining", and at expiry the unreleased units lapse
//  • history of each EWA (created, extensions, gate releases, cancellation, expiry) — all times Philippine time (PHT, UTC+8)
import type { ReactNode } from "react";
import type { api } from "../lib/api-client";
import { formatDateTime } from "../lib/shared";
import { cn } from "../lib/ui";

export type EwaListRow = Awaited<ReturnType<typeof api.gate.ewas>>[number];
/** Timestamps are Manila time; the label says so wherever times are shown (review: timezone label). */
export const TZ = "PHT";
export const TZ_NOTE = "All times are Philippine time (PHT, UTC+8).";

const released = (e: Pick<EwaListRow, "units">) => e.units.reduce((a, u) => a + u.usedChassis.length, 0);
const requested = (e: Pick<EwaListRow, "units">) => e.units.reduce((a, u) => a + u.qty, 0);

/** "1/2 released · 1 remaining" while usable; "· 1 lapsed" once an EWA expired part-released. */
export function releaseNote(e: Pick<EwaListRow, "units" | "status">) {
  const r = released(e), q = requested(e), left = q - r;
  if (!r || !left) return null;
  if (e.status === "Partially Used" || e.status === "Active" || e.status === "Extension Pending") return `${left} remaining`;
  if (e.status === "Expired") return `${left} lapsed`;
  if (e.status === "Cancelled") return `${left} cancelled`;
  return null;
}
export const isPartial = (e: Pick<EwaListRow, "units">) => released(e) > 0 && released(e) < requested(e);
/** The client may cancel its own EWA while it is Active and nothing has been released (proposed rule). */
export const clientCanCancel = (e: Pick<EwaListRow, "status" | "units">) => e.status === "Active" && released(e) === 0;

/** Plain-text summary for Share (or the clipboard when the device cannot share). */
export function ewaShareText(e: EwaListRow, eqName: (c: string) => string, client?: string) {
  return [
    `EWA ${e.euNo}${client ? ` — ${client}` : ""}`,
    `Valid until ${formatDateTime(e.validUntil)} ${TZ}`,
    `Pickup branch ${e.branchCode} · contract ${e.contractNo}`,
    `Trucker ${e.trucker} · truck ${e.truckPlateNo}`,
    `Driver ${e.driverName} · license ${e.driverLicenseNo}`,
    `Units: ${e.units.map((u) => `${eqName(u.equipmentType)} × ${u.qty}`).join(", ")}`,
    "Present the EU number and a valid license at the gate.",
  ].join("\n");
}

type Step = { at: string; title: string; detail?: ReactNode; tone?: "ok" | "warn" | "bad" | "info" };
/** Everything that happened to the EWA, oldest first: created, extension requests and decisions, releases, cancellation, expiry. */
export function EwaHistory({ e }: { e: EwaListRow }) {
  const steps: Step[] = [{ at: e.createdAt, title: `Created by ${e.createdByName}`, detail: `${e.createdVia === "Portal" ? "Client portal" : "Delbros"} · valid for 24 hours`, tone: "info" }];
  for (const x of e.extensions ?? []) {
    steps.push({ at: x.requestedAt, title: `Extension requested by ${x.requestedByName ?? x.requestedBy}`, detail: x.reason, tone: "warn" });
    if (x.status !== "Pending" && x.decidedAt)
      steps.push({
        at: x.decidedAt, tone: x.status === "Approved" ? "ok" : "bad",
        title: `Extension ${x.status.toLowerCase()}${x.decidedByName ? ` by ${x.decidedByName}` : ""}`,
        detail: x.status === "Approved"
          ? <>Manager approval and IT revalidation · valid until {formatDateTime(x.validUntilBefore)} → <strong>{formatDateTime(x.validUntilAfter)}</strong> {TZ}</>
          : "The EWA stays expired.",
      });
  }
  for (const a of e.extension?.approvals ?? []) if (a.at) steps.push({ at: a.at, title: `${a.label}: approved${a.by ? ` by ${a.by}` : ""}`, detail: "Extension request — next step below.", tone: "ok" });
  if (e.extension && (e.extensions ?? []).some((x) => x.status === "Pending"))
    steps.push({ at: new Date().toISOString(), title: `Awaiting: ${e.extension.stepLabel ?? "manager approval"}`, detail: "The new valid-until time is set only after manager approval and IT revalidation (BR-06).", tone: "warn" });
  for (const g of e.gatePasses) steps.push({ at: g.at, title: `Released at the gate — ${g.gatePassNo}`, detail: `${g.chassisNo}${g.truckOrcr ? ` · truck OR/CR ${g.truckOrcr}` : ""}`, tone: "ok" });
  if (e.status === "Cancelled" && e.cancelledAt) steps.push({ at: e.cancelledAt, title: `Cancelled${e.cancelledByName ? ` by ${e.cancelledByName}` : ""}`, detail: e.cancelReason ?? "No reason recorded.", tone: "bad" });
  if (e.status === "Expired") steps.push({ at: e.validUntil, title: "Expired", detail: releaseNote(e) ? `Validity ended — ${releaseNote(e)} (not released in time).` : "Validity ended before the pickup.", tone: "bad" });
  steps.sort((a, b) => a.at.localeCompare(b.at));
  const dot = { ok: "bg-success", warn: "bg-warning", bad: "bg-danger", info: "bg-brand-600" };
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-muted">History <span className="font-normal">({TZ})</span></p>
      <ol className="relative space-y-3 border-l border-line pl-4 text-sm">
        {steps.map((s, i) => (
          <li key={i} className="relative">
            <span className={cn("absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-4 ring-surface", dot[s.tone ?? "info"])} aria-hidden />
            <p className="text-ink">{s.title} <span className="text-muted">· {formatDateTime(s.at)}</span></p>
            {s.detail && <p className="text-sm text-muted">{s.detail}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
