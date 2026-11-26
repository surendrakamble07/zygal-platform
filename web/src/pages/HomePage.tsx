import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import {
  currentMonthStart,
  useDashboardStats,
  useProjectDashboard,
} from "../lib/dashboard-queries";
import Icon, { type IconName } from "../components/Icon";
import Avatar from "../components/Avatar";
import { TableEmptyState, TableSkeleton } from "../components/TableStates";
import { supabase } from "../lib/supabase";

const STATUS_COLORS: Record<string, string> = {
  Completed: "var(--zy-blue)",
  Live: "var(--zy-green)",
  WIP: "var(--danger-text)",
  "Partially Live": "var(--purple-text)",
  Pending: "var(--err)",
  Other: "var(--muted)",
};

function kolkataDate() {
  const now = new Date();
  return {
    date: now.toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }),
    weekday: now.toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
    }),
  };
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextDay(dateValue: string): string {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return toDateInputValue(date);
}

function formatRangeLabel(start: string, day: string): string {
  if (day) {
    return new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return new Date(`${start}T00:00:00`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function KpiCard({
  label,
  value,
  icon,
  tone,
  to,
}: {
  label: string;
  value: number | string;
  icon: IconName;
  tone?: "blue" | "neutral" | "ok" | "warn" | "bad" | "purple" | "teal";
  to?: string;
}) {
  const content = (
    <>
      <div className="kpi-heading">
        <span className={`kpi-icon kpi-icon-${tone ?? "blue"}`}><Icon name={icon} size={20} /></span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-number">
        {value === "..." ? <span className="skeleton-bar kpi-skeleton" /> : value}
      </div>
    </>
  );
  const className = `kpi premium-kpi${to ? " kpi-clickable" : ""}`;
  return to ? <Link to={to} className={className}>{content}</Link> : <div className={className}>{content}</div>;
}

export default function HomePage() {
  const { profile } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState(() => currentMonthStart().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState("");
  const today = toDateInputValue(new Date());
  const currentMonth = currentMonthStart().slice(0, 7);
  const selectedRange = useMemo(() => {
    if (selectedDay) return { start: selectedDay, end: nextDay(selectedDay) };
    const monthStart = `${selectedMonth}-01`;
    const [year, month] = selectedMonth.split("-").map(Number);
    const nextMonth = new Date(year, month, 1);
    return { start: monthStart, end: toDateInputValue(nextMonth) };
  }, [selectedDay, selectedMonth]);
  const stats = useDashboardStats(selectedRange);
  const projectDashboard = useProjectDashboard();
  const activities = useQuery({
    queryKey: ["dashboard-activities"],
    queryFn: async () => {
      const [auditResult, sessionResult] = await Promise.all([
        supabase
          .from("audit_log")
          .select("id, table_name, action, old_data, new_data, changed_by, changed_at")
          .order("changed_at", { ascending: false })
          .limit(6),
        supabase
          .from("user_sessions")
          .select("id, user_id, started_at")
          .order("started_at", { ascending: false })
          .limit(6),
      ]);
      if (auditResult.error) throw auditResult.error;
      if (sessionResult.error) throw sessionResult.error;
      const personIds = new Set([
        ...(auditResult.data ?? []).map((row) => row.changed_by).filter((id): id is string => !!id),
        ...(sessionResult.data ?? []).map((row) => row.user_id),
      ]);
      const profilesResult = personIds.size
        ? await supabase.from("profiles").select("id, full_name").in("id", [...personIds])
        : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;
      const people = new Map(
        (profilesResult.data ?? []).map((row) => [row.id, row.full_name]),
      );
      const activityRows = [
        ...(auditResult.data ?? []).map((row) => ({
          id: `audit-${row.id}`,
          person: row.changed_by ? people.get(row.changed_by) ?? "Unknown" : "Unknown",
          message: `${row.action.toLowerCase()} ${String(row.table_name).replace(/_/g, " ")}`,
          timestamp: row.changed_at,
        })),
        ...(sessionResult.data ?? []).map((row) => ({
          id: `session-${row.id}`,
          person: people.get(row.user_id) ?? "Unknown",
          message: "logged in",
          timestamp: row.started_at,
        })),
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return { activities: activityRows.slice(0, 6) };
    },
    enabled: profile?.role === "team_lead" || profile?.role === "admin",
  });
  const rangeLabel = formatRangeLabel(selectedRange.start, selectedDay);
  const kolkata = kolkataDate();

  if (!profile) return null;

  const statusRows = stats.data?.byFinalStatus ?? [];
  const totalStatusCount = statusRows.reduce((total, row) => total + row.count, 0);
  const circumference = 2 * Math.PI * 48;
  const statusSegments = statusRows.map((row, index) => {
    const length = totalStatusCount ? (row.count / totalStatusCount) * circumference : 0;
    const offset = statusRows.slice(0, index).reduce(
      (total, previous) => total + (previous.count / totalStatusCount) * circumference,
      0,
    );
    return { ...row, length, offset };
  });
  const projects = [...(projectDashboard.data ?? [])].sort((a, b) =>
    b.total_sites - a.total_sites ||
    a.project_name.localeCompare(b.project_name),
  );
  const totalJobs = stats.data?.totalJobsThisMonth ?? 0;
  const completedJobs = statusRows.find((row) => row.name === "Completed")?.count ?? 0;
  const completionRate = totalJobs
    ? `${Math.round((completedJobs / totalJobs) * 100)}%`
    : "—";

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-eyebrow">Team Operations</p>
          <h1>Dashboard</h1>
          <p className="dashboard-welcome">Welcome back, <strong>{profile.full_name}</strong></p>
        </div>
        <div className="dashboard-header-actions">
          <div className="dashboard-date">
            <strong>{kolkata.weekday}</strong>
            <span>{kolkata.date} · Asia/Kolkata</span>
          </div>
          <button type="button" className="secondary dashboard-refresh" onClick={() => void stats.refetch()} disabled={stats.isFetching}>
            <Icon name="reports" size={17} />
            {stats.isFetching ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </header>

      <section className="dashboard-filter card" aria-label="Reporting period">
        <div className="dashboard-filter-fields">
          <label>Reporting month
            <input type="month" value={selectedMonth} max={currentMonth} onChange={(event) => {
              if (event.target.value && event.target.value <= currentMonth) {
                setSelectedMonth(event.target.value);
                setSelectedDay("");
              }
            }} />
          </label>
          <label>Specific day
            <input type="date" value={selectedDay} max={today} onChange={(event) => {
              if (event.target.value && event.target.value <= today) setSelectedDay(event.target.value);
            }} />
          </label>
          {selectedDay && <button type="button" className="secondary" onClick={() => setSelectedDay("")}>Clear day</button>}
        </div>
        <span className="reporting-period">Showing: <strong>{rangeLabel}</strong></span>
      </section>

      {stats.isError && <div className="banner error" role="alert">Could not load dashboard data. <button type="button" className="secondary" onClick={() => void stats.refetch()}>Retry</button></div>}

      <section className="dashboard-kpi-group" aria-labelledby="dashboard-overview-heading">
        <div className="dashboard-kpi-group-heading">
          <div>
            <p className="dashboard-eyebrow">Sites &amp; jobs</p>
            <h2 id="dashboard-overview-heading">Overview</h2>
          </div>
        </div>
        <div className="kpi-row premium-kpi-row" aria-label="Overview metrics">
          <KpiCard label="Active sites" value={stats.data?.activeSites ?? "..."} icon="building" tone="blue" to="/sites?status=Active" />
          <KpiCard label="Total Job" value={stats.data?.totalJobsThisMonth ?? "..."} icon="clipboard-list" tone="neutral" to="/jobs" />
          <KpiCard label="Total Live" value={stats.data?.completedThisMonth ?? "..."} icon="chart" tone="ok" to="/jobs" />
          <KpiCard label="Handover pending" value={stats.data?.pendingHandover ?? "..."} icon="clipboard-list" tone="warn" to="/jobs?handover=Pending" />
          <KpiCard label="Material Status" value={stats.data?.pendingMaterial ?? "..."} icon="smartphone" tone="bad" to="/reports?tab=hardware&pending=1" />
        </div>
      </section>
      <section className="dashboard-kpi-group" aria-labelledby="dashboard-people-heading">
        <div className="dashboard-kpi-group-heading">
          <div>
            <p className="dashboard-eyebrow">Workforce &amp; delivery</p>
            <h2 id="dashboard-people-heading">People &amp; Workload</h2>
          </div>
        </div>
        <div className="kpi-row premium-kpi-row" aria-label="People and workload metrics">
          <KpiCard label="Active Employees" value={stats.data?.activeEmployees ?? "..."} icon="users" tone="teal" to="/users" />
          <KpiCard label="Logged In Today" value={stats.data?.loggedInToday ?? "..."} icon="activity" tone="blue" />
          <KpiCard label="Jobs Today" value={stats.data?.jobsToday ?? "..."} icon="clipboard-list" tone="purple" to="/jobs" />
          <KpiCard label="Completion Rate" value={stats.isLoading ? "..." : completionRate} icon="chart" tone="ok" to="/jobs" />
          <KpiCard label="Pending Work" value={stats.data ? stats.data.pendingHandover + stats.data.pendingMaterial : "..."} icon="clipboard-list" tone="warn" to="/reports?tab=hardware&pending=1" />
        </div>
      </section>
      <section className="card quick-actions">
        <div className="section-heading"><div><p className="dashboard-eyebrow">Shortcuts</p><h2>Quick Actions</h2></div></div>
        <div className="quick-action-grid">
          <Link className="quick-action" to="/jobs"><span><Icon name="plus" /></span><strong>New Job</strong></Link>
          <Link className="quick-action" to="/sites"><span><Icon name="sites" /></span><strong>Add Site</strong></Link>
          {(profile.role === "team_lead" || profile.role === "admin") && (
            <Link className="quick-action" to="/reports"><span><Icon name="reports" /></span><strong>View Reports</strong></Link>
          )}
        </div>
      </section>

      <section className="dashboard-summary-grid">
        <section className="card today-summary">
          <div className="section-heading"><div><p className="dashboard-eyebrow">Operations</p><h2>Today’s Work Summary</h2></div></div>
          <div className="summary-rows">
            {[
              { label: "Jobs created today", count: stats.data?.jobsToday, icon: "clipboard-list" as IconName, to: "/jobs" },
              { label: "Jobs completed today", count: stats.data?.completedToday, icon: "chart" as IconName, to: "/jobs?finalStatus=Completed" },
              { label: "Live jobs today", count: stats.data?.liveToday, icon: "clipboard-list" as IconName, to: "/jobs?finalStatus=Live" },
              { label: "Pending jobs today", count: stats.data?.pendingToday, icon: "list" as IconName, to: "/jobs?finalStatus=Pending" },
            ].map((row) => (
              <Link className="summary-row" to={row.to} key={row.label}>
                <span className="summary-icon"><Icon name={row.icon} size={18} /></span>
                <span>{row.label}</span>
                <strong>{row.count ?? (stats.isLoading ? "..." : "—")}</strong>
              </Link>
            ))}
          </div>
        </section>

        <section className="card final-status-card">
          <div className="section-heading"><div><p className="dashboard-eyebrow">Reporting period</p><h2>Final Status Overview</h2></div><strong className="section-total">{totalStatusCount}</strong></div>
          {stats.data && statusRows.length === 0 ? (
            <div className="empty-state compact"><Icon name="empty" /><span>No jobs logged in this period.</span></div>
          ) : (
            <div className="status-donut-layout">
              <div className="status-donut-wrap">
                <svg className="status-donut" viewBox="0 0 120 120" role="img" aria-label={`Final status breakdown, ${totalStatusCount} jobs`}>
                  <circle className="status-donut-track" cx="60" cy="60" r="48" />
                  <g transform="rotate(-90 60 60)">
                    {statusSegments.map((segment) => (
                      <circle key={segment.name} className="status-donut-segment" cx="60" cy="60" r="48"
                        stroke={STATUS_COLORS[segment.name] ?? "var(--zy-blue)"}
                        strokeDasharray={`${segment.length} ${circumference - segment.length}`}
                        strokeDashoffset={-segment.offset} />
                    ))}
                  </g>
                </svg>
                <span className="status-donut-total">{totalStatusCount}<small>jobs</small></span>
              </div>
              <ul className="status-donut-legend">
                {statusRows.map((row) => (
                  <li key={row.name}>
                    <span className="status-donut-swatch" style={{ background: STATUS_COLORS[row.name] ?? "var(--zy-blue)" }} />
                    <span>{row.name}</span><strong>{row.count}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </section>

      {(profile.role === "team_lead" || profile.role === "admin") && (
        <section className="card recent-activity-card">
          <div className="section-heading">
            <div><p className="dashboard-eyebrow">Audit feed</p><h2>Recent Activities</h2></div>
            <Link className="link" to="/logs">View All →</Link>
          </div>
          {activities.isError ? (
            <div className="banner error">Could not load recent activities.</div>
          ) : activities.isPending ? (
            <div className="activity-skeleton">{[1, 2, 3].map((item) => <span className="skeleton-bar" key={item} />)}</div>
          ) : (activities.data?.activities.length ?? 0) === 0 ? (
            <div className="empty-state compact"><Icon name="empty" /><span>No recent activities.</span></div>
          ) : (
            <ol className="recent-activity-list">
              {activities.data?.activities.slice(0, 6).map((activity) => (
                <li key={activity.id}>
                  <Avatar name={activity.person} size={34} />
                  <div><strong>{activity.person}</strong><span>{activity.message.replace(`${activity.person} `, "")}</span></div>
                  <time dateTime={activity.timestamp}>{new Date(activity.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <section className="card projects-overview">
        <div className="section-heading">
          <div><p className="dashboard-eyebrow">Portfolio</p><h2>Projects Overview</h2></div>
          <span className="muted small">{projects.length} projects</span>
        </div>
        {projectDashboard.isError ? (
          <div className="banner error">Could not load project data. <button type="button" className="secondary" onClick={() => void projectDashboard.refetch()}>Retry</button></div>
        ) : (
          <div className="table-wrap projects-table-wrap">
            <table>
              <thead><tr><th>Project Name</th><th>Total Sites</th><th>Live</th><th>Pending</th><th>Handover Pending</th><th>Material Pending</th><th>Progress</th></tr></thead>
              <tbody>
                {projectDashboard.isLoading && <TableSkeleton columns={7} rows={5} />}
                {!projectDashboard.isLoading && projects.length === 0 && <TableEmptyState columns={7} message="No project data available." />}
                {projects.map((project) => {
                  const progress = project.total_sites ? Math.round((project.live_sites / project.total_sites) * 100) : 0;
                  return (
                    <tr key={project.project_id}>
                      <td><strong>{project.project_name}</strong><span className="project-type-subtitle">{project.project_type_name}</span></td>
                      <td>{project.total_sites}</td><td><span className="table-status live">{project.live_sites}</span></td>
                      <td>{project.pending_sites}</td><td>{project.handover_pending_sites}</td><td>{project.material_pending_sites}</td>
                      <td><div className="project-progress"><span><i style={{ width: `${progress}%` }} /></span><strong>{progress}%</strong></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
}
