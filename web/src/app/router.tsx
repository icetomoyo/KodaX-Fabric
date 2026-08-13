import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAdmin, RequireAuth } from "./guards";
import { LoginPage } from "@/features/auth/login-page";

const AdminLayout = lazy(() => import("@/features/admin/admin-layout"));
const OverviewPage = lazy(() => import("@/features/admin/overview/page"));
const UsersPage = lazy(() => import("@/features/admin/users/page"));
const ProvidersPage = lazy(() => import("@/features/admin/providers/page"));
const PoolsPage = lazy(() => import("@/features/admin/pools/page"));
const ChannelsPage = lazy(() => import("@/features/admin/channels/page"));
const KeysPage = lazy(() => import("@/features/admin/keys/page"));
const OrgPage = lazy(() => import("@/features/admin/org/page"));
const AuditPage = lazy(() => import("@/features/admin/audit/page"));
const UserPage = lazy(() => import("@/features/user/user-page"));

function ChunkLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      载入中…
    </div>
  );
}

export function AppRouter() {
  return (
    <Suspense fallback={<ChunkLoader />}>
      <Routes>
        <Route path="/" element={<LoginPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/app" element={<UserPage />} />
        </Route>

        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/overview" replace />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="providers" element={<ProvidersPage />} />
            <Route path="pools" element={<PoolsPage />} />
            <Route path="channels" element={<ChannelsPage />} />
            <Route path="keys" element={<KeysPage />} />
            <Route path="org" element={<OrgPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
