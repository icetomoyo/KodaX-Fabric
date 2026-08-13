import * as React from "react";
import { callApi, requests, type Session } from "@/lib/api";

type SessionCtx = {
  session: Session | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  register: (phone: string, password: string, name: string) => Promise<void>;
};

const Ctx = React.createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      const out = await callApi<Session | null>(requests.me());
      setSession(out.data ?? null);
    } catch {
      setSession(null);
    }
  }, []);

  React.useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = React.useCallback(async (phone: string, password: string) => {
    const out = await callApi<Session>(requests.login(phone, password));
    setSession(out.data);
  }, []);

  const register = React.useCallback(async (phone: string, password: string, name: string) => {
    const out = await callApi<Session>(requests.register(phone, password, name));
    setSession(out.data);
  }, []);

  const value = React.useMemo(
    () => ({ session, loading, refresh, login, register }),
    [session, loading, refresh, login, register],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useSession outside provider");
  return ctx;
}
