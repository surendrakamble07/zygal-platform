import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export interface DashboardStats {
  totalSites: number
  activeSites: number
  activeEmployees: number
  loggedInToday: number
  jobsToday: number
  completedToday: number
  liveToday: number
  pendingToday: number
  totalJobsThisMonth: number
  pendingHandover: number
  pendingMaterial: number
  completedThisMonth: number
  byFinalStatus: { name: string; count: number }[]
  recentJobs: {
    id: string
    job_no: number
    job_date: string
    final_status: string
    handover_status: string
    branch_code: string
  }[]
}

export interface ProjectDashboardRow {
  project_id: string
  project_name: string
  project_type_id: string
  project_type_name: string
  total_sites: number
  live_sites: number
  pending_sites: number
  handover_pending_sites: number
  material_pending_sites: number
}

export interface ProjectRangeBreakdownRow {
  project_name: string
  project_type_name?: string
  final_status: string
  job_count: number
}

interface RecentJobRow {
  id: string
  job_no: number
  job_date: string
  final_status: string
  handover_status: string
  site: { branch_code: string } | { branch_code: string }[] | null
}

function localMonthStart(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

export function currentMonthStart(): string {
  const d = new Date()
  return localMonthStart(d)
}

function kolkataTodayRange(): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const today = `${values.year}-${values.month}-${values.day}`
  const [year, month, day] = today.split('-').map(Number)
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10)
  return { start: `${today}T00:00:00+05:30`, end: `${tomorrow}T00:00:00+05:30` }
}

export function useDashboardStats(range: { start: string; end: string }) {
  return useQuery({
    queryKey: ['dashboard-stats', range.start, range.end],
    queryFn: async (): Promise<DashboardStats> => {
      const today = kolkataTodayRange()
      const [sitesTotal, sitesActive, activeEmployees, loggedInSessions, jobsToday, completedToday, liveToday, pendingToday, jobsThisMonth, pendingHandover, pendingMaterial, completed, statusBreakdown, recent] =
        await Promise.all([
          supabase.from('sites').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('is_dummy', false),
          supabase.from('sites').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('is_dummy', false).eq('status', 'Active'),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true).eq('is_dummy', false),
          supabase
            .from('user_sessions')
            .select('user_id')
            .gte('started_at', today.start)
            .lt('started_at', today.end),
          supabase
            .from('jobs')
            .select('id, site:sites!inner ( is_dummy )', { count: 'exact', head: true })
            .is('deleted_at', null)
            .eq('is_dummy', false)
            .eq('site.is_dummy', false)
            .gte('job_date', today.start.slice(0, 10))
            .lt('job_date', today.end.slice(0, 10)),
          supabase
            .from('jobs')
            .select('id, site:sites!inner ( is_dummy )', { count: 'exact', head: true })
            .is('deleted_at', null)
            .eq('is_dummy', false)
            .eq('site.is_dummy', false)
            .gte('job_date', today.start.slice(0, 10))
            .lt('job_date', today.end.slice(0, 10))
            .eq('final_status', 'Completed'),
          supabase
            .from('jobs')
            .select('id, site:sites!inner ( is_dummy )', { count: 'exact', head: true })
            .is('deleted_at', null)
            .eq('is_dummy', false)
            .eq('site.is_dummy', false)
            .gte('job_date', today.start.slice(0, 10))
            .lt('job_date', today.end.slice(0, 10))
            .eq('final_status', 'Live'),
          supabase
            .from('jobs')
            .select('id, site:sites!inner ( is_dummy )', { count: 'exact', head: true })
            .is('deleted_at', null)
            .eq('is_dummy', false)
            .eq('site.is_dummy', false)
            .gte('job_date', today.start.slice(0, 10))
            .lt('job_date', today.end.slice(0, 10))
            .eq('final_status', 'Pending'),
          supabase
            .from('jobs')
            .select('id, site:sites!inner ( is_dummy )', { count: 'exact', head: true })
            .is('deleted_at', null)
            .eq('is_dummy', false)
            .eq('site.is_dummy', false)
            .gte('job_date', range.start)
            .lt('job_date', range.end),
          supabase
            .from('jobs')
            .select('id, site:sites!inner ( is_dummy )', { count: 'exact', head: true })
            .is('deleted_at', null)
            .eq('is_dummy', false)
            .eq('site.is_dummy', false)
            .eq('handover_status', 'Pending'),
          supabase
            .from('material_issues')
            .select('id, job:jobs!inner ( is_dummy, site:sites!inner ( is_dummy ) )', { count: 'exact', head: true })
            .eq('status', 'Pending')
            .eq('job.is_dummy', false)
            .eq('job.site.is_dummy', false),
          supabase
            .from('jobs')
            .select('id, site:sites!inner ( is_dummy )', { count: 'exact', head: true })
            .is('deleted_at', null)
            .eq('is_dummy', false)
            .eq('site.is_dummy', false)
            .gte('job_date', range.start)
            .lt('job_date', range.end)
            .in('final_status', ['Completed', 'Live']),
          supabase
            .from('jobs')
            .select('final_status, site:sites!inner ( is_dummy )')
            .is('deleted_at', null)
            .eq('is_dummy', false)
            .eq('site.is_dummy', false)
            .gte('job_date', range.start)
            .lt('job_date', range.end)
            .limit(5000),
          supabase
            .from('jobs')
            .select('id, job_no, job_date, final_status, handover_status, site:sites!inner ( branch_code, is_dummy )')
            .is('deleted_at', null)
            .eq('is_dummy', false)
            .eq('site.is_dummy', false)
            .order('job_date', { ascending: false })
            .order('job_no', { ascending: false })
            .limit(8),
        ])

      if (activeEmployees.error) throw activeEmployees.error
      if (loggedInSessions.error) throw loggedInSessions.error
      if (statusBreakdown.error) throw statusBreakdown.error

      const byFinalStatusMap = new Map<string, number>()
      for (const r of statusBreakdown.data ?? []) {
        const key = (r as { final_status: string }).final_status
        byFinalStatusMap.set(key, (byFinalStatusMap.get(key) ?? 0) + 1)
      }

      return {
        totalSites: sitesTotal.count ?? 0,
        activeSites: sitesActive.count ?? 0,
        activeEmployees: activeEmployees.count ?? 0,
        loggedInToday: new Set(
          (loggedInSessions.data ?? []).map((row) => row.user_id).filter(Boolean),
        ).size,
        jobsToday: jobsToday.count ?? 0,
        completedToday: completedToday.count ?? 0,
        liveToday: liveToday.count ?? 0,
        pendingToday: pendingToday.count ?? 0,
        totalJobsThisMonth: jobsThisMonth.count ?? 0,
        pendingHandover: pendingHandover.count ?? 0,
        pendingMaterial: pendingMaterial.count ?? 0,
        completedThisMonth: completed.count ?? 0,
        byFinalStatus: [...byFinalStatusMap.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        recentJobs: ((recent.data ?? []) as RecentJobRow[]).map((r) => ({
          id: r.id,
          job_no: r.job_no,
          job_date: r.job_date,
          final_status: r.final_status,
          handover_status: r.handover_status,
          branch_code: (Array.isArray(r.site) ? r.site[0]?.branch_code : r.site?.branch_code) ?? '-',
        })),
      }
    },
    staleTime: 60_000,
  })
}

export function useProjectDashboard() {
  return useQuery({
    queryKey: ['project-dashboard'],
    queryFn: fetchProjectDashboard,
    staleTime: 60_000,
  })
}

export async function fetchProjectDashboard(): Promise<ProjectDashboardRow[]> {
  const { data, error } = await supabase
    .from('v_project_dashboard')
    .select('*')

  if (error) throw error
  return (data ?? []) as ProjectDashboardRow[]
}

export function useProjectRangeBreakdown(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['project-range-breakdown', startDate, endDate],
    queryFn: async (): Promise<ProjectRangeBreakdownRow[]> => {
      const { data, error } = await supabase.rpc('project_range_breakdown', {
        p_start: startDate,
        p_end: endDate,
      })
      if (error) throw error

      return (data ?? []).map((row: { project_name: string; project_type_name?: string | null; final_status: string; job_count: number | string }) => ({
        project_name: row.project_name,
        project_type_name: row.project_type_name ?? 'All',
        final_status: row.final_status,
        job_count: Number(row.job_count),
      }))
    },
    staleTime: 60_000,
  })
}
