import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./lib/api-client";
import type { User } from "./lib/shared";
import { useToast } from "./lib/ui";

type Session = ReturnType<typeof api.auth.me>;
interface Ctx {
  user: Session;
  login: (id: string, pw: string, realm: User["realm"]) => Promise<Session>;
  logout: () => Promise<void>;
}
const AuthCtx = createContext<Ctx | null>(null);

/** Portal realms: CLIENT_PORTAL and VENDOR_PORTAL. Internal accounts are rejected here (docs/01 §6). */
export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Session>(() => {
    const u = api.auth.me();
    return u && u.realm !== "INTERNAL" ? u : null;
  });
  const qc = useQueryClient();
  const login = useCallback(
    async (id: string, pw: string, realm: User["realm"]) => {
      const u = await api.auth.login(id, pw, realm);
      qc.clear();
      setUser(u);
      return u;
    },
    [qc],
  );
  const logout = useCallback(async () => {
    await api.auth.logout();
    qc.clear();
    setUser(null);
  }, [qc]);
  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
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
