import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toast";
import { SessionProvider } from "@/lib/session";
import { AdminPage } from "@/pages/AdminPage";
import { DeveloperPage } from "@/pages/DeveloperPage";
import { HomePage } from "@/pages/HomePage";

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/*" element={<AdminPage />} />
          <Route path="/me" element={<DeveloperPage />} />
          <Route path="/me/*" element={<DeveloperPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </SessionProvider>
  );
}
