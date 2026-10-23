import { useMemo, useState } from 'react'
import { useProjects, useStates } from '../lib/queries'
import { useEngineers } from '../lib/job-queries'
import { useFinalStatuses } from '../lib/job-queries'
import {
  fetchJobReportForExport,
  useEngineerStats,
  useJobReport,
  useMaterialReport,
  type ReportFilters,
} from '../lib/report-queries'
import { downloadCsv } from '../lib/csv'

const PAGE_SIZE = 25
const EMPTY_FILTERS: ReportFilters = {
  dateFrom: '',
  dateTo: '',
  projectId: '',
  stateName: '',
  engineerId: '',
  finalStatus: '',
  branchCode: '',
}

type Tab = 'jobs' | 'hardware' | 'engineers'

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('jobs')

  return (
    <section className="card">
      <div className="head-row">
        <h2>Reports</h2>
      </div>
      <div className="tab-row">
        <button className={tab === 'jobs' ? 'tab active' : 'tab'} onClick={() => setTab('jobs')}>
          Job data
        </button>
        <button className={tab === 'hardware' ? 'tab active' : 'tab'} onClick={() => setTab('hardware')}>
          Hardware / material issues
        </button>
        <button className={tab === 'engineers' ? 'tab active' : 'tab'} onClick={() => setTab('engineers')}>
          Engineer productivity
        </button>
      </div>

      {tab === 'jobs' && <JobReportTab />}
      {tab === 'hardware' && <HardwareReportTab />}
      {tab === 'engineers' && <EngineerReportTab />}
    </section>
  )
}

function JobReportTab() {
  const projects = useProjects()
  const states = useStates()
  const engineers = useEngineers()
  const finalStatuses = useFinalStatuses()

  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState('')

  const report = useJobReport(filters, page, PAGE_SIZE)
  const rows = report.data?.rows ?? []
  const total = report.data?.total ?? 0
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1
  const last = Math.min((page + 1) * PAGE_SIZE, total)
  const hasNext = (page + 1) * PAGE_SIZE < total

  function setFilter<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
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
        <select value={filters.engineerId} onChange={(e) => setFilter('engineerId', e.target.value)}>
          <option value="">All engineers</option>
          {(engineers.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>{e.full_name}</option>
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
        <span className="muted small">{total === 0 ? 'No results' : `Showing ${first}-${last} of ${total}`}</span>
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
            {report.isLoading && <tr><td colSpan={10} className="muted">Loading...</td></tr>}
            {!report.isLoading && rows.length === 0 && <tr><td colSpan={10} className="muted">No jobs match these filters.</td></tr>}
            {rows.map((r) => (
              <tr key={r.job_no}>
                <td>#{r.job_no}</td>
                <td>{r.job_date}</td>
                <td>{r.call_type}</td>
                <td>{r.branch_code}</td>
                <td>{r.project_name}</td>
                <td>{r.state ?? '-'}</td>
                <td>{r.engineer_name ?? 'Not assigned'}</td>
                <td>{r.handover_status}</td>
                <td>{r.final_status}</td>
                <td>{r.has_minor_issue ? 'Yes' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="actions">
        <button className="secondary" disabled={page === 0 || report.isFetching} onClick={() => setPage((p) => p - 1)}>Previous</button>
        <button className="secondary" disabled={!hasNext || report.isFetching} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
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
            <tr><th>Job #</th><th>Date</th><th>Branch</th><th>Item</th><th>Problem</th><th>Qty</th><th>Status</th></tr>
          </thead>
          <tbody>
            {report.isLoading && <tr><td colSpan={7} className="muted">Loading...</td></tr>}
            {!report.isLoading && rows.length === 0 && <tr><td colSpan={7} className="muted">No matching issues.</td></tr>}
            {rows.map((r, i) => (
              <tr key={i}>
                <td>#{r.job_no}</td><td>{r.job_date}</td><td>{r.branch_code}</td>
                <td>{r.item}</td><td>{r.problem}</td><td>{r.quantity}</td><td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function EngineerReportTab() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const stats = useEngineerStats(dateFrom, dateTo)
  const rows = stats.data ?? []

  const withRate = useMemo(
    () => rows.map((r) => ({ ...r, rate: r.total_jobs ? Math.round((r.completed_jobs / r.total_jobs) * 100) : 0 })),
    [rows],
  )

  return (
    <>
      <div className="filters">
        <label className="date-field">From<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
        <label className="date-field">To<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
      </div>

      <div className="head-row">
        <span className="muted small">{rows.length} engineer{rows.length === 1 ? '' : 's'} with jobs in this range</span>
        <button
          className="secondary"
          disabled={withRate.length === 0}
          onClick={() => downloadCsv(`zygal-engineers-${new Date().toISOString().slice(0, 10)}.csv`, withRate)}
        >
          Export to CSV
        </button>
      </div>
      {stats.isError && <div className="banner error">Could not load the report. Please refresh and try again.</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Engineer</th><th>Total jobs</th><th>Completed / Live</th><th>Completion rate</th><th>Handover still pending</th></tr>
          </thead>
          <tbody>
            {stats.isLoading && <tr><td colSpan={5} className="muted">Loading...</td></tr>}
            {!stats.isLoading && withRate.length === 0 && <tr><td colSpan={5} className="muted">No jobs in this date range.</td></tr>}
            {withRate.map((r) => (
              <tr key={r.engineer_id ?? 'unassigned'}>
                <td>{r.engineer_name}</td>
                <td>{r.total_jobs}</td>
                <td>{r.completed_jobs}</td>
                <td>{r.rate}%</td>
                <td>{r.pending_handover}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
