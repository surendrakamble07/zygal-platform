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

function monthStart(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async (): Promise<DashboardStats> => {
      const from = monthStart()

      const [sitesTotal, sitesActive, jobsThisMonth, pendingHandover, pendingMaterial, completed, statusBreakdown, recent] =
        await Promise.all([
          supabase.from('sites').select('id', { count: 'exact', head: true }).is('deleted_at', null),
          supabase.from('sites').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('status', 'Active'),
          supabase.from('jobs').select('id', { count: 'exact', head: true }).is('deleted_at', null).gte('job_date', from),
          supabase.from('jobs').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('handover_status', 'Pending'),
          supabase.from('material_issues').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
          supabase
            .from('jobs')
            .select('id', { count: 'exact', head: true })
            .is('deleted_at', null)
            .gte('job_date', from)
            .in('final_status', ['Completed', 'Live']),
          supabase.from('jobs').select('final_status').is('deleted_at', null).gte('job_date', from).limit(5000),
          supabase
            .from('jobs')
            .select('id, job_no, job_date, final_status, handover_status, site:sites ( branch_code )')
            .is('deleted_at', null)
            .order('job_date', { ascending: false })
            .order('job_no', { ascending: false })
            .limit(8),
        ])

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
        recentJobs: (recent.data ?? []).map((r: any) => ({
          id: r.id,
          job_no: r.job_no,
          job_date: r.job_date,
          final_status: r.final_status,
          handover_status: r.handover_status,
          branch_code: r.site?.branch_code ?? '-',
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
