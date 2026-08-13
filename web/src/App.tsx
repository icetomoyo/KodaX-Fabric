import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, type Operator } from "@/lib/api";
import { AdminPage } from "@/pages/AdminPage";
import { LoginPage } from "@/pages/LoginPage";
import { UserPage } from "@/pages/UserPage";

export type Session = { operator: Operator | null; ready: boolean };

export function App() {
  const [session, setSession] = useState<Session>({ operator: null, ready: false });

  useEffect(() => {
    api
      .me()
      .then((r) => setSession({ operator: r.operator, ready: true }))
      .catch(() => setSession({ operator: null, ready: true }));
  }, []);

  if (!session.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-white/40">
        载入中…
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<LoginPage session={session} setSession={setSession} />} />
      <Route
        path="/admin/*"
        element={
          session.operator?.role === "admin" ? (
            <AdminPage session={session} setSession={setSession} />
          ) : session.operator ? (
            <Navigate to="/app" replace />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/app/*"
        element={
          session.operator ? (
            <UserPage session={session} setSession={setSession} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
