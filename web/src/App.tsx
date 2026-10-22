import type { ReactNode } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { useAuth } from "./auth/auth-context";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";

function Protected({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === "loading")
    return <div className="center muted">Loading...</div>;
  if (status === "signed_out") return <Navigate to="/login" replace />;
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
            path="/"
            element={
              <Protected>
                <HomePage />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
