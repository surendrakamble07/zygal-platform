import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth, type Role } from "../auth/auth-context";
import { LogoMark } from "./Logo";
import Icon, { type IconName } from "./Icon";
import { supabase } from "../lib/supabase";

type BreakType = "Lunch" | "Tea";

interface BreakEvent {
  id: string;
  user_id: string;
  break_type: BreakType;
  started_at: string;
  planned_minutes: number;
  ended_at: string | null;
}

const ACTIVE_BREAK_QUERY = "active-break";

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
  { to: "/notes", label: "My Notes", icon: "empty" },
  { to: "/my-activity", label: "My Activity", icon: "reports" },
  {
    to: "/reports",
    label: "Reports",
    icon: "reports",
    roles: ["team_lead", "admin"],
  },
  { to: "/logs", label: "Logs", icon: "logs", roles: ["team_lead", "admin"] },
  { to: "/users", label: "Users", icon: "users", roles: ["team_lead", "admin"] },
];

const ROLE_LABEL: Record<Role, string> = {
  support: "Support",
  team_lead: "Team Lead",
  admin: "Admin",
  other: "Limited",
};

export default function Layout() {
  const { profile, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  const [breakToStart, setBreakToStart] = useState<BreakType | null>(null);
  const [breakError, setBreakError] = useState("");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const activeBreakQuery = useQuery({
    queryKey: [ACTIVE_BREAK_QUERY, profile?.id],
    enabled: !!profile?.id,
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!profile?.id) throw new Error("Your profile is unavailable.");
      const { data, error } = await supabase
        .from("break_events")
        .select("id, user_id, break_type, started_at, planned_minutes, ended_at")
        .eq("user_id", profile.id)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as BreakEvent | null;
    },
  });
  const activeBreak = activeBreakQuery.data ?? null;
  const activeBreakId = activeBreak?.id;
  const startBreak = useMutation({
    mutationFn: async (breakType: BreakType) => {
      if (!profile?.id) throw new Error("Your profile is unavailable.");
      const { data: existingBreak, error: existingBreakError } = await supabase
        .from("break_events")
        .select("id")
        .eq("user_id", profile.id)
        .is("ended_at", null)
        .limit(1)
        .maybeSingle();
      if (existingBreakError) throw existingBreakError;
      if (existingBreak) throw new Error("You already have an active break.");

      const { data, error } = await supabase
        .from("break_events")
        .insert({
          user_id: profile.id,
          break_type: breakType,
          started_at: new Date().toISOString(),
          planned_minutes: breakType === "Lunch" ? 40 : 10,
        })
        .select("id, user_id, break_type, started_at, planned_minutes, ended_at")
        .single();
      if (error) throw error;
      return data as BreakEvent;
    },
    onSuccess: (event) => {
      setBreakError("");
      setBreakToStart(null);
      queryClient.setQueryData([ACTIVE_BREAK_QUERY, profile?.id], event);
      void queryClient.invalidateQueries({ queryKey: [ACTIVE_BREAK_QUERY, profile?.id] });
    },
    onError: (error) => {
      setBreakError(error instanceof Error ? error.message : "Could not start the break.");
      void queryClient.invalidateQueries({ queryKey: [ACTIVE_BREAK_QUERY, profile?.id] });
    },
  });
  const endBreak = useMutation({
    mutationFn: async (event: BreakEvent) => {
      if (!profile?.id) throw new Error("Your profile is unavailable.");
      const { data, error } = await supabase
        .from("break_events")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", event.id)
        .eq("user_id", profile.id)
        .is("ended_at", null)
        .select("id, user_id, break_type, started_at, planned_minutes, ended_at")
        .single();
      if (error) throw error;
      return data as BreakEvent;
    },
    onSuccess: () => {
      setBreakError("");
      queryClient.setQueryData([ACTIVE_BREAK_QUERY, profile?.id], null);
      void queryClient.invalidateQueries({ queryKey: [ACTIVE_BREAK_QUERY, profile?.id] });
    },
    onError: (error) => {
      setBreakError(error instanceof Error ? error.message : "Could not end the break.");
    },
  });

  useEffect(() => {
    if (!activeBreakId) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [activeBreakId]);

  if (!profile) return null;

  // Hiding a link is only a convenience. The database rules are the real protection.
  const items = NAV.filter((n) => {
    if (!n.roles || n.roles.includes(profile.role)) return true;
    if (profile.role === 'other') {
      const pageKey = n.to.replace(/^\//, '').replace(/\/$/, '') || 'dashboard';
      const allowed = profile.allowed_pages ?? [];
      return allowed.includes(pageKey);
    }
    return false;
  });
  const breakMinutesLeft = activeBreak
    ? Math.ceil(
        (new Date(activeBreak.started_at).getTime()
          + activeBreak.planned_minutes * 60_000
          - clockNow) / 60_000,
      )
    : null;

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
            href={`${import.meta.env.BASE_URL}ZYGAL_User_Guide.pdf`}
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
          {activeBreak ? (
            <>
              <span
                className={`break-indicator${breakMinutesLeft !== null && breakMinutesLeft <= 0 ? " overdue" : ""}`}
                role="status"
              >
                {activeBreak.break_type}: {breakMinutesLeft !== null && breakMinutesLeft <= 0
                  ? "overdue"
                  : `${breakMinutesLeft}m left`}
              </span>
              <button
                type="button"
                className="secondary topbar-action"
                disabled={endBreak.isPending}
                onClick={() => endBreak.mutate(activeBreak)}
              >
                {endBreak.isPending ? "Ending..." : "End break"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="secondary topbar-action"
                disabled={activeBreakQuery.isLoading || activeBreakQuery.isError || startBreak.isPending}
                onClick={() => {
                  setBreakError("");
                  setBreakToStart("Lunch");
                }}
              >
                Lunch Break
              </button>
              <button
                type="button"
                className="secondary topbar-action"
                disabled={activeBreakQuery.isLoading || activeBreakQuery.isError || startBreak.isPending}
                onClick={() => {
                  setBreakError("");
                  setBreakToStart("Tea");
                }}
              >
                Tea Break
              </button>
            </>
          )}
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

      {breakError && !breakToStart && (
        <div className="break-error" role="alert">{breakError}</div>
      )}
      {activeBreakQuery.isError && (
        <div className="break-error" role="alert">Could not load your break status.</div>
      )}
      {breakToStart && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && setBreakToStart(null)}
        >
          <section className="modal break-confirmation" role="dialog" aria-modal="true" aria-labelledby="break-confirmation-title">
            <h2 id="break-confirmation-title">Start a {breakToStart.toLowerCase()} break?</h2>
            <p>
              Start your {breakToStart === "Lunch" ? "40-minute lunch" : "10-minute tea"} break?
            </p>
            {breakError && <div className="banner error" role="alert">{breakError}</div>}
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={startBreak.isPending}
                onClick={() => {
                  setBreakToStart(null);
                  setBreakError("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={startBreak.isPending}
                onClick={() => startBreak.mutate(breakToStart)}
              >
                {startBreak.isPending ? "Starting..." : "Confirm"}
              </button>
            </div>
          </section>
        </div>
      )}

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
