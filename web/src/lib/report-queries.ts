import { useQuery } from '@tanstack/react-query'
import { jobsSelect, type JoinedJob } from './job-queries'
import { supabase } from './supabase'

export interface JobMasterCsvRow {
  Date: string
  'Call Type': string
  Project: string
  'Project Type': string
  'Branch Code': string
  State: string
  'Longitude / Latitude': string
  'SIM Name': string
  'SIM Card No.': string
  'Link IP': string
  'Link Device MAC ID': string
  'Vault TAM': string
  'Cash Counter TAM': string
  'Main Door TAM': string
  'NGL Main Door': string
  'Call Taken By': string
  'Engineer Name': string
  'Engineer Number': string
  'Site Remark': string
  'Handover Status': string
  'Material Issue': string
  'Final Status': string
  'Rule Validator Status': string
}

export interface JobReportRow {
  job_no: number
  job_date: string
  call_type: string
  handover_status: string
  final_status: string
  has_minor_issue: boolean
  branch_code: string
  branch_name: string | null
  project_name: string
  state: string | null
  engineer_name: string | null
  taken_by_name: string | null
}

export interface ReportFilters {
  dateFrom: string
  dateTo: string
  projectId: string
  stateName: string
  employeeId: string
  finalStatus: string
  branchCode: string
}

const CSV_ROW_LIMIT = 5000

// One page of job rows for the on-screen table, joined with readable names.
export function useJobReport(filters: ReportFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: ['report-jobs', filters, page, pageSize],
    queryFn: async () => {
      let q = supabase
        .from('jobs')
        .select(
          `job_no, job_date, call_type, handover_status, final_status, has_minor_issue,
           site:sites!inner ( branch_code, branch_name, state, project_id, project:projects!inner ( name ) ),
           engineer:engineers ( full_name ),
           taken_by:profiles!jobs_call_taken_by_fkey ( full_name )`,
          { count: 'exact' },
        )
        .is('deleted_at', null)

      if (filters.dateFrom) q = q.gte('job_date', filters.dateFrom)
      if (filters.dateTo) q = q.lte('job_date', filters.dateTo)
      if (filters.finalStatus) q = q.eq('final_status', filters.finalStatus)
      if (filters.employeeId) q = q.eq('call_taken_by', filters.employeeId)
      if (filters.projectId) q = q.eq('site.project_id', filters.projectId)
      if (filters.stateName) q = q.eq('site.state', filters.stateName)
      if (filters.branchCode.trim()) q = q.ilike('site.branch_code', `*${filters.branchCode.trim()}*`)

      const from = page * pageSize
      const { data, count, error } = await q
        .order('job_date', { ascending: false })
        .range(from, from + pageSize - 1)
      if (error) throw error

      const rows: JobReportRow[] = (data ?? []).map((r: any) => ({
        job_no: r.job_no,
        job_date: r.job_date,
        call_type: r.call_type,
        handover_status: r.handover_status,
        final_status: r.final_status,
        has_minor_issue: r.has_minor_issue,
        branch_code: r.site?.branch_code ?? '-',
        branch_name: r.site?.branch_name ?? null,
        project_name: r.site?.project?.name ?? '-',
        state: r.site?.state ?? null,
        engineer_name: r.engineer?.full_name ?? null,
        taken_by_name: r.taken_by?.full_name ?? null,
      }))
      return { rows, total: count ?? 0 }
    },
  })
}

// Every matching row, for the CSV download. Capped so a huge export can't freeze the page.
export async function fetchJobReportForExport(filters: ReportFilters): Promise<{ rows: JobMasterCsvRow[]; truncated: boolean }> {
  let q = supabase
    .from('jobs')
    .select(jobsSelect({ includeDevices: false, includeMaterials: false }))
    .is('deleted_at', null)

  if (filters.dateFrom) q = q.gte('job_date', filters.dateFrom)
  if (filters.dateTo) q = q.lte('job_date', filters.dateTo)
  if (filters.finalStatus) q = q.eq('final_status', filters.finalStatus)
  if (filters.employeeId) q = q.eq('call_taken_by', filters.employeeId)
  if (filters.projectId) q = q.eq('site.project_id', filters.projectId)
  if (filters.stateName) q = q.eq('site.state', filters.stateName)
  if (filters.branchCode.trim()) q = q.ilike('site.branch_code', `*${filters.branchCode.trim()}*`)

  const { data, error } = await q
    .order('job_date', { ascending: false })
    .order('job_no', { ascending: false })
    .limit(CSV_ROW_LIMIT + 1)
  if (error) throw error

  const truncated = (data ?? []).length > CSV_ROW_LIMIT
  const jobs = ((data ?? []).slice(0, CSV_ROW_LIMIT) as unknown as JoinedJob[])
  const siteIds = [...new Set(jobs.map((job) => job.site?.id).filter((id): id is string => !!id))]
  const jobIds = jobs.map((job) => job.id)

  const [deviceResult, materialResult] = await Promise.all([
    siteIds.length
      ? supabase
        .from('devices')
        .select('site_id, sim_name, sim_number, link_ip, link_mac_id, vault_tam, cash_counter_tam, main_door_tam, ngl_main_door_tam, device_status, deleted_at, created_at')
        .in('site_id', siteIds)
        .eq('device_status', 'Active')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    jobIds.length
      ? supabase
        .from('material_issues')
        .select('job_id, item, problem, status, created_at')
        .in('job_id', jobIds)
        .order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ])
  if (deviceResult.error) throw deviceResult.error
  if (materialResult.error) throw materialResult.error

  const devicesBySite = new Map<string, (typeof deviceResult.data)[number]>()
  for (const device of deviceResult.data ?? []) {
    if (!devicesBySite.has(device.site_id)) devicesBySite.set(device.site_id, device)
  }
  const materialsByJob = new Map<string, string[]>()
  for (const material of materialResult.data ?? []) {
    const rows = materialsByJob.get(material.job_id) ?? []
    rows.push(`${material.item}: ${material.problem} (${material.status})`)
    materialsByJob.set(material.job_id, rows)
  }

  const rows: JobMasterCsvRow[] = jobs.map((job) => {
    const site = job.site
    const device = site ? devicesBySite.get(site.id) : undefined
    const finalStatus = job.final_status
    return {
      Date: job.job_date,
      'Call Type': job.call_type,
      Project: site?.project?.name ?? '',
      'Project Type': site?.project_type?.name ?? '',
      'Branch Code': site?.branch_code ?? '',
      State: site?.state ?? '',
      'Longitude / Latitude': site?.latitude != null && site.longitude != null ? `${site.latitude}, ${site.longitude}` : '',
      'SIM Name': device?.sim_name ?? '',
      'SIM Card No.': device?.sim_number ?? '',
      'Link IP': device?.link_ip ?? '',
      'Link Device MAC ID': device?.link_mac_id ?? '',
      'Vault TAM': device?.vault_tam ?? '',
      'Cash Counter TAM': device?.cash_counter_tam ?? '',
      'Main Door TAM': device?.main_door_tam ?? '',
      'NGL Main Door': device?.ngl_main_door_tam ?? '',
      'Call Taken By': job.taken_by?.full_name ?? '',
      'Engineer Name': job.engineer?.full_name ?? '',
      'Engineer Number': job.engineer?.phone ?? '',
      'Site Remark': job.remark ?? '',
      'Handover Status': job.handover_status,
      'Material Issue': (materialsByJob.get(job.id) ?? []).join('; '),
      'Final Status': finalStatus,
      'Rule Validator Status': finalStatus === 'Completed' || finalStatus === 'Live' ? 'OK' : '',
    }
  })
  return { rows, truncated }
}

export interface MaterialReportRow {
  job_no: number
  job_date: string
  branch_code: string
  item: string
  problem: string
  quantity: number
  status: string
}

// "All hardware issues for X" — material issues joined back to their job and site.
export function useMaterialReport(filters: Pick<ReportFilters, 'dateFrom' | 'dateTo' | 'stateName' | 'projectId'>, pendingOnly: boolean) {
  return useQuery({
    queryKey: ['report-materials', filters, pendingOnly],
    queryFn: async () => {
      let q = supabase
        .from('material_issues')
        .select(
          `item, problem, quantity, status,
           job:jobs!inner ( job_no, job_date,
             site:sites!inner ( branch_code, state, project_id ) )`,
        )

      if (pendingOnly) q = q.eq('status', 'Pending')
      if (filters.dateFrom) q = q.gte('job.job_date', filters.dateFrom)
      if (filters.dateTo) q = q.lte('job.job_date', filters.dateTo)
      if (filters.stateName) q = q.eq('job.site.state', filters.stateName)
      if (filters.projectId) q = q.eq('job.site.project_id', filters.projectId)

      const { data, error } = await q.order('status', { ascending: false }).limit(1000)
      if (error) throw error

      return (data ?? []).map((r: any) => ({
        job_no: r.job.job_no,
        job_date: r.job.job_date,
        branch_code: r.job.site.branch_code,
        item: r.item,
        problem: r.problem,
        quantity: r.quantity,
        status: r.status,
      })) as MaterialReportRow[]
    },
  })
}

export interface EngineerStat {
  engineer_id: string | null
  engineer_name: string
  total_jobs: number
  completed_jobs: number
  pending_handover: number
}

// Engineer productivity: counted from the jobs already loaded by the date filter.
// Fine at this company's volume (a few thousand jobs a month); if that grows a lot,
// this would move into a database view instead.
export function useEngineerStats(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ['report-engineer-stats', dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase
        .from('jobs')
        .select('engineer_id, final_status, handover_status, engineer:engineers ( full_name )')
        .is('deleted_at', null)
      if (dateFrom) q = q.gte('job_date', dateFrom)
      if (dateTo) q = q.lte('job_date', dateTo)

      const { data, error } = await q.limit(20000)
      if (error) throw error

      const map = new Map<string, EngineerStat>()
      for (const r of (data ?? []) as any[]) {
        const key = r.engineer_id ?? 'unassigned'
        const name = r.engineer?.full_name ?? 'Not assigned'
        if (!map.has(key)) {
          map.set(key, { engineer_id: r.engineer_id, engineer_name: name, total_jobs: 0, completed_jobs: 0, pending_handover: 0 })
        }
        const s = map.get(key)!
        s.total_jobs += 1
        if (r.final_status === 'Completed' || r.final_status === 'Live') s.completed_jobs += 1
        if (r.handover_status === 'Pending') s.pending_handover += 1
      }
      return [...map.values()].sort((a, b) => b.total_jobs - a.total_jobs)
    },
  })
}

export interface EmployeeProductivityRow {
  profile_id: string
  full_name: string
  role: string
  is_active: boolean
  jobs_created: number
  completed_jobs: number
  active_time: string
  login_days: number
}

function dateBoundary(value: string, addDay = false): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day + (addDay ? 1 : 0)).toISOString()
}

function formatActiveTime(milliseconds: number): string {
  const totalMinutes = Math.floor(milliseconds / 60_000)
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
}

export function useEmployeeProductivity(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ['report-employee-productivity', dateFrom, dateTo],
    queryFn: async () => {
      let sessionsQuery = supabase
        .from('user_sessions')
        .select('user_id, started_at, ended_at')
        .order('started_at', { ascending: false })
        .limit(20000)
      if (dateFrom) sessionsQuery = sessionsQuery.gte('started_at', dateBoundary(dateFrom))
      if (dateTo) sessionsQuery = sessionsQuery.lt('started_at', dateBoundary(dateTo, true))

      let jobsQuery = supabase
        .from('jobs')
        .select('call_taken_by')
        .is('deleted_at', null)
        .limit(20000)
      if (dateFrom) jobsQuery = jobsQuery.gte('job_date', dateFrom)
      if (dateTo) jobsQuery = jobsQuery.lte('job_date', dateTo)

      const [profilesResult, jobsResult, historyResult, sessionsResult] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role, is_active').order('full_name'),
        jobsQuery,
        supabase
          .from('job_status_history')
          .select('job_id, field_name, new_value, changed_by, changed_at')
          .eq('field_name', 'final_status')
          .order('changed_at', { ascending: false })
          .limit(20000),
        sessionsQuery,
      ])
      if (profilesResult.error) throw profilesResult.error
      if (jobsResult.error) throw jobsResult.error
      if (historyResult.error) throw historyResult.error
      if (sessionsResult.error) throw sessionsResult.error

      const jobsByProfile = new Map<string, number>()
      for (const job of jobsResult.data ?? []) {
        jobsByProfile.set(job.call_taken_by, (jobsByProfile.get(job.call_taken_by) ?? 0) + 1)
      }

      const latestFinalStatusByJob = new Map<
        string,
        { new_value: string | null; changed_by: string | null; changed_at: string }
      >()
      for (const change of historyResult.data ?? []) {
        if (!latestFinalStatusByJob.has(change.job_id)) {
          latestFinalStatusByJob.set(change.job_id, change)
        }
      }
      const completedByProfile = new Map<string, Set<string>>()
      for (const [jobId, change] of latestFinalStatusByJob) {
        if (
          change.changed_by
          && (change.new_value === 'Completed' || change.new_value === 'Live')
          && (!dateFrom || change.changed_at >= dateBoundary(dateFrom))
          && (!dateTo || change.changed_at < dateBoundary(dateTo, true))
        ) {
          const jobs = completedByProfile.get(change.changed_by) ?? new Set<string>()
          jobs.add(jobId)
          completedByProfile.set(change.changed_by, jobs)
        }
      }

      const sessionsByProfile = new Map<string, { milliseconds: number; days: Set<string> }>()
      const now = Date.now()
      for (const session of sessionsResult.data ?? []) {
        const summary = sessionsByProfile.get(session.user_id) ?? { milliseconds: 0, days: new Set<string>() }
        const started = new Date(session.started_at).getTime()
        const ended = session.ended_at ? new Date(session.ended_at).getTime() : now
        summary.milliseconds += Math.max(0, ended - started)
        summary.days.add(new Date(session.started_at).toISOString().slice(0, 10))
        sessionsByProfile.set(session.user_id, summary)
      }

      return (profilesResult.data ?? [])
        .map((profile): EmployeeProductivityRow => {
          const sessions = sessionsByProfile.get(profile.id)
          return {
            profile_id: profile.id,
            full_name: profile.full_name,
            role: profile.role,
            is_active: profile.is_active,
            jobs_created: jobsByProfile.get(profile.id) ?? 0,
            completed_jobs: completedByProfile.get(profile.id)?.size ?? 0,
            active_time: formatActiveTime(sessions?.milliseconds ?? 0),
            login_days: sessions?.days.size ?? 0,
          }
        })
        .sort((a, b) => b.jobs_created - a.jobs_created || a.full_name.localeCompare(b.full_name))
    },
  })
}
