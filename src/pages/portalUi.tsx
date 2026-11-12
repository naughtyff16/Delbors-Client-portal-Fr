// Small pieces shared by the client portal screens (dashboard, EWA, Rescue, Invoices, E-wallet).
import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
  formatPhp,
  toneFor,
  walletState,
  WALLET_NEAR_FACTOR,
  type StatusDomain,
  type WalletStateKey,
} from "../lib/shared";
import { Badge, cn } from "../lib/ui";

/**
 * E-wallet states (portal dashboard review 2026-11-11 — proposed, Finance to confirm, EWL-004).
 * A positive balance under the contract minimum now has its own red "Below minimum" state; before, it stayed amber.
 */
export const WALLET_STATES: Record<
  WalletStateKey,
  { label: string; tone: "success" | "warning" | "danger"; range: (min: number) => string; advice: string }
> = {
  healthy: {
    label: "Healthy",
    tone: "success",
    range: (min) => `${formatPhp(min * WALLET_NEAR_FACTOR)} and above`,
    advice: "Above the minimum",
  },
  near: {
    label: "Near minimum",
    tone: "warning",
    range: (min) => `${formatPhp(min)} – under ${formatPhp(min * WALLET_NEAR_FACTOR)}`,
    advice: "Close to the minimum — consider a top-up",
  },
  below: {
    label: "Below minimum",
    tone: "danger",
    range: (min) => `₱0.00 – under ${formatPhp(min)}`,
    advice: "Below the contract minimum — please top up",
  },
  negative: {
    label: "Negative",
    tone: "danger",
    range: () => "Under ₱0.00",
    advice: "Charges exceeded the balance — top up to clear what is owed",
  },
};
export const WALLET_ORDER: WalletStateKey[] = ["healthy", "near", "below", "negative"];

type W = { balance: number; minimumBalance: number } | null | undefined;
export const walletStateOf = (w: W) =>
  w ? walletState(w.balance, w.minimumBalance) : undefined;
/** One tone rule for the e-wallet balance on every portal screen (dashboard tile and E-wallet page). */
export function walletTone(w: W): "default" | "danger" | "warning" | "success" {
  const s = walletStateOf(w);
  return s ? WALLET_STATES[s].tone : "default";
}
/** The rule, stated wherever the wallet colour is shown. */
export const walletRule = (min: number) =>
  WALLET_ORDER.map((k) => `${WALLET_STATES[k].label}: ${WALLET_STATES[k].range(min)}`).join(" · ");

/** Status pill with sentence-case text ("Partially paid", "Extension pending"); colour still comes from the shared status map. */
export function PortalStatus({
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

export const daysFromToday = (iso: string) =>
  Math.ceil(
    (new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) /
      86_400_000,
  );
export const dueText = (n: number) =>
  n < 0
    ? `overdue ${-n} day${n === -1 ? "" : "s"}`
    : n === 0
      ? "due today"
      : `due in ${n} day${n === 1 ? "" : "s"}`;
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export const MiniHead = ({
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

/**
 * Opens a record named in the URL (?open=EU-000781) once its list has loaded — used by notification links.
 * The parameter is removed afterwards so closing the record does not reopen it.
 */
export function useOpenParam<T>(
  rows: T[] | undefined,
  match: (row: T, id: string) => boolean,
  open: (row: T, action?: "pay" | "cancel") => void,
) {
  const [params, setParams] = useSearchParams();
  const id = params.get("open");
  useEffect(() => {
    if (!id || !rows) return;
    const row = rows.find((r) => match(r, id));
    // Timeline 2 review: dashboard entry points add an action (?pay=1 / ?cancel=1) that opens the matching dialog.
    if (row) open(row, params.get("pay") ? "pay" : params.get("cancel") ? "cancel" : undefined);
    const next = new URLSearchParams(params);
    next.delete("open"); next.delete("pay"); next.delete("cancel");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rows]);
}
