import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export interface DashboardStats {
  totalSites: number
  activeSites: number
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

export interface ProjectMonthBreakdownRow {
  project_name: string
  project_type_name: string
  final_status: string
  job_count: number
}

interface ProjectMonthJob {
  final_status: string
  site:
    | {
        project: { name: string } | { name: string }[] | null
        project_type: { name: string } | { name: string }[] | null
      }
    | {
        project: { name: string } | { name: string }[] | null
        project_type: { name: string } | { name: string }[] | null
      }[]
    | null
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

function nextMonthStart(monthStart: string): string {
  const [year, month] = monthStart.split('-').map(Number)
  const next = new Date(year, month, 1)
  return localMonthStart(next)
}

export function currentMonthStart(): string {
  const d = new Date()
  return localMonthStart(d)
}

export function useDashboardStats(selectedMonthStart: string) {
  return useQuery({
    queryKey: ['dashboard-stats', selectedMonthStart],
    queryFn: async (): Promise<DashboardStats> => {
      const currentFrom = currentMonthStart()
      const selectedTo = nextMonthStart(selectedMonthStart)

      const [sitesTotal, sitesActive, jobsThisMonth, pendingHandover, pendingMaterial, completed, statusBreakdown, recent] =
        await Promise.all([
          supabase.from('sites').select('id', { count: 'exact', head: true }).is('deleted_at', null),
          supabase.from('sites').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('status', 'Active'),
          supabase.from('jobs').select('id', { count: 'exact', head: true }).is('deleted_at', null).gte('job_date', currentFrom),
          supabase.from('jobs').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('handover_status', 'Pending'),
          supabase.from('material_issues').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
          supabase
            .from('jobs')
            .select('id', { count: 'exact', head: true })
            .is('deleted_at', null)
            .gte('job_date', currentFrom)
            .in('final_status', ['Completed', 'Live']),
          supabase.from('jobs').select('final_status').is('deleted_at', null).gte('job_date', selectedMonthStart).lt('job_date', selectedTo).limit(5000),
          supabase
            .from('jobs')
            .select('id, job_no, job_date, final_status, handover_status, site:sites ( branch_code )')
            .is('deleted_at', null)
            .order('job_date', { ascending: false })
            .order('job_no', { ascending: false })
            .limit(8),
        ])

      if (statusBreakdown.error) throw statusBreakdown.error

      const byFinalStatusMap = new Map<string, number>()
      for (const r of statusBreakdown.data ?? []) {
        const key = (r as { final_status: string }).final_status
        byFinalStatusMap.set(key, (byFinalStatusMap.get(key) ?? 0) + 1)
      }

      return {
        totalSites: sitesTotal.count ?? 0,
        activeSites: sitesActive.count ?? 0,
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

export function useProjectMonthBreakdown(monthStart: string) {
  return useQuery({
    queryKey: ['project-month-breakdown', monthStart],
    queryFn: async (): Promise<ProjectMonthBreakdownRow[]> => {
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          final_status,
          site:sites!inner (
            project:projects!sites_project_id_fkey ( name ),
            project_type:project_types!sites_type_matches_project ( name )
          )
        `)
        .is('deleted_at', null)
        .gte('job_date', monthStart)
        .lt('job_date', nextMonthStart(monthStart))
      if (error) throw error

      const totals = new Map<string, ProjectMonthBreakdownRow>()
      for (const row of (data ?? []) as ProjectMonthJob[]) {
        const site = Array.isArray(row.site) ? row.site[0] : row.site
        const project = Array.isArray(site?.project) ? site.project[0] : site?.project
        const projectType = Array.isArray(site?.project_type)
          ? site.project_type[0]
          : site?.project_type
        if (!project?.name || !projectType?.name) continue

        const key = `${project.name}\u0000${projectType.name}\u0000${row.final_status}`
        const existing = totals.get(key)
        if (existing) {
          existing.job_count += 1
        } else {
          totals.set(key, {
            project_name: project.name,
            project_type_name: projectType.name,
            final_status: row.final_status,
            job_count: 1,
          })
        }
      }
      return [...totals.values()]
    },
    staleTime: 60_000,
  })
}
