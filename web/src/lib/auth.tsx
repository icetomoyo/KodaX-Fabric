import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi } from "@/lib/api";
import { setUnauthorizedHandler } from "@/lib/http";
import { qk } from "@/lib/query/keys";
import type { Operator } from "@/types/api";

type SessionState =
  | { status: "loading"; operator: null }
  | { status: "authed"; operator: Operator }
  | { status: "guest"; operator: null };

type AuthContextValue = SessionState & {
  login: (username: string, password: string) => Promise<Operator>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: qk.me,
    queryFn: authApi.me,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const clear = useCallback(() => {
    qc.setQueryData(qk.me, null);
    qc.removeQueries({ queryKey: qk.admin.all });
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  const login = useCallback(
    async (username: string, password: string) => {
      await authApi.login(username, password);
      const operator = await authApi.me();
      qc.setQueryData(qk.me, operator);
      return operator;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => {});
    clear();
  }, [clear]);

  const value = useMemo<AuthContextValue>(() => {
    const op = me.data;
    const base: SessionState = me.isPending
      ? { status: "loading", operator: null }
      : op?.username
        ? { status: "authed", operator: op }
        : { status: "guest", operator: null };
    return { ...base, login, logout };
  }, [me.isPending, me.data, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
