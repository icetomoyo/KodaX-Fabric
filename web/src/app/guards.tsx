import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      载入中…
    </div>
  );
}

/** Requires any signed-in operator; otherwise bounce to login. */
export function RequireAuth() {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === "loading") return <FullScreenLoader />;
  if (status === "guest") return <Navigate to="/" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

/** Requires an admin; non-admins fall back to their workbench. */
export function RequireAdmin() {
  const { status, operator } = useAuth();
  const loc = useLocation();
  if (status === "loading") return <FullScreenLoader />;
  if (status === "guest") return <Navigate to="/" replace state={{ from: loc.pathname }} />;
  if (operator?.role !== "admin") return <Navigate to="/app" replace />;
  return <Outlet />;
}
