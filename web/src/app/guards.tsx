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

/** Requires a signed-in operator; the admin shell is shared by all three roles. */
export function RequireAdmin() {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === "loading") return <FullScreenLoader />;
  if (status === "guest") return <Navigate to="/" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

export function RequireRoles({ roles }: { roles: string[] }) {
  const { status, operator } = useAuth();
  if (status === "loading") return <FullScreenLoader />;
  const role = operator?.role ?? "";
  const ok = roles.includes(role) || (roles.includes("enterprise_admin") && (role === "org_admin" || role === "admin"));
  if (!ok) {
    return (
      <div className="p-8 text-sm text-destructive">
        403 此控制台不属于当前角色
      </div>
    );
  }
  return <Outlet />;
}
