import { useEffect, useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { jobsSelect, useCallTypes, useFinalStatuses, useHandoverStatuses, type JoinedJob } from '../lib/job-queries'
import Icon from '../components/Icon'
import Avatar from '../components/Avatar'
import StatusBadge from '../components/StatusBadge'
import Pagination from '../components/Pagination'
import { TableEmptyState, TableSkeleton } from '../components/TableStates'
import JobForm from './JobForm'

const PAGE_SIZE = 25
const COLUMN_STORAGE_KEY = 'zygal-jobs-visible-columns'

interface JobTableRow {
  id: string
  job_no: number
  job_date: string
  call_type: string
  project: string | null
  projectType: string | null
  branchCode: string
  branchName: string | null
  state: string | null
  latLong: string | null
  simName: string | null
  simNumber: string | null
  linkIp: string | null
  linkMacId: string | null
  vaultTam: string | null
  cashCounterTam: string | null
  mainDoorTam: string | null
  nglMainDoor: string | null
  takenBy: string | null
  engineerName: string | null
  engineerNumber: string | null
  remark: string | null
  handoverStatus: string
  pendingMaterials: number
  finalStatus: string
  ruleCheck: boolean
  hasMinorIssue: boolean
}

interface JobColumn {
  id: string
  label: string
  defaultVisible?: boolean
  render: (job: JobTableRow) => ReactNode
}

const COLUMNS: JobColumn[] = [
  { id: 'jobDate', label: 'Date', defaultVisible: true, render: (j) => j.job_date },
  { id: 'callType', label: 'Call Type', defaultVisible: true, render: (j) => j.call_type },
  { id: 'project', label: 'Project', defaultVisible: true, render: (j) => j.project ?? '-' },
  { id: 'projectType', label: 'Project Type', render: (j) => j.projectType ?? '-' },
  {
    id: 'branchCode',
    label: 'Branch Code',
    defaultVisible: true,
    render: (j) => j.branchName ? `${j.branchCode} — ${j.branchName}` : j.branchCode,
  },
  { id: 'state', label: 'State', defaultVisible: true, render: (j) => j.state ?? '-' },
  { id: 'latLong', label: 'Lat/Long', render: (j) => j.latLong ?? '-' },
  { id: 'simName', label: 'SIM Name', render: (j) => j.simName ?? '-' },
  { id: 'simNumber', label: 'SIM Card No.', render: (j) => j.simNumber ?? '-' },
  { id: 'linkIp', label: 'Link IP', render: (j) => j.linkIp ?? '-' },
  { id: 'linkMacId', label: 'Link Device MAC ID', render: (j) => j.linkMacId ?? '-' },
  { id: 'vaultTam', label: 'Vault TAM', render: (j) => j.vaultTam ?? '-' },
  { id: 'cashCounterTam', label: 'Cash Counter TAM', render: (j) => j.cashCounterTam ?? '-' },
  { id: 'mainDoorTam', label: 'Main Door TAM', render: (j) => j.mainDoorTam ?? '-' },
  { id: 'nglMainDoor', label: 'NGL Main Door', render: (j) => j.nglMainDoor ?? '-' },
  { id: 'takenBy', label: 'Call Taken By', render: (j) => j.takenBy ? <span className="person-cell"><Avatar name={j.takenBy} />{j.takenBy}</span> : '-' },
  { id: 'engineerName', label: 'Engineer Name', defaultVisible: true, render: (j) => j.engineerName ? <span className="person-cell"><Avatar name={j.engineerName} />{j.engineerName}</span> : 'Not assigned' },
  { id: 'engineerNumber', label: 'Engineer Number', render: (j) => j.engineerNumber ?? '-' },
  {
    id: 'remark',
    label: 'Site Remark',
    render: (j) => j.remark ? <span title={j.remark}>{j.remark.length > 40 ? `${j.remark.slice(0, 40)}...` : j.remark}</span> : '-',
  },
  { id: 'handoverStatus', label: 'Handover Status', defaultVisible: true, render: (j) => <StatusBadge status={j.handoverStatus} /> },
  {
    id: 'materialIssue',
    label: 'Material Issue',
    render: (j) => j.pendingMaterials > 0 ? <StatusBadge status={`${j.pendingMaterials} pending`} /> : '-',
  },
  { id: 'finalStatus', label: 'Final Status', defaultVisible: true, render: (j) => <StatusBadge status={j.finalStatus} /> },
  { id: 'ruleCheck', label: 'Rule Check', render: (j) => j.ruleCheck ? <StatusBadge status="OK" /> : '-' },
  { id: 'minorIssue', label: 'Minor', defaultVisible: true, render: (j) => j.hasMinorIssue ? 'Yes' : '-' },
]

const DEFAULT_VISIBLE_COLUMNS = COLUMNS.filter((column) => column.defaultVisible).map((column) => column.id)

function initialVisibleColumns(): string[] {
  try {
    const stored = window.localStorage.getItem(COLUMN_STORAGE_KEY)
    if (stored === null) return DEFAULT_VISIBLE_COLUMNS
    const validIds = new Set(COLUMNS.map((column) => column.id))
    return stored.split('|').filter((id) => validIds.has(id))
  } catch {
    return DEFAULT_VISIBLE_COLUMNS
  }
}

function toJobTableRow(row: JoinedJob): JobTableRow {
  const site = row.site
  const activeDevices = (site?.devices ?? []).filter(
    (device) => device.device_status === 'Active' && device.deleted_at === null,
  )
  const device = activeDevices.length === 1 ? activeDevices[0] : null
  const pendingMaterials = (row.material_issues ?? []).filter((issue) => issue.status === 'Pending').length
  const finalStatus = row.final_status

  return {
    id: row.id,
    job_no: row.job_no,
    job_date: row.job_date,
    call_type: row.call_type,
    project: site?.project?.name ?? null,
    projectType: site?.project_type?.name ?? null,
    branchCode: site?.branch_code ?? '-',
    branchName: site?.branch_name ?? null,
    state: site?.state ?? null,
    latLong: site?.latitude != null && site.longitude != null ? `${site.latitude}, ${site.longitude}` : null,
    simName: device?.sim_name ?? null,
    simNumber: device?.sim_number ?? null,
    linkIp: device?.link_ip ?? null,
    linkMacId: device?.link_mac_id ?? null,
    vaultTam: device?.vault_tam ?? null,
    cashCounterTam: device?.cash_counter_tam ?? null,
    mainDoorTam: device?.main_door_tam ?? null,
    nglMainDoor: device?.ngl_main_door_tam ?? null,
    takenBy: row.taken_by?.full_name ?? null,
    engineerName: row.engineer?.full_name ?? null,
    engineerNumber: row.engineer?.phone ?? null,
    remark: row.remark,
    handoverStatus: row.handover_status,
    pendingMaterials,
    finalStatus,
    ruleCheck: finalStatus === 'Completed' || finalStatus === 'Live',
    hasMinorIssue: row.has_minor_issue,
  }
}

export default function JobsPage() {
  const callTypes = useCallTypes()
  const handoverStatuses = useHandoverStatuses()
  const finalStatuses = useFinalStatuses()

  const [page, setPage] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [callType, setCallType] = useState('')
  const [handover, setHandover] = useState('')
  const [finalStatus, setFinalStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [adding, setAdding] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<string[]>(initialVisibleColumns)
  const [columnPreferenceError, setColumnPreferenceError] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(0)
    }, 350)
    return () => window.clearTimeout(t)
  }, [searchInput])

  const jobs = useQuery({
    queryKey: ['jobs', { page, search, callType, handover, finalStatus, dateFrom, dateTo }],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase
        .from('jobs')
        .select(jobsSelect(), { count: 'exact' })
        .is('deleted_at', null)

      if (callType) q = q.eq('call_type', callType)
      if (handover) q = q.eq('handover_status', handover)
      if (finalStatus) q = q.eq('final_status', finalStatus)
      if (dateFrom) q = q.gte('job_date', dateFrom)
      if (dateTo) q = q.lte('job_date', dateTo)

      const clean = search.replace(/[,()*%\\"]/g, ' ').trim()
      if (clean) {
        q = q.or(`branch_code.ilike.*${clean}*,branch_name.ilike.*${clean}*`, { referencedTable: 'site' })
      }

      const from = page * PAGE_SIZE
      const { data, count, error } = await q
        .order('job_date', { ascending: false })
        .order('job_no', { ascending: false })
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw error

      const rows = ((data ?? []) as unknown as JoinedJob[]).map(toJobTableRow)
      return { rows, total: count ?? 0 }
    },
  })

  const rows = jobs.data?.rows ?? []
  const total = jobs.data?.total ?? 0
  const shownColumns = COLUMNS.filter((column) => visibleColumns.includes(column.id))

  function toggleColumn(columnId: string) {
    const next = visibleColumns.includes(columnId)
      ? visibleColumns.filter((id) => id !== columnId)
      : [...visibleColumns, columnId]
    setVisibleColumns(next)
    try {
      window.localStorage.setItem(COLUMN_STORAGE_KEY, next.join('|'))
      setColumnPreferenceError(false)
    } catch {
      setColumnPreferenceError(true)
    }
  }

  return (
    <>
      <section className="card">
        <div className="head-row">
          <h2>Jobs</h2>
          <div className="jobs-toolbar">
            <div className="column-picker">
              <button
                type="button"
                className="secondary"
                aria-expanded={columnsOpen}
                aria-controls="jobs-column-options"
                onClick={() => setColumnsOpen((open) => !open)}
              >
                Columns
              </button>
              {columnsOpen && (
                <div className="column-options" id="jobs-column-options">
                  {COLUMNS.map((column) => (
                    <label key={column.id} className="column-option">
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(column.id)}
                        onChange={() => toggleColumn(column.id)}
                      />
                      {column.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setAdding(true)}><Icon name="plus" size={17} />New job</button>
          </div>
        </div>

        {columnPreferenceError && (
          <div className="banner warn" role="status">Column choices could not be saved in this browser.</div>
        )}

        <div className="filters">
          <input
            type="search"
            placeholder="Search site branch code or name"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select value={callType} onChange={(e) => { setCallType(e.target.value); setPage(0) }}>
            <option value="">All call types</option>
            {callTypes.data?.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          <select value={handover} onChange={(e) => { setHandover(e.target.value); setPage(0) }}>
            <option value="">Any handover</option>
            {handoverStatuses.data?.map((h) => (
              <option key={h.name} value={h.name}>{h.name}</option>
            ))}
          </select>
          <select value={finalStatus} onChange={(e) => { setFinalStatus(e.target.value); setPage(0) }}>
            <option value="">Any final status</option>
            {finalStatuses.data?.map((f) => (
              <option key={f.name} value={f.name}>{f.name}</option>
            ))}
          </select>
          <label className="date-field">
            From
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0) }} />
          </label>
          <label className="date-field">
            To
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0) }} />
          </label>
        </div>

        {jobs.isError && <div className="banner error">Could not load jobs. Please refresh and try again.</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job #</th>
                {shownColumns.map((column) => <th key={column.id}>{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {jobs.isLoading && <TableSkeleton columns={shownColumns.length + 1} />}
              {!jobs.isLoading && rows.length === 0 && (
                <TableEmptyState
                  columns={shownColumns.length + 1}
                  message="No jobs match these filters."
                  action={<button onClick={() => setAdding(true)}><Icon name="plus" size={16} />Create a job</button>}
                />
              )}
              {rows.map((job) => (
                <tr key={job.id}>
                  <td><Link className="icon-action table-link" aria-label={`View job ${job.job_no}`} to={`/jobs/${job.id}`}><Icon name="view" size={16} />#{job.job_no}</Link></td>
                  {shownColumns.map((column) => <td key={column.id}>{column.render(job)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination currentPage={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} disabled={jobs.isFetching} itemLabel="jobs" />
      </section>

      {adding && <JobForm job={null} onClose={() => setAdding(false)} />}
    </>
  )
}
