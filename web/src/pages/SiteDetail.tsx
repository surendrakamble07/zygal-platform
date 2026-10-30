import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProjects, useProjectTypes } from '../lib/queries'
import type { Site } from '../lib/types'
import Avatar from '../components/Avatar'
import StatusBadge from '../components/StatusBadge'
import { TableEmptyState, TableSkeleton } from '../components/TableStates'
import SiteForm from './SiteForm'

interface SiteJob {
  id: string
  job_no: number
  job_date: string
  call_type: string
  handover_status: string
  final_status: string
  engineer_name: string | null
}

function useSite(siteId: string | undefined) {
  return useQuery({
    queryKey: ['site', siteId],
    enabled: !!siteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sites')
        .select('id, project_id, project_type_id, branch_code, branch_name, state, latitude, longitude, status')
        .eq('id', siteId)
        .single()
      if (error) throw error
      return data as Site
    },
  })
}

function useSiteJobs(siteId: string | undefined) {
  return useQuery({
    queryKey: ['site-jobs', siteId],
    enabled: !!siteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, job_no, job_date, call_type, handover_status, final_status, engineer:engineers ( full_name )')
        .eq('site_id', siteId)
        .is('deleted_at', null)
        .order('job_date', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data ?? []).map((r: any) => ({
        id: r.id,
        job_no: r.job_no,
        job_date: r.job_date,
        call_type: r.call_type,
        handover_status: r.handover_status,
        final_status: r.final_status,
        engineer_name: r.engineer?.full_name ?? null,
      })) as SiteJob[]
    },
  })
}

export default function SiteDetail() {
  const { siteId } = useParams()
  const qc = useQueryClient()
  const site = useSite(siteId)
  const jobs = useSiteJobs(siteId)
  const projects = useProjects()
  const types = useProjectTypes()

  const [editingSite, setEditingSite] = useState(false)

  if (site.isLoading) {
    return (
      <section className="card loading-card" aria-label="Loading site details">
        <span className="skeleton-bar" />
        <span className="skeleton-bar" />
        <span className="skeleton-bar" />
      </section>
    )
  }
  if (site.isError || !site.data) return <p className="muted">Site not found.</p>
  const s = site.data

  const projectName = (projects.data ?? []).find((p) => p.id === s.project_id)?.name ?? '-'
  const typeName = (types.data ?? []).find((t) => t.id === s.project_type_id)?.name ?? '-'

  const pendingHandover = (jobs.data ?? []).filter((j) => j.handover_status === 'Pending').length

  return (
    <>
      <section className="card">
        <div className="head-row">
          <div>
            <Link to="/sites" className="link">← Back to Sites</Link>
            <h2>{s.branch_code}{s.branch_name ? ` — ${s.branch_name}` : ''}</h2>
          </div>
          <button className="secondary" onClick={() => setEditingSite(true)}>Edit site</button>
        </div>

        <div className="detail-grid">
          <div><span className="muted small">Project</span><div>{projectName}</div></div>
          <div><span className="muted small">Type</span><div>{typeName}</div></div>
          <div><span className="muted small">State</span><div>{s.state ?? '-'}</div></div>
          <div><span className="muted small">Status</span><div><StatusBadge status={s.status} /></div></div>
          <div><span className="muted small">Lat / Long</span><div>{s.latitude != null ? `${s.latitude}, ${s.longitude}` : '-'}</div></div>
          <div><span className="muted small">Total jobs</span><div>{jobs.data?.length ?? '...'}</div></div>
        </div>
        {pendingHandover > 0 && (
          <div className="banner warn">{pendingHandover} job{pendingHandover === 1 ? '' : 's'} at this site still have Handover Pending.</div>
        )}
      </section>

      <section className="card">
        <h3>Job history</h3>
        <p className="muted small">Every job ever logged for this site, most recent first.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Job #</th><th>Date</th><th>Call type</th><th>Engineer</th><th>Handover</th><th>Final status</th></tr>
            </thead>
            <tbody>
              {jobs.isLoading && <TableSkeleton columns={6} />}
              {!jobs.isLoading && (jobs.data ?? []).length === 0 && (
                <TableEmptyState columns={6} message="No jobs have been logged for this site yet." />
              )}
              {(jobs.data ?? []).map((j) => (
                <tr key={j.id}>
                  <td><Link to={`/jobs/${j.id}`}>#{j.job_no}</Link></td>
                  <td>{j.job_date}</td>
                  <td>{j.call_type}</td>
                  <td>{j.engineer_name
                    ? <span className="person-cell"><Avatar name={j.engineer_name} />{j.engineer_name}</span>
                    : 'Not assigned'}</td>
                  <td><StatusBadge status={j.handover_status} /></td>
                  <td><StatusBadge status={j.final_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editingSite && (
        <SiteForm
          site={s}
          onClose={() => {
            setEditingSite(false)
            void qc.invalidateQueries({ queryKey: ['site', siteId] })
            void qc.invalidateQueries({ queryKey: ['sites'] })
          }}
        />
      )}
    </>
  )
}
