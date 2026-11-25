import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProjects, useProjectTypes, useStates } from '../lib/queries'
import { useAuth } from '../auth/auth-context'
import type { Site } from '../lib/types'
import Icon from '../components/Icon'
import StatusBadge from '../components/StatusBadge'
import { TestDataBadge, TestDataFilter, TestDataToggle, type DummyFilter } from '../components/TestDataControls'
import Pagination from '../components/Pagination'
import { TableEmptyState, TableSkeleton } from '../components/TableStates'
import SiteImportPreview, {
  type SiteImportIssue,
  type SiteImportPreviewRow,
  type SiteImportResult,
} from '../components/SiteImportPreview'
import { matchReference } from '../lib/import/referenceMatcher.ts'
import {
  isSiteImportRowImportable,
  resolveSiteImportState,
} from '../lib/import/resolveSiteImportState.ts'
import { STATE_ALIASES } from '../lib/import/stateAliases.ts'
import SiteForm from './SiteForm'

const PAGE_SIZE = 25
const MAX_UPLOAD_BYTES = 55 * 1024 * 1024
const REQUIRED_SITE_HEADERS = ['Project Name', 'Branch Code', 'Branch Name', 'State'] as const

interface SiteImportRow extends SiteImportPreviewRow {
  projectId: string
  branchName: string
}

interface SiteImportPreviewData {
  fileName: string
  totalRows: number
  validRows: number
  rows: SiteImportRow[]
  issues: SiteImportIssue[]
  result: SiteImportResult | null
}

function getImportErrorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }
  return null
}

function getImportErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return 'Unknown database error.'
}

async function fetchExistingSiteKeys(projectIds: string[]): Promise<Set<string>> {
  const existingKeys = new Set<string>()
  if (projectIds.length === 0) return existingKeys

  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('sites')
      .select('project_id, branch_code')
      .in('project_id', projectIds)
      .range(offset, offset + 999)
    if (error) throw error
    for (const site of data ?? []) {
      existingKeys.add(`${site.project_id}\u0000${site.branch_code}`)
    }
    if (!data || data.length < 1000) break
  }

  return existingKeys
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
  const [dummyFilter, setDummyFilter] = useState<DummyFilter>('real')
  const [actionError, setActionError] = useState('')
  const [editing, setEditing] = useState<Site | null>(null)
  const [adding, setAdding] = useState(false)
  const [preparingPreview, setPreparingPreview] = useState(false)
  const [importingSites, setImportingSites] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [siteImportPreview, setSiteImportPreview] = useState<SiteImportPreviewData | null>(null)
  const siteUploadInput = useRef<HTMLInputElement>(null)
  const siteImportInProgress = useRef(false)
  const importCompleted = Boolean(siteImportPreview?.result)

  const toggleTestData = useMutation({
    mutationFn: async ({ id, is_dummy }: { id: string; is_dummy: boolean }) => {
      const { error } = await supabase.from('sites').update({ is_dummy }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      setActionError('')
      void queryClient.invalidateQueries({ queryKey: ['sites'] })
    },
    onError: (error: Error) => setActionError(error.message),
  })

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

  async function previewSiteFile(file: File) {
    setUploadError('')
    setSiteImportPreview(null)
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
    if (!states.data || states.isLoading || states.isError || states.data.length === 0) {
      setUploadError('Could not load canonical states. Refresh the page before previewing sites.')
      return
    }

    setPreparingPreview(true)
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
      const canonicalStates = states.data.map((state) => state.name)
      const issues: SiteImportIssue[] = []
      const importRows: SiteImportRow[] = []
      let totalRows = 0

      rows.slice(1).forEach((cells, index) => {
        const originalValues = columnIndexes.map((columnIndex) =>
          String(cells[columnIndex] ?? ''),
        )
        const values = originalValues.map((value) => value.trim())
        if (values.every((value) => value === '')) return
        totalRows += 1
        const rowNumber = index + 2
        const [projectName, branchCode, branchName] = values
        const missingValues = REQUIRED_SITE_HEADERS.filter((_, columnIndex) => !values[columnIndex])
        if (missingValues.length > 0) {
          issues.push({ row: rowNumber, reason: `missing ${missingValues.join(', ')}` })
          return
        }
        const projectId = projectIds.get(projectName.toLocaleLowerCase())
        if (!projectId) {
          issues.push({ row: rowNumber, reason: `project '${projectName}' not found` })
          return
        }
        importRows.push({
          row: rowNumber,
          projectId,
          branchCode,
          branchName,
          originalState: originalValues[3],
          stateMatch: matchReference(originalValues[3], canonicalStates, {
            aliases: STATE_ALIASES,
          }),
          duplicate: false,
          reviewDecision: 'pending',
          selectedState: '',
        })
      })

      const uniqueProjectIds = [...new Set(importRows.map((row) => row.projectId))]
      const existingKeys = await fetchExistingSiteKeys(uniqueProjectIds)

      const previewRows = importRows.map((row) => {
        const key = `${row.projectId}\u0000${row.branchCode}`
        const duplicate = existingKeys.has(key)
        existingKeys.add(key)
        return { ...row, duplicate }
      })

      setSiteImportPreview({
        fileName: file.name,
        totalRows,
        validRows: importRows.length,
        rows: previewRows,
        issues,
        result: null,
      })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not prepare the site preview.')
    } finally {
      setPreparingPreview(false)
    }
  }

  function updatePreviewRow(
    rowNumber: number,
    update: (row: SiteImportRow) => SiteImportRow,
  ) {
    setSiteImportPreview((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) => (row.row === rowNumber ? update(row) : row)),
          }
        : current,
    )
  }

  function acceptFuzzySuggestion(rowNumber: number) {
    updatePreviewRow(rowNumber, (row) =>
      row.stateMatch.status === 'suggestion'
        ? {
            ...row,
            reviewDecision: 'accepted',
            selectedState: row.stateMatch.suggestedValue,
          }
        : row,
    )
  }

  function rejectPreviewReview(rowNumber: number) {
    updatePreviewRow(rowNumber, (row) => ({
      ...row,
      reviewDecision: 'rejected',
      selectedState: '',
    }))
  }

  function selectAmbiguousCandidate(rowNumber: number, selectedState: string) {
    updatePreviewRow(rowNumber, (row) =>
      row.stateMatch.status === 'ambiguous'
        ? { ...row, selectedState }
        : row,
    )
  }

  function confirmAmbiguousCandidate(rowNumber: number) {
    updatePreviewRow(rowNumber, (row) =>
      row.stateMatch.status === 'ambiguous' &&
      row.stateMatch.candidates.includes(row.selectedState)
        ? { ...row, reviewDecision: 'accepted' }
        : row,
    )
  }

  function resetPreviewReview(rowNumber: number) {
    updatePreviewRow(rowNumber, (row) => ({
      ...row,
      reviewDecision: 'pending',
      selectedState: '',
    }))
  }

  async function confirmSiteImport() {
    const preview = siteImportPreview
    if (!preview || preview.result || siteImportInProgress.current) return

    const candidates = preview.rows.flatMap((row) => {
      const state = resolveSiteImportState(row)
      return isSiteImportRowImportable(row) && state ? [{ row, state }] : []
    })
    if (candidates.length === 0) return

    siteImportInProgress.current = true
    setImportingSites(true)
    setUploadError('')

    let inserted = 0
    let failed = 0
    const insertPayload = (row: SiteImportRow, state: string) => ({
      project_id: row.projectId,
      project_type_id: null,
      branch_code: row.branchCode,
      branch_name: row.branchName,
      state,
      status: 'Active',
      latitude: null,
      longitude: null,
    })

    try {
      let existingKeys: Set<string>
      try {
        existingKeys = await fetchExistingSiteKeys([
          ...new Set(candidates.map(({ row }) => row.projectId)),
        ])
      } catch (error) {
        setUploadError(
          `Could not re-check existing site codes. No sites were imported. ${getImportErrorMessage(error)}`,
        )
        return
      }

      const lateDuplicateRows: SiteImportRow[] = []
      const candidatesToInsert = candidates.filter(({ row }) => {
        const key = `${row.projectId}\u0000${row.branchCode}`
        if (existingKeys.has(key)) {
          lateDuplicateRows.push(row)
          return false
        }
        existingKeys.add(key)
        return true
      })
      const duplicateRows = [
        ...preview.rows.filter((row) => row.duplicate),
        ...lateDuplicateRows,
      ]
      const duplicateRowNumbers = new Set(duplicateRows.map((row) => row.row))
      const unresolvedRows = preview.rows.filter(
        (row) =>
          !duplicateRowNumbers.has(row.row) && resolveSiteImportState(row) === null,
      )
      const details: SiteImportIssue[] = [
        ...preview.issues,
        ...duplicateRows.map((row) => ({
          row: row.row,
          reason: `duplicate Branch Code '${row.branchCode}' in this project`,
        })),
        ...unresolvedRows.map((row) => ({
          row: row.row,
          reason: `state '${row.originalState}' is unresolved`,
        })),
      ]
      let duplicates = duplicateRows.length

      for (let offset = 0; offset < candidatesToInsert.length; offset += 100) {
        const batch = candidatesToInsert.slice(offset, offset + 100)
        let batchError: unknown = null

        try {
          const { error } = await supabase
            .from('sites')
            .insert(batch.map(({ row, state }) => insertPayload(row, state)))
          batchError = error
        } catch (error) {
          batchError = error
        }

        if (batchError === null) {
          inserted += batch.length
          continue
        }

        for (const candidate of batch) {
          try {
            const { error } = await supabase
              .from('sites')
              .insert(insertPayload(candidate.row, candidate.state))
            if (!error) {
              inserted += 1
            } else if (getImportErrorCode(error) === '23505') {
              duplicates += 1
              duplicateRowNumbers.add(candidate.row.row)
              details.push({
                row: candidate.row.row,
                reason: `duplicate Branch Code '${candidate.row.branchCode}' in this project`,
              })
            } else {
              failed += 1
              details.push({
                row: candidate.row.row,
                reason: `could not create site: ${getImportErrorMessage(error)}`,
              })
            }
          } catch (error) {
            failed += 1
            details.push({
              row: candidate.row.row,
              reason: `could not create site: ${getImportErrorMessage(error)}`,
            })
          }
        }
      }

      const result: SiteImportResult = {
        inserted,
        failed,
        skipped: preview.issues.length + unresolvedRows.length,
        duplicates,
        details,
      }
      setSiteImportPreview((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((row) =>
                duplicateRowNumbers.has(row.row) ? { ...row, duplicate: true } : row,
              ),
              result,
            }
          : current,
      )

      if (candidatesToInsert.length > 0 || lateDuplicateRows.length > 0) {
        try {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['sites'] }),
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }),
            queryClient.invalidateQueries({ queryKey: ['project-dashboard'] }),
            queryClient.invalidateQueries({ queryKey: ['project-range-breakdown'] }),
          ])
        } catch (error) {
          setUploadError(
            `Import completed, but refreshed counts could not be loaded: ${getImportErrorMessage(error)}`,
          )
        }
      }
    } catch (error) {
      setUploadError(
        inserted > 0
          ? `Import stopped after ${inserted} site(s) were inserted. Refresh the preview before retrying. ${getImportErrorMessage(error)}`
          : `Import could not be completed. No sites were imported. ${getImportErrorMessage(error)}`,
      )
    } finally {
      siteImportInProgress.current = false
      setImportingSites(false)
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
    queryKey: ['sites', { page, search, projectId, stateName, status, dummyFilter, isAdmin }],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase
        .from('sites')
        .select('id, project_id, project_type_id, branch_code, branch_name, state, latitude, longitude, status, is_dummy', {
          count: 'exact',
        })
        .is('deleted_at', null)

      const clean = search.replace(/[,()*%\\"]/g, ' ').trim()
      if (clean) q = q.or(`branch_code.ilike.*${clean}*,branch_name.ilike.*${clean}*`)
      if (projectId) q = q.eq('project_id', projectId)
      if (stateName) q = q.eq('state', stateName)
      if (status) q = q.eq('status', status)
      if (isAdmin && dummyFilter !== 'all') q = q.eq('is_dummy', dummyFilter === 'test')

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
                  disabled={preparingPreview || importingSites || importCompleted}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (file) void previewSiteFile(file)
                  }}
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={preparingPreview || importingSites || importCompleted}
                  onClick={() => siteUploadInput.current?.click()}
                >
                  {preparingPreview ? 'Preparing preview...' : 'Preview sites (Excel)'}
                </button>
                <button type="button" className="link" disabled={preparingPreview || importingSites} onClick={() => void downloadSiteTemplate()}>
                  Download template
                </button>
              </>
            )}
            <button onClick={() => setAdding(true)}><Icon name="plus" size={17} />Add site</button>
          </div>
        </div>

        {uploadError && <div className="banner error" role="alert">{uploadError}</div>}

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
          {isAdmin && (
            <TestDataFilter
              value={dummyFilter}
              onChange={(value) => {
                setDummyFilter(value)
                setPage(0)
              }}
            />
          )}
        </div>

        {actionError && <div className="banner error" role="alert">{actionError}</div>}
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
                  <td><Link to={`/sites/${s.id}`}>{s.branch_code}</Link>{s.is_dummy && <TestDataBadge />}</td>
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
                    {isAdmin && (
                      <TestDataToggle
                        checked={s.is_dummy}
                        disabled={toggleTestData.isPending}
                        itemName={s.branch_code}
                        onChange={(is_dummy) => toggleTestData.mutate({ id: s.id, is_dummy })}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination currentPage={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} disabled={sites.isFetching} itemLabel="sites" />
      </section>

      {siteImportPreview && (
        <SiteImportPreview
          fileName={siteImportPreview.fileName}
          totalRows={siteImportPreview.totalRows}
          validRows={siteImportPreview.validRows}
          rows={siteImportPreview.rows}
          issues={siteImportPreview.issues}
          result={siteImportPreview.result}
          importing={importingSites}
          onConfirmImport={() => void confirmSiteImport()}
          onAcceptSuggestion={acceptFuzzySuggestion}
          onRejectReview={rejectPreviewReview}
          onSelectCandidate={selectAmbiguousCandidate}
          onConfirmCandidate={confirmAmbiguousCandidate}
          onResetReview={resetPreviewReview}
          onClose={() => setSiteImportPreview(null)}
        />
      )}
      {adding && <SiteForm site={null} onClose={() => setAdding(false)} />}
      {editing && <SiteForm site={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
