import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProjects, useProjectTypes, useStates } from '../lib/queries'
import type { Site } from '../lib/types'
import Icon from '../components/Icon'
import StatusBadge from '../components/StatusBadge'
import { TableEmptyState, TableSkeleton } from '../components/TableStates'
import SiteForm from './SiteForm'

const PAGE_SIZE = 25

export default function SitesPage() {
  const projects = useProjects()
  const types = useProjectTypes()
  const states = useStates()

  const [page, setPage] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [projectId, setProjectId] = useState('')
  const [stateName, setStateName] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<Site | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(0)
    }, 350)
    return () => window.clearTimeout(t)
  }, [searchInput])

  const projectName = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data])
  const typeName = useMemo(() => new Map((types.data ?? []).map((t) => [t.id, t.name])), [types.data])

  const sites = useQuery({
    queryKey: ['sites', { page, search, projectId, stateName, status }],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase
        .from('sites')
        .select('id, project_id, project_type_id, branch_code, branch_name, state, latitude, longitude, status', {
          count: 'exact',
        })
        .is('deleted_at', null)

      const clean = search.replace(/[,()*%\\"]/g, ' ').trim()
      if (clean) q = q.or(`branch_code.ilike.*${clean}*,branch_name.ilike.*${clean}*`)
      if (projectId) q = q.eq('project_id', projectId)
      if (stateName) q = q.eq('state', stateName)
      if (status) q = q.eq('status', status)

      const from = page * PAGE_SIZE
      const { data, count, error } = await q.order('branch_code').range(from, from + PAGE_SIZE - 1)
      if (error) throw error
      return { rows: (data ?? []) as Site[], total: count ?? 0 }
    },
  })

  const rows = sites.data?.rows ?? []
  const total = sites.data?.total ?? 0
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1
  const last = Math.min((page + 1) * PAGE_SIZE, total)
  const hasNext = (page + 1) * PAGE_SIZE < total

  return (
    <>
      <section className="card">
        <div className="head-row">
          <h2>Sites</h2>
          <button onClick={() => setAdding(true)}><Icon name="plus" size={17} />Add site</button>
        </div>

        <div className="filters">
          <input
            type="search"
            placeholder="Search branch code or name"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value)
              setPage(0)
            }}
          >
            <option value="">All projects</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={stateName}
            onChange={(e) => {
              setStateName(e.target.value)
              setPage(0)
            }}
          >
            <option value="">All states</option>
            {(states.data ?? []).map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(0)
            }}
          >
            <option value="">Any status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>

        {sites.isError && <div className="banner error">Could not load sites. Please refresh and try again.</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Branch code</th>
                <th>Branch name</th>
                <th>Project</th>
                <th>Type</th>
                <th>State</th>
                <th>Lat / Long</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sites.isLoading && <TableSkeleton columns={8} />}
              {!sites.isLoading && rows.length === 0 && (
                <TableEmptyState
                  columns={8}
                  message="No sites match these filters."
                  action={<button onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add a site</button>}
                />
              )}
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/sites/${s.id}`}>{s.branch_code}</Link></td>
                  <td>{s.branch_name ?? '-'}</td>
                  <td>{projectName.get(s.project_id) ?? '-'}</td>
                  <td>{typeName.get(s.project_type_id) ?? '-'}</td>
                  <td>{s.state ?? '-'}</td>
                  <td>{s.latitude != null && s.longitude != null ? `${s.latitude}, ${s.longitude}` : '-'}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td>
                    <button className="link icon-action" aria-label={`Edit ${s.branch_code}`} onClick={() => setEditing(s)}>
                      <Icon name="edit" size={16} />
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="head-row">
          <span className="muted small">
            {total === 0 ? '0 sites' : `Showing ${first}-${last} of ${total} sites`}
          </span>
          <div className="actions">
            <button className="secondary" disabled={page === 0 || sites.isFetching} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button className="secondary" disabled={!hasNext || sites.isFetching} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </div>
      </section>

      {adding && <SiteForm site={null} onClose={() => setAdding(false)} />}
      {editing && <SiteForm site={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
