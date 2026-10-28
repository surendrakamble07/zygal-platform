import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth, type Role } from "../auth/auth-context";
import {
  useDashboardStats,
  useProjectDashboard,
  type ProjectDashboardRow,
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
  Completed: "var(--zy-green)",
  Live: "var(--zy-green)",
  WIP: "var(--zy-blue)",
  "Partially Live": "var(--zy-orange)",
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

interface ProjectDashboard {
  project_id: string;
  project_name: string;
  total_sites: number;
  live_sites: number;
  pending_sites: number;
  handover_pending_sites: number;
  material_pending_sites: number;
  types: ProjectDashboardRow[];
}

function ProjectMetric({
  label,
  value,
  projectId,
}: {
  label: string;
  value: number;
  projectId: string;
}) {
  return (
    <Link
      className="project-metric project-metric-link"
      to={`/reports?projectId=${encodeURIComponent(projectId)}`}
    >
      <span className="project-metric-value">{value}</span>
      <span className="project-metric-label">{label}</span>
    </Link>
  );
}

function ProjectDashboardSection() {
  const projectDashboard = useProjectDashboard();
  const projects = useMemo(() => {
    const grouped = new Map<string, ProjectDashboard>();

    for (const row of projectDashboard.data ?? []) {
      if (row.total_sites < 1) continue;

      let project = grouped.get(row.project_id);
      if (!project) {
        project = {
          project_id: row.project_id,
          project_name: row.project_name,
          total_sites: 0,
          live_sites: 0,
          pending_sites: 0,
          handover_pending_sites: 0,
          material_pending_sites: 0,
          types: [],
        };
        grouped.set(row.project_id, project);
      }

      project.total_sites += row.total_sites;
      project.live_sites += row.live_sites;
      project.pending_sites += row.pending_sites;
      project.handover_pending_sites += row.handover_pending_sites;
      project.material_pending_sites += row.material_pending_sites;
      project.types.push(row);
    }

    return [...grouped.values()]
      .sort(
        (a, b) =>
          b.total_sites - a.total_sites ||
          a.project_name.localeCompare(b.project_name),
      )
      .map((project) => ({
        ...project,
        types: project.types.sort((a, b) =>
          a.project_type_name.localeCompare(b.project_type_name),
        ),
      }));
  }, [projectDashboard.data]);

  return (
    <section className="card project-dashboard">
      <h2>By project</h2>
      {projectDashboard.isError && (
        <div className="banner error">
          Could not load project dashboard data. Please refresh.
        </div>
      )}
      {projectDashboard.isLoading && (
        <p className="muted">Loading project dashboard...</p>
      )}
      {!projectDashboard.isLoading && !projectDashboard.isError && projects.length === 0 && (
        <p className="muted">No projects with sites to display.</p>
      )}
      {projects.length > 0 && (
        <div className="project-dashboard-grid">
          {projects.map((project) => (
            <article className="kpi project-dashboard-card" key={project.project_id}>
              <h3 className="project-dashboard-title">{project.project_name}</h3>
              <div className="project-metrics">
                <ProjectMetric
                  label="Total sites"
                  value={project.total_sites}
                  projectId={project.project_id}
                />
                <ProjectMetric
                  label="Live"
                  value={project.live_sites}
                  projectId={project.project_id}
                />
                <ProjectMetric
                  label="Pending"
                  value={project.pending_sites}
                  projectId={project.project_id}
                />
              </div>
              <div className="project-secondary-metrics">
                <div className="project-secondary-metric">
                  <span
                    className={
                      project.handover_pending_sites > 0
                        ? "project-secondary-value project-secondary-alert"
                        : "project-secondary-value"
                    }
                  >
                    {project.handover_pending_sites}
                  </span>
                  <span>Handover pending</span>
                </div>
                <div className="project-secondary-metric">
                  <span
                    className={
                      project.material_pending_sites > 0
                        ? "project-secondary-value project-secondary-alert"
                        : "project-secondary-value"
                    }
                  >
                    {project.material_pending_sites}
                  </span>
                  <span>Material pending</span>
                </div>
              </div>
              {project.types.length > 1 && (
                <details className="project-type-breakdown">
                  <summary>Break down by project type</summary>
                  <div className="project-type-list">
                    {project.types.map((type) => (
                      <div className="project-type-row" key={type.project_type_id}>
                        <span className="project-type-name">
                          {type.project_type_name}
                        </span>
                        <span>Total {type.total_sites}</span>
                        <span>Live {type.live_sites}</span>
                        <span>Pending {type.pending_sites}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default function HomePage() {
  const { profile } = useAuth();
  const stats = useDashboardStats();

  if (!profile) return null;

  const maxCount = Math.max(
    1,
    ...(stats.data?.byFinalStatus.map((s) => s.count) ?? [1]),
  );

  return (
    <>
      <section className="card">
        <h2>Welcome, {profile.full_name}</h2>
        <p className="muted">
          {ROLE_LABEL[profile.role]} · {profile.email}
        </p>
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
          <h3>This month by final status</h3>
          {stats.data && stats.data.byFinalStatus.length === 0 && (
            <div className="empty-state compact">
              <Icon name="empty" className="empty-state-icon" />
              <span>No jobs logged yet this month.</span>
            </div>
          )}
          <div className="bar-chart">
            {stats.data?.byFinalStatus.map((s) => (
              <div className="bar-row" key={s.name}>
                <span className="bar-label">{s.name}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${(s.count / maxCount) * 100}%`,
                      background: STATUS_COLORS[s.name] ?? "var(--zy-blue)",
                    }}
                  />
                </div>
                <span className="bar-count">{s.count}</span>
              </div>
            ))}
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
                {stats.data?.recentJobs.map((j) => (
                  <tr key={j.job_no}>
                    <td>
                      <Link to={`/jobs/${j.id}`}>#{j.job_no}</Link>
                    </td>
                    <td>{j.job_date}</td>
                    <td>{j.branch_code}</td>
                    <td>
                      <StatusBadge status={j.handover_status} />
                    </td>
                    <td>
                      <StatusBadge status={j.final_status} />
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

      <ProjectDashboardSection />
    </>
  );
}
