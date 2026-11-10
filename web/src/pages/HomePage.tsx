import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth, type Role } from "../auth/auth-context";
import {
  currentMonthStart,
  useDashboardStats,
  useProjectMonthBreakdown,
} from "../lib/dashboard-queries";
import Icon, { type IconName } from "../components/Icon";
import StatusBadge from "../components/StatusBadge";
import { TableEmptyState, TableSkeleton } from "../components/TableStates";

const ROLE_LABEL: Record<Role, string> = {
  support: "Support",
  team_lead: "Team Lead / Assistant Manager",
  admin: "Admin",
};

const STATUS_COLORS: Record<string, string> = {
  Completed: "var(--zy-blue)",
  Live: "var(--zy-green)",
  WIP: "#ff0000",
  "Partially Live": "#8b5cf6",
  Pending: "var(--err)",
  Other: "var(--muted)",
};

function KpiCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number | string;
  tone?: "ok" | "warn" | "bad";
  icon: IconName;
}) {
  return (
    <div className={`kpi kpi-${tone ?? "plain"}`}>
      <div className="kpi-heading">
        <span className="kpi-icon">
          <Icon name={icon} size={20} />
        </span>
        <div className="kpi-label">{label}</div>
      </div>
      <div className="kpi-number">
        {value === "..." ? (
          <span className="skeleton-bar kpi-skeleton" />
        ) : (
          value
        )}
      </div>
    </div>
  );
}

interface ProjectMonthDashboard {
  project_name: string;
  project_type_name: string;
  job_count: number;
  statuses: { name: string; count: number }[];
}

function ProjectMonthDashboardSection({ monthStart }: { monthStart: string }) {
  const projectDashboard = useProjectMonthBreakdown(monthStart);
  const projects = useMemo(() => {
    const grouped = new Map<string, ProjectMonthDashboard>();

    for (const row of projectDashboard.data ?? []) {
      const projectKey = `${row.project_name}\u0000${row.project_type_name}`;
      let project = grouped.get(projectKey);
      if (!project) {
        project = {
          project_name: row.project_name,
          project_type_name: row.project_type_name,
          job_count: 0,
          statuses: [],
        };
        grouped.set(projectKey, project);
      }

      project.job_count += row.job_count;
      project.statuses.push({ name: row.final_status, count: row.job_count });
    }

    return [...grouped.values()].sort(
      (a, b) =>
        b.job_count - a.job_count ||
        a.project_name.localeCompare(b.project_name),
    );
  }, [projectDashboard.data]);

  return (
    <section className="card project-dashboard">
      <h2>By project · jobs logged</h2>
      {projectDashboard.isError && (
        <div className="banner error">
          Could not load project job breakdown. Please refresh.
        </div>
      )}
      {projectDashboard.isLoading && (
        <p className="muted">Loading project job breakdown...</p>
      )}
      {!projectDashboard.isLoading &&
        !projectDashboard.isError &&
        projects.length === 0 && (
          <p className="muted">No jobs logged in this month.</p>
        )}
      {projects.length > 0 && (
        <div className="project-dashboard-grid">
          {projects.map((project) => (
            <article
              className="kpi project-dashboard-card"
              key={`${project.project_name}-${project.project_type_name}`}
            >
              <h3 className="project-dashboard-title">
                {project.project_name}
              </h3>
              <span className="project-month-type">
                {project.project_type_name}
              </span>
              <strong className="project-month-total">
                {project.job_count}{" "}
                {project.job_count === 1 ? "job" : "jobs"} logged
              </strong>
              <div className="project-month-statuses">
                {project.statuses.map((status) => (
                  <div className="project-month-status" key={status.name}>
                    <span
                      className="project-month-status-swatch"
                      style={{
                        background:
                          STATUS_COLORS[status.name] ?? "var(--zy-blue)",
                      }}
                      aria-hidden="true"
                    />
                    <span>{status.name}</span>
                    <strong>{status.count}</strong>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default function HomePage() {
  const { profile } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState(() =>
    currentMonthStart().slice(0, 7),
  );
  const monthStart = `${selectedMonth}-01`;
  const currentMonth = currentMonthStart().slice(0, 7);
  const stats = useDashboardStats(monthStart);

  if (!profile) return null;

  const statusRows = stats.data?.byFinalStatus ?? [];
  const totalStatusCount = statusRows.reduce(
    (total, row) => total + row.count,
    0,
  );
  const circumference = 2 * Math.PI * 48;
  const statusSegments = statusRows.map((row, index) => {
    const length = totalStatusCount
      ? (row.count / totalStatusCount) * circumference
      : 0;
    const offset = statusRows
      .slice(0, index)
      .reduce(
        (total, previous) =>
          total + (previous.count / totalStatusCount) * circumference,
        0,
      );
    return { ...row, length, offset };
  });
  const displayedMonth = new Date(`${monthStart}T00:00:00Z`).toLocaleString(
    undefined,
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  return (
    <>
      <section className="card">
        <h2>Welcome, {profile.full_name}</h2>
        <p className="muted">
          {ROLE_LABEL[profile.role]} · {profile.email}
        </p>
      </section>

      <section className="card dashboard-month-picker">
        <label>
          Dashboard month
          <input
            type="month"
            value={selectedMonth}
            max={currentMonth}
            onChange={(event) => {
              if (event.target.value && event.target.value <= currentMonth) {
                setSelectedMonth(event.target.value);
              }
            }}
          />
        </label>
      </section>

      {stats.isError && (
        <div className="banner error">
          Could not load the dashboard. Please refresh.
        </div>
      )}

      <div className="kpi-row">
        <KpiCard
          label="Active sites"
          value={stats.data?.activeSites ?? "..."}
          icon="sites"
        />
        <KpiCard
          label="Jobs this month"
          value={stats.data?.totalJobsThisMonth ?? "..."}
          icon="jobs"
        />
        <KpiCard
          label="Completed this month"
          value={stats.data?.completedThisMonth ?? "..."}
          tone="ok"
          icon="reports"
        />
        <KpiCard
          label="Handover pending"
          value={stats.data?.pendingHandover ?? "..."}
          tone="warn"
          icon="jobs"
        />
        <KpiCard
          label="Material pending"
          value={stats.data?.pendingMaterial ?? "..."}
          tone="bad"
          icon="devices"
        />
      </div>

      <div className="two-col">
        <section className="card">
          <h3>{displayedMonth} by final status</h3>
          {stats.data && stats.data.byFinalStatus.length === 0 && (
            <div className="empty-state compact">
              <Icon name="empty" className="empty-state-icon" />
              <span>No jobs logged in this month.</span>
            </div>
          )}
          <div className="status-donut-layout">
            <div className="status-donut-wrap">
              <svg
                className="status-donut"
                viewBox="0 0 120 120"
                role="img"
                aria-label={`Final status breakdown, ${totalStatusCount} jobs`}
              >
                <circle className="status-donut-track" cx="60" cy="60" r="48" />
                <g transform="rotate(-90 60 60)">
                  {statusSegments.map((segment) => (
                    <circle
                      key={segment.name}
                      className="status-donut-segment"
                      cx="60"
                      cy="60"
                      r="48"
                      stroke={STATUS_COLORS[segment.name] ?? "var(--zy-blue)"}
                      strokeDasharray={`${segment.length} ${circumference - segment.length}`}
                      strokeDashoffset={-segment.offset}
                    />
                  ))}
                </g>
              </svg>
              <span className="status-donut-total" aria-hidden="true">
                {totalStatusCount}
              </span>
            </div>
            <ul className="status-donut-legend">
              {statusRows.map((row) => (
                <li key={row.name}>
                  <span
                    className="status-donut-swatch"
                    style={{
                      background: STATUS_COLORS[row.name] ?? "var(--zy-blue)",
                    }}
                    aria-hidden="true"
                  />
                  <span>{row.name}</span>
                  <strong>{row.count}</strong>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="card">
          <h3>Recent jobs</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job #</th>
                  <th>Date</th>
                  <th>Branch</th>
                  <th>Handover</th>
                  <th>Final status</th>
                </tr>
              </thead>
              <tbody>
                {stats.isLoading && <TableSkeleton columns={5} rows={3} />}
                {!stats.isLoading && stats.data?.recentJobs.length === 0 && (
                  <TableEmptyState columns={5} message="No recent jobs yet." />
                )}
                {stats.data?.recentJobs.map((job) => (
                  <tr key={job.job_no}>
                    <td>
                      <Link to={`/jobs/${job.id}`}>#{job.job_no}</Link>
                    </td>
                    <td>{job.job_date}</td>
                    <td>{job.branch_code}</td>
                    <td>
                      <StatusBadge status={job.handover_status} />
                    </td>
                    <td>
                      <StatusBadge status={job.final_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link to="/jobs" className="link">
            View all jobs →
          </Link>
        </section>
      </div>

      <ProjectMonthDashboardSection monthStart={monthStart} />
    </>
  );
}
