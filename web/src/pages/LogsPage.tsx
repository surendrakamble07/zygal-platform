import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Icon from '../components/Icon'
import Avatar from '../components/Avatar'
import StatusBadge from '../components/StatusBadge'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 50
const ROW_LIMIT = 200

type FeedType = 'login' | 'data' | 'job-status'
type FilterType = 'all' | FeedType
type JsonRecord = Record<string, unknown>

interface AuditRow {
  id: number
  table_name: string
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  old_data: JsonRecord | null
  new_data: JsonRecord | null
  changed_by: string | null
  changed_at: string
}

interface SessionStartRow {
  id: number
  user_id: string
  started_at: string
}

interface SessionEndRow {
  id: number
  user_id: string
  ended_at: string
  end_reason: 'logout' | 'timeout' | null
}

interface JobStatusRow {
  id: number
  job_id: string
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_at: string
}

interface Activity {
  id: string
  type: FeedType
  person: string
  message: string
  badge: string
  timestamp: string
}

interface ActivityData {
  activities: Activity[]
  limited: boolean
}

const ENTITY_NAMES: Record<string, string> = {
  profiles: 'employee',
  projects: 'project',
  project_types: 'project type',
  engineers: 'engineer',
  sites: 'site',
  devices: 'device',
  jobs: 'job',
  job_checklist: 'job checklist',
  material_issues: 'material issue',
}

function dayStart(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toISOString()
}

function nextDayStart(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day + 1).toISOString()
}

function recordLabel(...records: (JsonRecord | null)[]): string {
  for (const record of records) {
    if (!record) continue
    for (const key of ['full_name', 'branch_code', 'job_no', 'name', 'email', 'title']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) {
        return key === 'job_no' ? `Job #${value}` : value.trim()
      }
      if (typeof value === 'number' && key === 'job_no') return `Job #${value}`
    }
  }
  return 'a record'
}

function getAuditBadge(action: AuditRow['action'], deactivated: boolean): string {
  if (deactivated) return 'Deactivated'
  if (action === 'INSERT') return 'Created'
  if (action === 'UPDATE') return 'Updated'
  return 'Removed'
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`
  return new Date(value).toLocaleDateString()
}

async function loadActivities(dateFrom: string, dateTo: string): Promise<ActivityData> {
  const [auditResult, sessionStartResult, sessionEndResult, statusResult] = await Promise.all([
    (() => {
      let query = supabase
        .from('audit_log')
        .select('id, table_name, action, old_data, new_data, changed_by, changed_at')
        .order('changed_at', { ascending: false })
        .limit(ROW_LIMIT)
      if (dateFrom) query = query.gte('changed_at', dayStart(dateFrom))
      if (dateTo) query = query.lt('changed_at', nextDayStart(dateTo))
      return query
    })(),
    (() => {
      let query = supabase
        .from('user_sessions')
        .select('id, user_id, started_at')
        .order('started_at', { ascending: false })
        .limit(ROW_LIMIT)
      if (dateFrom) query = query.gte('started_at', dayStart(dateFrom))
      if (dateTo) query = query.lt('started_at', nextDayStart(dateTo))
      return query
    })(),
    (() => {
      let query = supabase
        .from('user_sessions')
        .select('id, user_id, ended_at, end_reason')
        .not('ended_at', 'is', null)
        .order('ended_at', { ascending: false })
        .limit(ROW_LIMIT)
      if (dateFrom) query = query.gte('ended_at', dayStart(dateFrom))
      if (dateTo) query = query.lt('ended_at', nextDayStart(dateTo))
      return query
    })(),
    (() => {
      let query = supabase
        .from('job_status_history')
        .select('id, job_id, field_name, old_value, new_value, changed_by, changed_at')
        .order('changed_at', { ascending: false })
        .limit(ROW_LIMIT)
      if (dateFrom) query = query.gte('changed_at', dayStart(dateFrom))
      if (dateTo) query = query.lt('changed_at', nextDayStart(dateTo))
      return query
    })(),
  ])

  if (auditResult.error) throw auditResult.error
  if (sessionStartResult.error) throw sessionStartResult.error
  if (sessionEndResult.error) throw sessionEndResult.error
  if (statusResult.error) throw statusResult.error

  const auditRows = auditResult.data as AuditRow[]
  const sessionStartRows = sessionStartResult.data as SessionStartRow[]
  const sessionEndRows = sessionEndResult.data as SessionEndRow[]
  const statusRows = statusResult.data as JobStatusRow[]
  const profileIds = [...new Set([
    ...auditRows.map((row) => row.changed_by),
    ...sessionStartRows.map((row) => row.user_id),
    ...sessionEndRows.map((row) => row.user_id),
    ...statusRows.map((row) => row.changed_by),
  ].filter((id): id is string => id !== null))]
  const jobIds = [...new Set(statusRows.map((row) => row.job_id))]

  const [profilesResult, jobsResult] = await Promise.all([
    profileIds.length
      ? supabase.from('profiles').select('id, full_name').in('id', profileIds)
      : Promise.resolve({ data: [], error: null }),
    jobIds.length
      ? supabase.from('jobs').select('id, job_no').in('id', jobIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (profilesResult.error) throw profilesResult.error
  if (jobsResult.error) throw jobsResult.error

  const people = new Map<string, string>(
    (profilesResult.data as { id: string; full_name: string }[]).map((profile) => [profile.id, profile.full_name]),
  )
  const jobNumbers = new Map<string, number>(
    (jobsResult.data as { id: string; job_no: number }[]).map((job) => [job.id, job.job_no]),
  )

  const mergedActivities: Activity[] = [
    ...auditRows.map((row): Activity => {
      const entity = ENTITY_NAMES[row.table_name] ?? row.table_name.replace(/_/g, ' ').replace(/s$/, '')
      const label = recordLabel(row.new_data, row.old_data)
      const deactivated = row.table_name === 'profiles'
        && row.action === 'UPDATE'
        && row.old_data?.is_active === true
        && row.new_data?.is_active === false
      const verb = deactivated ? 'deactivated' : row.action === 'INSERT' ? 'created' : row.action === 'DELETE' ? 'removed' : 'updated'
      const person = row.changed_by ? people.get(row.changed_by) ?? 'Unknown' : 'Unknown'
      return {
        id: `audit-${row.id}`,
        type: 'data',
        person,
        message: `${person} ${verb} ${entity} ${label}`,
        badge: getAuditBadge(row.action, deactivated),
        timestamp: row.changed_at,
      }
    }),
    ...sessionStartRows.map((row): Activity => {
      const person = people.get(row.user_id) ?? 'Unknown'
      return {
        id: `session-login-${row.id}`,
        type: 'login',
        person,
        message: `${person} logged in`,
        badge: 'Logged in',
        timestamp: row.started_at,
      }
    }),
    ...sessionEndRows.map((row): Activity => {
      const person = people.get(row.user_id) ?? 'Unknown'
      const isLogout = row.end_reason === 'logout'
      const isTimeout = row.end_reason === 'timeout'
      return {
        id: `session-end-${row.id}`,
        type: 'login',
        person,
        message: isLogout
          ? `${person} logged out`
          : isTimeout
            ? `${person}'s session ended due to inactivity`
            : `${person}'s session ended`,
        badge: isLogout ? 'Logged out' : isTimeout ? 'Timed out' : 'Session ended',
        timestamp: row.ended_at,
      }
    }),
    ...statusRows.map((row): Activity => {
      const person = row.changed_by ? people.get(row.changed_by) ?? 'Unknown' : 'Unknown'
      const jobNumber = jobNumbers.get(row.job_id)
      const field = row.field_name === 'handover_status' ? 'handover status' : 'final status'
      return {
        id: `status-${row.id}`,
        type: 'job-status',
        person,
        message: `${person} changed ${jobNumber === undefined ? 'a job' : `Job #${jobNumber}`} ${field} from ${row.old_value ?? '—'} to ${row.new_value ?? '—'}`,
        badge: 'Status changed',
        timestamp: row.changed_at,
      }
    }),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  let loginActivityCount = 0
  const activities = mergedActivities.filter((activity) => {
    if (activity.type !== 'login') return true
    loginActivityCount += 1
    return loginActivityCount <= ROW_LIMIT
  })

  return {
    activities,
    limited: auditRows.length === ROW_LIMIT
      || sessionStartRows.length === ROW_LIMIT
      || sessionEndRows.length === ROW_LIMIT
      || sessionStartRows.length + sessionEndRows.length > ROW_LIMIT
      || statusRows.length === ROW_LIMIT,
  }
}

export default function LogsPage() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [type, setType] = useState<FilterType>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const logs = useQuery({
    queryKey: ['activity-logs', dateFrom, dateTo],
    queryFn: () => loadActivities(dateFrom, dateTo),
  })

  const filtered = useMemo(() => {
    const searchText = search.trim().toLocaleLowerCase()
    return (logs.data?.activities ?? []).filter((activity) =>
      (type === 'all' || activity.type === type)
      && (!searchText || activity.person.toLocaleLowerCase().includes(searchText)),
    )
  }, [logs.data, search, type])
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE)

  function updateFilter<T>(setter: (value: T) => void, value: T) {
    setter(value)
    setPage(0)
  }

  return (
    <section className="card">
      <div className="head-row">
        <div>
          <h2>Activity logs</h2>
          <p className="muted small">Recent account, data, and job status activity</p>
        </div>
        <span className="muted small">{filtered.length} activities</span>
      </div>

      <div className="filters">
        <label className="date-field">
          From
          <input type="date" value={dateFrom} onChange={(event) => updateFilter(setDateFrom, event.target.value)} />
        </label>
        <label className="date-field">
          To
          <input type="date" value={dateTo} onChange={(event) => updateFilter(setDateTo, event.target.value)} />
        </label>
        <select value={type} onChange={(event) => updateFilter(setType, event.target.value as FilterType)}>
          <option value="all">All activity</option>
          <option value="login">Logins</option>
          <option value="data">Data changes</option>
          <option value="job-status">Job status changes</option>
        </select>
        <input
          type="search"
          aria-label="Search by person"
          placeholder="Search by person..."
          value={search}
          onChange={(event) => updateFilter(setSearch, event.target.value)}
        />
      </div>

      {logs.isError && (
        <div className="banner error" role="alert">
          Could not load activity logs: {logs.error instanceof Error ? logs.error.message : 'Unknown error'}
        </div>
      )}

      {logs.isPending ? (
        <div className="logs-feed" aria-label="Loading activity logs">
          {Array.from({ length: 5 }, (_, index) => (
            <div className="log-entry log-skeleton" key={index}>
              <span className="skeleton-bar" />
              <span className="skeleton-bar" />
            </div>
          ))}
        </div>
      ) : !logs.isError && visible.length === 0 ? (
        <div className="empty-state">
          <Icon name="empty" className="empty-state-icon" />
          <span>No activity matches these filters.</span>
        </div>
      ) : (
        <>
          {logs.data?.limited && (
            <div className="banner info">
              Showing up to {ROW_LIMIT} most recent entries per activity type. Narrow the date range to see older activity.
            </div>
          )}
          <ol className="logs-feed">
            {visible.map((activity) => (
              <li className="log-entry" key={activity.id}>
                <StatusBadge status={activity.badge} />
                <span className="log-message">
                  <Avatar name={activity.person} />
                  {activity.message}
                </span>
                <time className="log-time" dateTime={activity.timestamp} title={new Date(activity.timestamp).toLocaleString()}>
                  {relativeTime(activity.timestamp)}
                </time>
              </li>
            ))}
          </ol>
          {pageCount > 1 && (
            <div className="head-row log-pagination">
              <span className="muted small">
                Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="actions">
                <button className="secondary" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Previous</button>
                <button className="secondary" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
