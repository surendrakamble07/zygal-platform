import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth, type Role } from "../auth/auth-context";
import { LogoMark } from "./Logo";
import Icon, { type IconName } from "./Icon";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  roles?: Role[]; // if set, only these roles see the link
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/sites", label: "Sites", icon: "sites" },
  { to: "/devices", label: "SIM Cards", icon: "devices" },
  { to: "/jobs", label: "Jobs", icon: "jobs" },
  {
    to: "/reports",
    label: "Reports",
    icon: "reports",
    roles: ["team_lead", "admin"],
  },
  { to: "/logs", label: "Logs", icon: "logs", roles: ["team_lead", "admin"] },
  { to: "/users", label: "Users", icon: "users", roles: ["admin"] },
];

const ROLE_LABEL: Record<Role, string> = {
  support: "Support",
  team_lead: "Team Lead",
  admin: "Admin",
};

export default function Layout() {
  const { profile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  if (!profile) return null;

  // Hiding a link is only a convenience. The database rules are the real protection.
  const items = NAV.filter((n) => !n.roles || n.roles.includes(profile.role));

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("zygal-theme", nextTheme);
    setTheme(nextTheme);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-brand">
          <LogoMark size={30} />
          <div>
            <div className="brand-word">ZYGAL</div>
            <span className="muted small">Team Operations</span>
          </div>
        </div>
        <div className="topbar-right">
          <span className="who">
            {profile.full_name}{" "}
            <span className="muted">· {ROLE_LABEL[profile.role]}</span>
          </span>
          <a
            href="/zygal-user-guide.pdf"
            target="_blank"
            rel="noopener"
            className="topbar-action guide-action"
          >
            <span className="topbar-action-icon guide-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h12v17H7a2.5 2.5 0 0 0-2.5 2z" />
                <path d="M4.5 5.5v16A2.5 2.5 0 0 1 7 19h12M9 7h6m-6 4h6" />
                <path d="m16 3 1 1 1-1" />
              </svg>
            </span>
            <span>User Guide</span>
            <svg className="topbar-action-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 12 12 4M5 4h7v7" />
            </svg>
          </a>
          <button
            className="secondary topbar-action theme-toggle"
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-pressed={theme === "dark"}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <svg
              aria-hidden="true"
              className="topbar-action-icon theme-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {theme === "dark" ? (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                  <circle cx="12" cy="12" r="9" strokeDasharray="1 3" />
                </>
              ) : (
                <>
                  <path d="M20.2 15.4A8.3 8.3 0 0 1 8.6 3.8 8.6 8.6 0 1 0 20.2 15.4Z" />
                  <path d="m16.5 4 .5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" />
                </>
              )}
            </svg>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            className="secondary topbar-action logout-action"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await signOut();
            }}
          >
            <span className="topbar-action-icon logout-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
                <path d="M3 12h12m-4-4 4 4-4 4" />
                <path d="M13 4v3m0 10v3" />
              </svg>
            </span>
            {busy ? "Signing out..." : "Log out"}
          </button>
        </div>
      </header>

      <div className="body">
        <nav className="sidebar" aria-label="Main">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon name={n.icon} size={18} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
