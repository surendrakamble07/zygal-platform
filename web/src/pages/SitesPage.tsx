import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProjects, useProjectTypes, useStates } from '../lib/queries'
import { useAuth } from '../auth/auth-context'
import type { Site } from '../lib/types'
import Icon from '../components/Icon'
import StatusBadge from '../components/StatusBadge'
import Pagination from '../components/Pagination'
import { TableEmptyState, TableSkeleton } from '../components/TableStates'
import SiteForm from './SiteForm'

const PAGE_SIZE = 25
const MAX_UPLOAD_BYTES = 55 * 1024 * 1024
const REQUIRED_SITE_HEADERS = ['Project Name', 'Branch Code', 'Branch Name', 'State'] as const

interface ImportIssue {
  row: number
  reason: string
}

interface ImportSummary {
  created: number
  skipped: number
  issues: ImportIssue[]
}

interface SiteImportRow {
  row: number
  project_id: string
  branch_code: string
  branch_name: string
  state: string
}

export default function SitesPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const projects = useProjects()
  const types = useProjectTypes()
  const states = useStates()
  const isAdmin = profile?.role === 'admin'

  const [page, setPage] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [projectId, setProjectId] = useState('')
  const [stateName, setStateName] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<Site | null>(null)
  const [adding, setAdding] = useState(false)
  const [uploadingSites, setUploadingSites] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const siteUploadInput = useRef<HTMLInputElement>(null)

  async function downloadSiteTemplate() {
    setUploadError('')
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.utils.book_new()
      const worksheet = XLSX.utils.aoa_to_sheet([[...REQUIRED_SITE_HEADERS]])
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sites')
      XLSX.writeFile(workbook, 'zygal-sites-template.xlsx')
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not create the Excel template.')
    }
  }

  async function importSiteFile(file: File) {
    setUploadError('')
    setImportSummary(null)
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError('The Excel file must be 55 MB or smaller.')
      return
    }
    if (!file.name.toLocaleLowerCase().endsWith('.xlsx')) {
      setUploadError('Choose an .xlsx Excel file.')
      return
    }
    if (!projects.data || projects.isLoading || projects.isError) {
      setUploadError('Could not load projects. Refresh the page before importing sites.')
      return
    }

    setUploadingSites(true)
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const firstSheetName = workbook.SheetNames[0]
      if (!firstSheetName) throw new Error('The workbook does not contain a worksheet.')

      const worksheet = workbook.Sheets[firstSheetName]
      const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: '',
        raw: false,
      }) as unknown[][]
      if (rows.length === 0) throw new Error('The worksheet is empty.')

      const headerNames = rows[0].map((cell) => String(cell ?? '').trim().toLocaleLowerCase())
      const columnIndexes = REQUIRED_SITE_HEADERS.map((name) =>
        headerNames.indexOf(name.toLocaleLowerCase()),
      )
      const missingHeaders = REQUIRED_SITE_HEADERS.filter(
        (_, index) => columnIndexes[index] === -1,
      )
      if (missingHeaders.length > 0) {
        throw new Error(`Missing required column${missingHeaders.length > 1 ? 's' : ''}: ${missingHeaders.join(', ')}.`)
      }

      const projectIds = new Map(
        projects.data.map((project) => [project.name.trim().toLocaleLowerCase(), project.id]),
      )
      const skippedRows: ImportIssue[] = []
      let skipped = 0
      let created = 0
      const skip = (row: number, reason: string) => {
        skipped += 1
        if (skippedRows.length < 20) skippedRows.push({ row, reason })
      }
      const importRows: SiteImportRow[] = []

      rows.slice(1).forEach((cells, index) => {
        const values = columnIndexes.map((columnIndex) => String(cells[columnIndex] ?? '').trim())
        if (values.every((value) => value === '')) return
        const rowNumber = index + 2
        const [projectName, branchCode, branchName, state] = values
        const missingValues = REQUIRED_SITE_HEADERS.filter((_, columnIndex) => !values[columnIndex])
        if (missingValues.length > 0) {
          skip(rowNumber, `missing ${missingValues.join(', ')}`)
          return
        }
        const projectId = projectIds.get(projectName.toLocaleLowerCase())
        if (!projectId) {
          skip(rowNumber, `project '${projectName}' not found`)
          return
        }
        importRows.push({
          row: rowNumber,
          project_id: projectId,
          branch_code: branchCode,
          branch_name: branchName,
          state,
        })
      })

      const existingKeys = new Set<string>()
      const uniqueProjectIds = [...new Set(importRows.map((row) => row.project_id))]
      if (uniqueProjectIds.length > 0) {
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await supabase
            .from('sites')
            .select('project_id, branch_code')
            .in('project_id', uniqueProjectIds)
            .range(offset, offset + 999)
          if (error) throw error
          for (const site of data ?? []) {
            existingKeys.add(`${site.project_id}\u0000${site.branch_code}`)
          }
          if (!data || data.length < 1000) break
        }
      }

      const candidates: SiteImportRow[] = []
      for (const row of importRows) {
        const key = `${row.project_id}\u0000${row.branch_code}`
        if (existingKeys.has(key)) {
          skip(row.row, `duplicate Branch Code '${row.branch_code}' in this project`)
        } else {
          existingKeys.add(key)
          candidates.push(row)
        }
      }

      const insertRow = (row: SiteImportRow) => ({
        project_id: row.project_id,
        project_type_id: null,
        branch_code: row.branch_code,
        branch_name: row.branch_name,
        state: row.state,
        status: 'Active',
        latitude: null,
        longitude: null,
      })
      for (let offset = 0; offset < candidates.length; offset += 100) {
        const batch = candidates.slice(offset, offset + 100)
        const { error } = await supabase.from('sites').insert(batch.map(insertRow))
        if (!error) {
          created += batch.length
          continue
        }
        for (const row of batch) {
          const { error: rowError } = await supabase.from('sites').insert(insertRow(row))
          if (!rowError) {
            created += 1
          } else if (rowError.code === '23505') {
            skip(row.row, `duplicate Branch Code '${row.branch_code}' in this project`)
          } else {
            skip(row.row, `could not create site: ${rowError.message}`)
          }
        }
      }

      setImportSummary({ created, skipped, issues: skippedRows })
      if (created > 0) await queryClient.invalidateQueries({ queryKey: ['sites'] })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not import the Excel file.')
    } finally {
      setUploadingSites(false)
    }
  }

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
  return (
    <>
      <section className="card">
        <div className="head-row">
          <h2>Sites</h2>
          <div className="actions">
            {isAdmin && (
              <>
                <input
                  ref={siteUploadInput}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  hidden
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (file) void importSiteFile(file)
                  }}
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={uploadingSites}
                  onClick={() => siteUploadInput.current?.click()}
                >
                  {uploadingSites ? 'Uploading...' : 'Upload sites (Excel)'}
                </button>
                <button type="button" className="link" disabled={uploadingSites} onClick={() => void downloadSiteTemplate()}>
                  Download template
                </button>
              </>
            )}
            <button onClick={() => setAdding(true)}><Icon name="plus" size={17} />Add site</button>
          </div>
        </div>

        {uploadError && <div className="banner error" role="alert">{uploadError}</div>}
        {importSummary && (
          <div className={`banner ${importSummary.skipped > 0 ? 'warn' : 'info'}`} role="status">
            <p>
              Import complete: {importSummary.created} sites created, {importSummary.skipped} skipped.
            </p>
            {importSummary.issues.length > 0 && (
              <>
                <ul>
                  {importSummary.issues.map((issue) => (
                    <li key={`${issue.row}-${issue.reason}`}>Row {issue.row}: {issue.reason}</li>
                  ))}
                </ul>
                {importSummary.skipped > importSummary.issues.length && (
                  <p>{importSummary.skipped - importSummary.issues.length} more skipped rows not shown.</p>
                )}
              </>
            )}
          </div>
        )}

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
                  <td>{s.project_type_id ? typeName.get(s.project_type_id) ?? '-' : '-'}</td>
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

        <Pagination currentPage={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} disabled={sites.isFetching} itemLabel="sites" />
      </section>

      {adding && <SiteForm site={null} onClose={() => setAdding(false)} />}
      {editing && <SiteForm site={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
