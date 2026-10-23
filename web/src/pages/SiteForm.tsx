import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useProjects, useProjectTypes, useStates } from '../lib/queries'
import type { Site } from '../lib/types'

interface Props {
  site: Site | null // null = adding a new site
  onClose: () => void
}

function friendlyError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code
  if (code === '23505') return 'A site with this Branch Code already exists in this project.'
  if (code === '23514') return 'One of the values is not allowed. Check the branch code and the coordinates.'
  if (code === '23503') return 'The project, type or state you picked is no longer valid. Reload the page and try again.'
  if (code === '42501') return 'You do not have permission to do this.'
  return 'Could not save the site. Please try again.'
}

function parseCoord(text: string): number | null {
  const t = text.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

export default function SiteForm({ site, onClose }: Props) {
  const qc = useQueryClient()
  const projects = useProjects()
  const types = useProjectTypes()
  const states = useStates()

  const [projectId, setProjectId] = useState(site?.project_id ?? '')
  const [typeId, setTypeId] = useState(site?.project_type_id ?? '')
  const [branchCode, setBranchCode] = useState(site?.branch_code ?? '')
  const [branchName, setBranchName] = useState(site?.branch_name ?? '')
  const [stateName, setStateName] = useState(site?.state ?? '')
  const [lat, setLat] = useState(site?.latitude != null ? String(site.latitude) : '')
  const [lng, setLng] = useState(site?.longitude != null ? String(site.longitude) : '')
  const [status, setStatus] = useState<'Active' | 'Inactive'>(site?.status ?? 'Active')
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const typeOptions = useMemo(
    () => (types.data ?? []).filter((t) => t.project_id === projectId && (t.is_active || t.id === typeId)),
    [types.data, projectId, typeId],
  )

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { error: dbError } = site
        ? await supabase.from('sites').update(payload).eq('id', site.id)
        : await supabase.from('sites').insert(payload)
      if (dbError) throw dbError
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sites'] })
      onClose()
    },
    onError: (err) => setError(friendlyError(err)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (save.isPending) return
    setError('')

    const code = branchCode.trim()
    if (!projectId) return setError('Choose a project.')
    if (!typeId) return setError('Choose a project type.')
    if (!code) return setError('Enter the Branch Code.')
    if (!stateName) return setError('Choose a state.')

    const latitude = parseCoord(lat)
    const longitude = parseCoord(lng)
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return setError('Latitude and longitude must be numbers.')
    if ((latitude === null) !== (longitude === null)) return setError('Enter both latitude and longitude, or leave both empty.')
    if (latitude !== null && (latitude < 6 || latitude > 38)) return setError('Latitude must be between 6 and 38 (India).')
    if (longitude !== null && (longitude < 68 || longitude > 98)) return setError('Longitude must be between 68 and 98 (India).')

    save.mutate({
      project_id: projectId,
      project_type_id: typeId,
      branch_code: code,
      branch_name: branchName.trim() || null,
      state: stateName,
      latitude,
      longitude,
      status,
    })
  }

  const loading = projects.isLoading || types.isLoading || states.isLoading

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={site ? 'Edit site' : 'Add site'}>
        <h2>{site ? 'Edit site' : 'Add site'}</h2>
        {loading ? (
          <p className="muted">Loading...</p>
        ) : (
          <form onSubmit={submit} noValidate className="grid-form">
            <label>
              Project
              <select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value)
                  setTypeId('')
                }}
              >
                <option value="">Select project</option>
                {(projects.data ?? [])
                  .filter((p) => p.is_active || p.id === projectId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              Project type
              <select value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={!projectId}>
                <option value="">{projectId ? 'Select type' : 'Choose a project first'}</option>
                {typeOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Branch code
              <input value={branchCode} onChange={(e) => setBranchCode(e.target.value)} maxLength={60} />
            </label>

            <label>
              Branch name (optional)
              <input value={branchName} onChange={(e) => setBranchName(e.target.value)} maxLength={120} />
            </label>

            <label>
              State
              <select value={stateName} onChange={(e) => setStateName(e.target.value)}>
                <option value="">Select state</option>
                {(states.data ?? []).map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as 'Active' | 'Inactive')}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </label>

            <label>
              Latitude (optional)
              <input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="22.483586" />
            </label>

            <label>
              Longitude (optional)
              <input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="72.801502" />
            </label>

            {error && <div className="banner error full">{error}</div>}

            <div className="actions full">
              <button type="button" className="secondary" onClick={onClose} disabled={save.isPending}>
                Cancel
              </button>
              <button type="submit" disabled={save.isPending}>
                {save.isPending ? 'Saving...' : 'Save site'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
