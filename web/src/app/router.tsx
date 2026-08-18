import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAdmin, RequireRoles } from "./guards";
import { LoginPage } from "@/features/auth/login-page";
import { useAuth } from "@/lib/auth";
import { homeFor } from "@/lib/consoles";

const AdminLayout = lazy(() => import("@/features/admin/admin-layout"));
const OverviewPage = lazy(() => import("@/features/admin/overview/page"));
const ProvidersPage = lazy(() => import("@/features/admin/providers/page"));
const ModelsPage = lazy(() => import("@/features/admin/models/page"));
const KeysPage = lazy(() => import("@/features/admin/keys/page"));
const ProjectsPage = lazy(() => import("@/features/admin/projects/page"));
const PricesPage = lazy(() => import("@/features/admin/prices/page"));
const DocsPage = lazy(() => import("@/features/admin/docs/page"));
const RequestsPage = lazy(() => import("@/features/admin/requests/page"));
const MembersPage = lazy(() => import("@/features/admin/members/page"));

function ChunkLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      载入中…
    </div>
  );
}

function RoleHome() {
  const { operator } = useAuth();
  return <Navigate to={homeFor(operator?.role)} replace />;
}

function sharedLedgerRoutes() {
  return (
    <>
      <Route index element={<Navigate to="overview" replace />} />
      <Route path="overview" element={<OverviewPage />} />
      <Route path="requests" element={<RequestsPage />} />
      <Route path="keys" element={<KeysPage />} />
    </>
  );
}

export function AppRouter() {
  return (
    <Suspense fallback={<ChunkLoader />}>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<RoleHome />} />
          <Route path="/admin/*" element={<RoleHome />} />
          <Route element={<RequireRoles roles={["super_admin"]} />}>
            <Route path="/platform" element={<AdminLayout />}>
              {sharedLedgerRoutes()}
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="providers" element={<ProvidersPage />} />
              <Route path="models" element={<ModelsPage />} />
              <Route path="prices" element={<PricesPage />} />
              <Route path="docs" element={<DocsPage />} />
            </Route>
          </Route>
          <Route element={<RequireRoles roles={["enterprise_admin"]} />}>
            <Route path="/enterprise" element={<AdminLayout />}>
              {sharedLedgerRoutes()}
              <Route path="projects" element={<ProjectsPage />} />
            </Route>
          </Route>
          <Route element={<RequireRoles roles={["team_admin", "developer"]} />}>
            <Route path="/team" element={<AdminLayout />}>
              {sharedLedgerRoutes()}
              <Route path="members" element={<MembersPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
