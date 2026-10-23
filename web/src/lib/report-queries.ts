import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

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
  engineerId: string
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
      if (filters.engineerId) q = q.eq('engineer_id', filters.engineerId)
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
export async function fetchJobReportForExport(filters: ReportFilters): Promise<{ rows: JobReportRow[]; truncated: boolean }> {
  let q = supabase
    .from('jobs')
    .select(
      `job_no, job_date, call_type, handover_status, final_status, has_minor_issue,
       site:sites!inner ( branch_code, branch_name, state, project_id, project:projects!inner ( name ) ),
       engineer:engineers ( full_name ),
       taken_by:profiles!jobs_call_taken_by_fkey ( full_name )`,
    )
    .is('deleted_at', null)

  if (filters.dateFrom) q = q.gte('job_date', filters.dateFrom)
  if (filters.dateTo) q = q.lte('job_date', filters.dateTo)
  if (filters.finalStatus) q = q.eq('final_status', filters.finalStatus)
  if (filters.engineerId) q = q.eq('engineer_id', filters.engineerId)
  if (filters.projectId) q = q.eq('site.project_id', filters.projectId)
  if (filters.stateName) q = q.eq('site.state', filters.stateName)
  if (filters.branchCode.trim()) q = q.ilike('site.branch_code', `*${filters.branchCode.trim()}*`)

  const { data, error } = await q.order('job_date', { ascending: false }).limit(CSV_ROW_LIMIT + 1)
  if (error) throw error

  const truncated = (data ?? []).length > CSV_ROW_LIMIT
  const rows: JobReportRow[] = (data ?? []).slice(0, CSV_ROW_LIMIT).map((r: any) => ({
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
