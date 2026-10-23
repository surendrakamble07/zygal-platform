import type { ReactNode } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { useAuth, type Role } from "./auth/auth-context";
import Layout from "./components/Layout";
import ComingSoon from "./pages/ComingSoon";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import SitesPage from "./pages/SitesPage";

function Protected({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === "loading")
    return <div className="center muted">Loading...</div>;
  if (status === "signed_out") return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Convenience only: the database rules enforce who can really do what.
function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { profile } = useAuth();
  if (!profile || !roles.includes(profile.role))
    return <Navigate to="/" replace />;
  return <>{children}</>;
}

function LoginGate() {
  const { status } = useAuth();
  if (status === "loading")
    return <div className="center muted">Loading...</div>;
  return <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      {/* HashRouter works on GitHub Pages without server settings */}
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginGate />} />
          <Route
            element={
              <Protected>
                <Layout />
              </Protected>
            }
          >
            <Route index element={<HomePage />} />
            <Route path="sites" element={<SitesPage />} />
            <Route path="jobs" element={<ComingSoon title="Jobs" />} />
            <Route
              path="reports"
              element={
                <RoleGate roles={["team_lead", "admin"]}>
                  <ComingSoon title="Reports" />
                </RoleGate>
              }
            />
            <Route
              path="users"
              element={
                <RoleGate roles={["admin"]}>
                  <ComingSoon title="Users" />
                </RoleGate>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
