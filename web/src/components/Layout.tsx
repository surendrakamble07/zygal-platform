import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth, type Role } from "../auth/auth-context";

interface NavItem {
  to: string;
  label: string;
  roles?: Role[]; // if set, only these roles see the link
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard" },
  { to: "/sites", label: "Sites" },
  { to: "/jobs", label: "Jobs" },
  { to: "/reports", label: "Reports", roles: ["team_lead", "admin"] },
  { to: "/users", label: "Users", roles: ["admin"] },
];

const ROLE_LABEL: Record<Role, string> = {
  support: "Support",
  team_lead: "Team Lead",
  admin: "Admin",
};

export default function Layout() {
  const { profile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!profile) return null;

  // Hiding a link is only a convenience. The database rules are the real protection.
  const items = NAV.filter((n) => !n.roles || n.roles.includes(profile.role));

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <span className="brand small-brand">ZYGAL</span>
          <span className="muted">Team Operations</span>
        </div>
        <div className="topbar-right">
          <span className="who">
            {profile.full_name}{" "}
            <span className="muted">· {ROLE_LABEL[profile.role]}</span>
          </span>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await signOut();
            }}
          >
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
