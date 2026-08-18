import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAdmin } from "./guards";
import { LoginPage } from "@/features/auth/login-page";

const AdminLayout = lazy(() => import("@/features/admin/admin-layout"));
const OverviewPage = lazy(() => import("@/features/admin/overview/page"));
const ProvidersPage = lazy(() => import("@/features/admin/providers/page"));
const ModelsPage = lazy(() => import("@/features/admin/models/page"));
const KeysPage = lazy(() => import("@/features/admin/keys/page"));
const ProjectsPage = lazy(() => import("@/features/admin/projects/page"));
const PricesPage = lazy(() => import("@/features/admin/prices/page"));
const DocsPage = lazy(() => import("@/features/admin/docs/page"));

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
        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/overview" replace />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="keys" element={<KeysPage />} />
            <Route path="providers" element={<ProvidersPage />} />
            <Route path="models" element={<ModelsPage />} />
            <Route path="prices" element={<PricesPage />} />
            <Route path="docs" element={<DocsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
