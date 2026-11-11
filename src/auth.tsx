import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import {
  api,
  ApiError,
  type PortalRealm,
  type PortalSignInResult,
} from "./lib/api-client";
import { Button, Modal, useToast } from "./lib/ui";

type Session = ReturnType<typeof api.auth.me>;
/** Why the user is back on the sign-in page — shown there once. */
export type SignOutReason = "expired" | "signed_out";
interface Ctx {
  user: Session;
  /** Step 1: email + password. Signs in directly, or asks for the emailed one-time code. */
  signIn: (
    email: string,
    pw: string,
    realm: PortalRealm,
  ) => Promise<PortalSignInResult>;
  /** Step 2 (when the second factor is on): the 6-digit code. */
  verifyOtp: (challengeId: string, code: string) => Promise<Session>;
  logout: (reason?: SignOutReason) => Promise<void>;
}
const AuthCtx = createContext<Ctx | null>(null);

// sessionStorage keys (per browser tab, like the session itself).
const LAST_ACTIVITY = "delbros.portal.lastActivity";
const SIGN_OUT_REASON = "delbros.portal.signOutReason";
/** Set once the hold notice has been shown after sign-in (BR-01), so it appears once per session. */
export const HOLD_NOTICE_SHOWN = "delbros.portal.holdNoticeShown";
const store = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
  del: (k: string) => {
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* private mode */
    }
  },
};
export const sessionFlag = store;
/** Why the user was signed out (read during render; clear it in an effect with clearSignOutReason). */
export function readSignOutReason(): SignOutReason | null {
  const r = store.get(SIGN_OUT_REASON);
  return r === "expired" || r === "signed_out" ? r : null;
}
export const clearSignOutReason = () => store.del(SIGN_OUT_REASON);
/** Demo / review only: show the session-expired state without waiting for the timeout. */
export const previewSessionExpired = () => store.set(SIGN_OUT_REASON, "expired");

const WARN_SECONDS = 60;
const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart", "mousemove"] as const;

/** Portal realms: CLIENT_PORTAL and VENDOR_PORTAL. Internal accounts are rejected here (docs/01 §6). */
export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const timeoutMin = api.auth.policy().sessionTimeoutMinutes;
  const [user, setUser] = useState<Session>(() => {
    const u = api.auth.me();
    if (!u || u.realm === "INTERNAL") return null;
    // Session timeout also applies across a reload: idle longer than the limit → signed out.
    const last = Number(store.get(LAST_ACTIVITY));
    if (last && Date.now() - last > timeoutMin * 60_000) {
      api.auth.expireSession(timeoutMin);
      store.set(SIGN_OUT_REASON, "expired");
      return null;
    }
    return u;
  });
  const qc = useQueryClient();
  const start = useCallback(
    (u: Session) => {
      qc.clear();
      store.set(LAST_ACTIVITY, String(Date.now()));
      store.del(HOLD_NOTICE_SHOWN);
      setUser(u);
    },
    [qc],
  );
  const signIn = useCallback(
    async (email: string, pw: string, realm: PortalRealm) => {
      const r = await api.auth.portalLogin(email, pw, realm);
      if (r.status === "signed_in") start(r.user);
      return r;
    },
    [start],
  );
  const verifyOtp = useCallback(
    async (challengeId: string, code: string) => {
      const u = await api.auth.verifyOtp(challengeId, code);
      start(u);
      return u;
    },
    [start],
  );
  const logout = useCallback(
    async (reason: SignOutReason = "signed_out") => {
      if (reason === "expired") api.auth.expireSession(timeoutMin);
      else await api.auth.logout();
      store.set(SIGN_OUT_REASON, reason);
      store.del(LAST_ACTIVITY);
      store.del(HOLD_NOTICE_SHOWN);
      qc.clear();
      setUser(null);
    },
    [qc, timeoutMin],
  );
  const value = useMemo(
    () => ({ user, signIn, verifyOtp, logout }),
    [user, signIn, verifyOtp, logout],
  );
  return (
    <AuthCtx.Provider value={value}>
      {children}
      {user && (
        <SessionTimeout
          minutes={timeoutMin}
          onExpire={() => void logout("expired")}
          onSignOut={() => void logout("signed_out")}
        />
      )}
    </AuthCtx.Provider>
  );
}

/**
 * Signs the portal user out after `minutes` without activity. One minute before, a dialog counts down
 * with "Stay signed in" / "Sign out"; while it is open, ordinary mouse movement does not extend the session.
 */
function SessionTimeout({
  minutes,
  onExpire,
  onSignOut,
}: {
  minutes: number;
  onExpire: () => void;
  onSignOut: () => void;
}) {
  const limit = minutes * 60_000;
  const last = useRef(Number(store.get(LAST_ACTIVITY)) || Date.now());
  const warningRef = useRef(false);
  const [left, setLeft] = useState<number | null>(null); // seconds left while the warning shows
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  const touch = useCallback(() => {
    last.current = Date.now();
    store.set(LAST_ACTIVITY, String(last.current));
  }, []);
  useEffect(() => {
    let written = 0;
    const onActivity = () => {
      if (warningRef.current) return;
      last.current = Date.now();
      if (last.current - written > 5_000) {
        written = last.current;
        store.set(LAST_ACTIVITY, String(last.current));
      }
    };
    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true }),
    );
    const tick = window.setInterval(() => {
      const remaining = Math.ceil((limit - (Date.now() - last.current)) / 1000);
      if (remaining <= 0) {
        window.clearInterval(tick);
        expireRef.current();
      } else if (remaining <= WARN_SECONDS) {
        warningRef.current = true;
        setLeft(remaining);
      } else if (warningRef.current) {
        warningRef.current = false;
        setLeft(null);
      }
    }, 1000);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      window.clearInterval(tick);
    };
  }, [limit]);
  const stay = () => {
    touch();
    warningRef.current = false;
    setLeft(null);
  };
  return (
    <Modal
      open={left != null}
      onClose={stay}
      size="sm"
      title="Your session is about to expire"
      footer={
        <>
          <Button variant="secondary" onClick={onSignOut}>
            Sign out
          </Button>
          <Button onClick={stay}>Stay signed in</Button>
        </>
      }
    >
      <div className="flex items-start gap-3 text-sm text-ink-2">
        <Clock className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <p>
          For your security, you will be signed out in{" "}
          <strong className="tabular-nums text-ink" aria-live="polite">
            {left ?? 0} second{left === 1 ? "" : "s"}
          </strong>
          . The portal signs you out after {minutes} minutes without activity.
          Any unsaved entries will be lost.
        </p>
      </div>
    </Modal>
  );
}

export function usePortalAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("usePortalAuth outside provider");
  return c;
}

export const useData = <T,>(
  key: unknown[],
  fn: () => Promise<T>,
  enabled = true,
) => useQuery({ queryKey: key, queryFn: fn, enabled });

export function useAction<V, R>(
  fn: (v: V) => Promise<R>,
  opts: {
    success?: string | ((r: R) => string);
    onSuccess?: (r: R) => void;
  } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.invalidateQueries();
      if (opts.success)
        toast.success(
          typeof opts.success === "function" ? opts.success(r) : opts.success,
        );
      opts.onSuccess?.(r);
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : "Something went wrong"),
  });
}

export const errMessage = (e: unknown) =>
  e instanceof ApiError ? e.message : e ? String(e) : undefined;
