import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
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

function coordinatesFromMapLink(value: string): { latitude: number; longitude: number } | null {
  const pinned = value.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i)
  if (pinned) {
    return { latitude: Number(pinned[1]), longitude: Number(pinned[2]) }
  }

  const pair = /(-?\d+(?:\.\d+)?)\s*(?:,|%2c)\s*(-?\d+(?:\.\d+)?)/i
  const matchPair = (text: string) => {
    const match = text.match(pair)
    return match ? { latitude: Number(match[1]), longitude: Number(match[2]) } : null
  }

  try {
    const url = new URL(value)
    for (const key of ['query', 'q', 'll', 'center']) {
      const coordinates = matchPair(url.searchParams.get(key) ?? '')
      if (coordinates) return coordinates
    }
  } catch {
    // Continue with coordinate formats that do not require a fully qualified URL.
  }

  const viewport = value.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)
  if (viewport) {
    return { latitude: Number(viewport[1]), longitude: Number(viewport[2]) }
  }
  return null
}

interface ReverseGeocodeResult {
  address?: {
    state?: string
    state_district?: string
    region?: string
    province?: string
  }
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
  const [mapLink, setMapLink] = useState('')
  const [locationLookup, setLocationLookup] = useState('')
  const [lookingUpLocation, setLookingUpLocation] = useState(false)
  const locationRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => () => locationRequest.current?.abort(), [])

  async function extractLocation(value: string) {
    locationRequest.current?.abort()
    const controller = new AbortController()
    locationRequest.current = controller
    setLookingUpLocation(false)
    setLocationLookup('')

    const coordinates = coordinatesFromMapLink(value.trim())
    if (!coordinates) {
      setLocationLookup('Could not find coordinates in that map link. Paste a Google Maps link with a location pin.')
      return
    }
    if (coordinates.latitude < 6 || coordinates.latitude > 38 || coordinates.longitude < 68 || coordinates.longitude > 98) {
      setLocationLookup('The map coordinates are outside India. Check the link or enter the location manually.')
      return
    }

    setLat(String(coordinates.latitude))
    setLng(String(coordinates.longitude))
    setStateName('')
    setLookingUpLocation(true)
    setLocationLookup('Coordinates found. Looking up state...')

    try {
      const params = new URLSearchParams({
        format: 'jsonv2',
        lat: String(coordinates.latitude),
        lon: String(coordinates.longitude),
        zoom: '10',
        addressdetails: '1',
      })
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error('Reverse lookup failed')
      const result = await response.json() as ReverseGeocodeResult
      if (controller.signal.aborted) return

      const candidates = [
        result.address?.state,
        result.address?.state_district,
        result.address?.region,
        result.address?.province,
      ].filter((candidate): candidate is string => !!candidate)
      const match = (states.data ?? []).find((state) =>
        candidates.some((candidate) => candidate.toLocaleLowerCase() === state.name.toLocaleLowerCase()),
      )
      if (!match) {
        setLocationLookup('Coordinates found, but the state could not be matched. Please select the state manually.')
        return
      }

      setStateName(match.name)
      setLocationLookup(`Location found: ${match.name}`)
    } catch (lookupError) {
      if (controller.signal.aborted) return
      setLocationLookup(
        lookupError instanceof Error && lookupError.message !== 'Reverse lookup failed'
          ? `Could not look up the state: ${lookupError.message}. Select the state manually.`
          : 'Coordinates found, but state lookup failed. Select the state manually.',
      )
    } finally {
      if (!controller.signal.aborted) setLookingUpLocation(false)
    }
  }

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
    if (save.isPending || lookingUpLocation) return
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
          <div className="form-loading" aria-label="Loading form options">
            <span className="skeleton-bar" /><span className="skeleton-bar" /><span className="skeleton-bar" />
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="grid-form">
            <label>
              <span className="field-caption">Project <span className="field-required">*</span></span>
              <select
                aria-required="true"
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
              <span className="field-caption">Project type <span className="field-required">*</span></span>
              <select aria-required="true" value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={!projectId}>
                <option value="">{projectId ? 'Select type' : 'Choose a project first'}</option>
                {typeOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="field-caption">Branch code <span className="field-required">*</span></span>
              <input aria-required="true" value={branchCode} onChange={(e) => setBranchCode(e.target.value)} maxLength={60} />
            </label>

            <label>
              <span className="field-caption">Branch name <span className="field-optional">Optional</span></span>
              <input value={branchName} onChange={(e) => setBranchName(e.target.value)} maxLength={120} />
            </label>

            <div className="full">
              <label htmlFor="site-map-link">
                <span className="field-caption">Google Maps link <span className="field-optional">Optional</span></span>
                <input
                  id="site-map-link"
                  type="url"
                  value={mapLink}
                  onChange={(e) => setMapLink(e.target.value)}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData('text').trim()
                    if (!pasted) return
                    e.preventDefault()
                    setMapLink(pasted)
                    void extractLocation(pasted)
                  }}
                  placeholder="Paste a Google Maps link to fill location details"
                  disabled={lookingUpLocation}
                />
              </label>
              <div className="row site-map-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void extractLocation(mapLink)}
                  disabled={!mapLink.trim() || lookingUpLocation}
                >
                  {lookingUpLocation ? 'Looking up location...' : 'Extract location'}
                </button>
                {locationLookup && (
                  <span className={`hint ${locationLookup.startsWith('Location found:') ? 'ok' : locationLookup.startsWith('Coordinates found, but') || locationLookup.startsWith('Could not') || locationLookup.startsWith('The map') ? 'bad' : ''}`} role="status">
                    {locationLookup}
                  </span>
                )}
              </div>
            </div>

            <label>
              <span className="field-caption">State <span className="field-required">*</span></span>
              <select aria-required="true" value={stateName} onChange={(e) => setStateName(e.target.value)}>
                <option value="">Select state</option>
                {(states.data ?? []).map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="field-caption">Status <span className="field-required">*</span></span>
              <select value={status} onChange={(e) => setStatus(e.target.value as 'Active' | 'Inactive')}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </label>

            <label>
              <span className="field-caption">Latitude <span className="field-optional">Optional</span></span>
              <input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="22.483586" />
            </label>

            <label>
              <span className="field-caption">Longitude <span className="field-optional">Optional</span></span>
              <input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="72.801502" />
            </label>

            {error && <div className="banner error full form-error" role="alert">{error}</div>}

            <div className="actions full">
              <button type="button" className="secondary" onClick={onClose} disabled={save.isPending}>
                Cancel
              </button>
              <button type="submit" disabled={save.isPending || lookingUpLocation}>
                {lookingUpLocation ? 'Looking up location...' : save.isPending ? 'Saving...' : 'Save site'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
