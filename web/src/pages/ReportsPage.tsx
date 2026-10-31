import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { WorkBook } from 'xlsx'
import { useAuth } from '../auth/auth-context'
import { useProjects, useStates } from '../lib/queries'
import { useEmployees, useFinalStatuses } from '../lib/job-queries'
import { fetchProjectDashboard, type ProjectDashboardRow } from '../lib/dashboard-queries'
import {
  fetchEmployeeProductivity,
  fetchJobReportForExport,
  fetchMaterialReport,
  JOB_REPORT_EXPORT_HEADERS,
  useEmployeeProductivity,
  useJobReport,
  useMaterialReport,
  type ReportFilters,
} from '../lib/report-queries'
import { downloadCsv } from '../lib/csv'
import StatusBadge from '../components/StatusBadge'
import Avatar from '../components/Avatar'
import Pagination from '../components/Pagination'
import { TableEmptyState, TableSkeleton } from '../components/TableStates'

const PAGE_SIZE = 25
const EMPTY_FILTERS: ReportFilters = {
  dateFrom: '',
  dateTo: '',
  projectId: '',
  stateName: '',
  employeeId: '',
  finalStatus: '',
  branchCode: '',
}

type Tab = 'jobs' | 'hardware' | 'productivity'

function currentMonthRange() {
  const today = new Date()
  const toDateInput = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return {
    from: toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: toDateInput(today),
  }
}

type ReportCell = string | number | boolean | null | undefined

function appendReportSheet(
  xlsx: typeof import('xlsx'),
  workbook: WorkBook,
  name: string,
  title: string,
  subtitle: string,
  headers: readonly string[],
  rows: ReportCell[][],
) {
  const sheet = xlsx.utils.aoa_to_sheet([[title], [subtitle], [], [...headers], ...rows])
  xlsx.utils.book_append_sheet(workbook, sheet, name)
}

function summarizeProjects(rows: ProjectDashboardRow[]) {
  const grouped = new Map<string, {
    project_name: string
    total_sites: number
    live_sites: number
    pending_sites: number
    handover_pending_sites: number
    material_pending_sites: number
  }>()

  for (const row of rows) {
    if (row.total_sites < 1) continue
    let project = grouped.get(row.project_id)
    if (!project) {
      project = {
        project_name: row.project_name,
        total_sites: 0,
        live_sites: 0,
        pending_sites: 0,
        handover_pending_sites: 0,
        material_pending_sites: 0,
      }
      grouped.set(row.project_id, project)
    }
    project.total_sites += row.total_sites
    project.live_sites += row.live_sites
    project.pending_sites += row.pending_sites
    project.handover_pending_sites += row.handover_pending_sites
    project.material_pending_sites += row.material_pending_sites
  }

  return [...grouped.values()].sort(
    (a, b) => b.total_sites - a.total_sites || a.project_name.localeCompare(b.project_name),
  )
}

function formatExportDate(date: Date): string {
  const month = date.toLocaleString('en', { month: 'short' })
  const day = String(date.getDate()).padStart(2, '0')
  const year = date.getFullYear()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day}-${month}-${year} ${hours}:${minutes}`
}

function localDateStamp(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('jobs')
  const [searchParams] = useSearchParams()
  const { profile } = useAuth()
  const [jobFilters, setJobFilters] = useState<ReportFilters>(() => ({
    ...EMPTY_FILTERS,
    projectId: searchParams.get('projectId') ?? '',
  }))
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportNote, setExportNote] = useState('')
  const canExport = profile?.role === 'admin' || profile?.role === 'team_lead'

  async function exportFullReport() {
    if (!profile) {
      setExportError('Could not prepare the full report: your user profile is unavailable.')
      return
    }
    setExporting(true)
    setExportError('')
    setExportNote('')
    try {
      const [projectRows, jobExport, materialRows, employeeRows] = await Promise.all([
        fetchProjectDashboard(),
        fetchJobReportForExport(jobFilters),
        fetchMaterialReport({
          dateFrom: jobFilters.dateFrom,
          dateTo: jobFilters.dateTo,
          projectId: jobFilters.projectId,
          stateName: jobFilters.stateName,
        }, false),
        fetchEmployeeProductivity(jobFilters.dateFrom, jobFilters.dateTo),
      ])
      const XLSX = await import('xlsx')
      const exportedAt = formatExportDate(new Date())
      const title = 'ZYGAL Team Operations — Full Report'
      const subtitle = `Exported by ${profile.full_name} on ${exportedAt}`
      const workbook = XLSX.utils.book_new()
      const summary = summarizeProjects(projectRows)
      const summaryHeaders = ['Project', 'Total Sites', 'Live', 'Pending', 'Handover Pending', 'Material Pending']
      appendReportSheet(XLSX, workbook, 'Summary', title, subtitle, summaryHeaders, summary.map((project) => [
        project.project_name,
        project.total_sites,
        project.live_sites,
        project.pending_sites,
        project.handover_pending_sites,
        project.material_pending_sites,
      ]))
      appendReportSheet(
        XLSX,
        workbook,
        'Jobs',
        title,
        subtitle,
        JOB_REPORT_EXPORT_HEADERS,
        jobExport.rows.map((row) => JOB_REPORT_EXPORT_HEADERS.map((header) => row[header])),
      )
      appendReportSheet(XLSX, workbook, 'Material Issues', title, subtitle,
        ['Job #', 'Date', 'Branch', 'Item', 'Problem', 'Quantity', 'Status'],
        materialRows.map((row) => [row.job_no, row.job_date, row.branch_code, row.item, row.problem, row.quantity, row.status]))
      appendReportSheet(XLSX, workbook, 'Employee Productivity', title, subtitle,
        ['Full Name', 'Role', 'Account Status', 'Jobs Created', 'Jobs Completed / Live', 'Active Time', 'Login Days'],
        employeeRows.map((row) => [
          row.full_name,
          row.role.replace(/_/g, ' '),
          row.is_active ? 'Active' : 'Inactive',
          row.jobs_created,
          row.completed_jobs,
          row.active_time,
          row.login_days,
        ]))
      XLSX.writeFile(workbook, `zygal-full-report-${localDateStamp(new Date())}.xlsx`)
      if (jobExport.truncated) {
        setExportNote('The Jobs sheet is limited to the first 5,000 matching rows. Narrow the Job data filters for a complete export.')
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error)
      setExportError(`Could not prepare the full report: ${details}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="card">
      <div className="head-row">
        <h2>Reports</h2>
        {canExport && (
          <button className="secondary" onClick={exportFullReport} disabled={exporting}>
            {exporting ? 'Preparing report...' : 'Export full report (Excel)'}
          </button>
        )}
      </div>
      {exportError && <div className="banner error" role="alert">{exportError}</div>}
      {exportNote && <div className="banner warn">{exportNote}</div>}
      <div className="tab-row">
        <button className={tab === 'jobs' ? 'tab active' : 'tab'} onClick={() => setTab('jobs')}>
          Job data
        </button>
        <button className={tab === 'hardware' ? 'tab active' : 'tab'} onClick={() => setTab('hardware')}>
          Hardware
        </button>
        <button className={tab === 'productivity' ? 'tab active' : 'tab'} onClick={() => setTab('productivity')}>
          Productivity
        </button>
      </div>

      {tab === 'jobs' && <JobReportTab filters={jobFilters} onFiltersChange={setJobFilters} />}
      {tab === 'hardware' && <HardwareReportTab />}
      {tab === 'productivity' && <EmployeeProductivityTab />}
    </section>
  )
}

type JobReportTabProps = {
  filters: ReportFilters
  onFiltersChange: (filters: ReportFilters) => void
}

function JobReportTab({ filters, onFiltersChange }: JobReportTabProps) {
  const projects = useProjects()
  const states = useStates()
  const employees = useEmployees()
  const finalStatuses = useFinalStatuses()

  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState('')

  const report = useJobReport(filters, page, PAGE_SIZE)
  const rows = report.data?.rows ?? []
  const total = report.data?.total ?? 0
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1
  const last = Math.min((page + 1) * PAGE_SIZE, total)

  function setFilter<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    onFiltersChange({ ...filters, [key]: value })
    setPage(0)
  }

  async function exportCsv() {
    setExporting(true)
    setExportNote('')
    try {
      const { rows: all, truncated } = await fetchJobReportForExport(filters)
      downloadCsv(`zygal-jobs-${new Date().toISOString().slice(0, 10)}.csv`, all)
      if (truncated) setExportNote('Only the first 5,000 matching rows were exported. Narrow the filters for a complete file.')
    } catch {
      setExportNote('Could not export the report. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="filters">
        <label className="date-field">
          From
          <input type="date" value={filters.dateFrom} onChange={(e) => setFilter('dateFrom', e.target.value)} />
        </label>
        <label className="date-field">
          To
          <input type="date" value={filters.dateTo} onChange={(e) => setFilter('dateTo', e.target.value)} />
        </label>
        <input
          placeholder="Branch code contains..."
          value={filters.branchCode}
          onChange={(e) => setFilter('branchCode', e.target.value)}
        />
        <select value={filters.projectId} onChange={(e) => setFilter('projectId', e.target.value)}>
          <option value="">All projects</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select value={filters.stateName} onChange={(e) => setFilter('stateName', e.target.value)}>
          <option value="">All states</option>
          {(states.data ?? []).map((s) => (
            <option key={s.name} value={s.name}>{s.name}</option>
          ))}
        </select>
        <select value={filters.employeeId} onChange={(e) => setFilter('employeeId', e.target.value)}>
          <option value="">All employees</option>
          {(employees.data ?? []).map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.full_name}{employee.is_active ? '' : ' (Inactive)'}
            </option>
          ))}
        </select>
        <select value={filters.finalStatus} onChange={(e) => setFilter('finalStatus', e.target.value)}>
          <option value="">Any final status</option>
          {(finalStatuses.data ?? []).map((f) => (
            <option key={f.name} value={f.name}>{f.name}</option>
          ))}
        </select>
      </div>

      <div className="head-row">
        <span className="muted small">{total === 0 ? 'No matching records' : `Showing ${first}-${last} of ${total}`}</span>
        <button className="secondary" onClick={exportCsv} disabled={exporting || total === 0}>
          {exporting ? 'Preparing CSV...' : 'Export to CSV'}
        </button>
      </div>
      {exportNote && <div className="banner warn">{exportNote}</div>}
      {report.isError && <div className="banner error">Could not load the report. Please refresh and try again.</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Job #</th><th>Date</th><th>Call type</th><th>Branch</th><th>Project</th>
              <th>State</th><th>Engineer</th><th>Handover</th><th>Final status</th><th>Minor</th>
            </tr>
          </thead>
          <tbody>
            {report.isLoading && <TableSkeleton columns={10} />}
            {!report.isLoading && rows.length === 0 && <TableEmptyState columns={10} message="No jobs match these filters." />}
            {rows.map((r) => (
              <tr key={r.job_no}>
                <td>#{r.job_no}</td>
                <td>{r.job_date}</td>
                <td>{r.call_type}</td>
                <td>{r.branch_code}</td>
                <td>{r.project_name}</td>
                <td>{r.state ?? '-'}</td>
                <td>{r.engineer_name
                  ? <span className="person-cell"><Avatar name={r.engineer_name} />{r.engineer_name}</span>
                  : 'Not assigned'}</td>
                <td><StatusBadge status={r.handover_status} /></td>
                <td><StatusBadge status={r.final_status} /></td>
                <td>{r.has_minor_issue ? 'Yes' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination currentPage={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} disabled={report.isFetching} itemLabel="jobs" />
    </>
  )
}

function HardwareReportTab() {
  const projects = useProjects()
  const states = useStates()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [projectId, setProjectId] = useState('')
  const [stateName, setStateName] = useState('')
  const [pendingOnly, setPendingOnly] = useState(true)

  const report = useMaterialReport({ dateFrom, dateTo, projectId, stateName }, pendingOnly)
  const rows = report.data ?? []

  return (
    <>
      <div className="filters">
        <label className="date-field">From<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
        <label className="date-field">To<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={stateName} onChange={(e) => setStateName(e.target.value)}>
          <option value="">All states</option>
          {(states.data ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <select value={pendingOnly ? 'pending' : 'all'} onChange={(e) => setPendingOnly(e.target.value === 'pending')}>
          <option value="pending">Pending only</option>
          <option value="all">Pending and resolved</option>
        </select>
      </div>

      <div className="head-row">
        <span className="muted small">{rows.length} issue{rows.length === 1 ? '' : 's'}</span>
        <button
          className="secondary"
          disabled={rows.length === 0}
          onClick={() => downloadCsv(`zygal-hardware-${new Date().toISOString().slice(0, 10)}.csv`, rows)}
        >
          Export to CSV
        </button>
      </div>
      {report.isError && <div className="banner error">Could not load the report. Please refresh and try again.</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Job #</th><th>Date</th><th>Branch</th><th>Item</th><th>Problem</th><th className="numeric">Qty</th><th>Status</th></tr>
          </thead>
          <tbody>
            {report.isLoading && <TableSkeleton columns={7} />}
            {!report.isLoading && rows.length === 0 && <TableEmptyState columns={7} message="No matching material issues." />}
            {rows.map((r, i) => (
              <tr key={i}>
                <td>#{r.job_no}</td><td>{r.job_date}</td><td>{r.branch_code}</td>
                <td>{r.item}</td><td>{r.problem}</td><td className="numeric">{r.quantity}</td><td><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function EmployeeProductivityTab() {
  const currentMonth = currentMonthRange()
  const [dateFrom, setDateFrom] = useState(currentMonth.from)
  const [dateTo, setDateTo] = useState(currentMonth.to)
  const report = useEmployeeProductivity(dateFrom, dateTo)
  const rows = report.data ?? []

  function exportCsv() {
    const exportRows = rows.map((row) => ({
      'Full Name': row.full_name,
      Role: row.role.replace(/_/g, ' '),
      'Account Status': row.is_active ? 'Active' : 'Inactive',
      'Jobs Created': row.jobs_created,
      'Jobs Completed / Live': row.completed_jobs,
      'Active Time': row.active_time,
      'Login Days': row.login_days,
    }))
    downloadCsv(`zygal-employee-productivity-${new Date().toISOString().slice(0, 10)}.csv`, exportRows)
  }

  return (
    <>
      <div className="filters">
        <label className="date-field">From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label className="date-field">To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      </div>

      <div className="head-row">
        <span className="muted small">{rows.length} employee{rows.length === 1 ? '' : 's'}</span>
        <button className="secondary" disabled={rows.length === 0} onClick={exportCsv}>
          Export to CSV
        </button>
      </div>
      {report.isError && <div className="banner error">Could not load employee productivity. Please refresh and try again.</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th><th>Role</th><th>Account status</th>
              <th className="numeric">Jobs created</th><th className="numeric">Jobs completed / live</th>
              <th className="numeric">Active time</th><th className="numeric">Login days</th>
            </tr>
          </thead>
          <tbody>
            {report.isLoading && <TableSkeleton columns={7} />}
            {!report.isLoading && rows.length === 0 && <TableEmptyState columns={7} message="No employees found." />}
            {rows.map((row) => (
              <tr key={row.profile_id}>
                <td><span className="person-cell"><Avatar name={row.full_name} />{row.full_name}</span></td>
                <td>{row.role.replace(/_/g, ' ')}</td>
                <td><StatusBadge status={row.is_active ? 'Active' : 'Inactive'} /></td>
                <td className="numeric">{row.jobs_created}</td>
                <td className="numeric">{row.completed_jobs}</td>
                <td className="numeric">{row.active_time}</td>
                <td className="numeric">{row.login_days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
