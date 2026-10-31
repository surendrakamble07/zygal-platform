import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Device } from '../lib/device-types'

interface Props {
  siteId: string
  device: Device | null // null = adding a new device
  onClose: () => void
}

function friendlyError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code
  if (code === '23505') return 'An active SIM card with this number or MAC ID already exists.'
  if (code === '42501') return 'You do not have permission to do this.'
  return 'Could not save the SIM card. Please try again.'
}

const FIELDS: { key: keyof Device; label: string }[] = [
  { key: 'sim_name', label: 'SIM name (e.g. JIO, JIOM2M)' },
  { key: 'sim_number', label: 'SIM number' },
  { key: 'link_ip', label: 'Link IP' },
  { key: 'link_mac_id', label: 'Link MAC ID' },
  { key: 'vault_tam', label: 'Vault TAM' },
  { key: 'cash_counter_tam', label: 'Cash counter TAM' },
  { key: 'main_door_tam', label: 'Main door TAM' },
  { key: 'ngl_main_door_tam', label: 'NGL main door TAM' },
]

const MAX_PHOTO_SIZE = 5 * 1024 * 1024

export default function DeviceForm({ siteId, device, onClose }: Props) {
  const qc = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, (device?.[f.key] as string | null) ?? ''])),
  )
  const [status, setStatus] = useState<'Active' | 'Replaced'>(device?.device_status ?? 'Active')
  const [notes, setNotes] = useState(device?.notes ?? '')
  const [error, setError] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoPath = device?.sim_photo_path ?? null
  const savedPhoto = useQuery({
    queryKey: ['device-form-sim-photo', photoPath],
    enabled: !!photoPath,
    queryFn: async () => {
      if (!photoPath) throw new Error('No SIM photo is selected.')
      const { data, error: photoError } = await supabase.storage
        .from('sim-photos')
        .createSignedUrl(photoPath, 3600)
      if (photoError) throw photoError
      return data.signedUrl
    },
  })
  const photoPreview = useMemo(
    () => photoFile ? URL.createObjectURL(photoFile) : null,
    [photoFile],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
  }, [photoPreview])

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      let simPhotoPath: string | null | undefined
      if (photoFile) {
        const extension = photoFile.name.split('.').pop()?.toLowerCase()
        if (!extension || !/^[a-z0-9]{1,10}$/.test(extension)) {
          throw new Error('Could not determine the photo file type. Please choose an image file.')
        }
        const path = `${siteId}/${crypto.randomUUID()}.${extension}`
        setUploadingPhoto(true)
        try {
          const { error: uploadError } = await supabase.storage
            .from('sim-photos')
            .upload(path, photoFile, { contentType: photoFile.type || undefined })
          if (uploadError) {
            throw new Error(`Could not upload SIM photo: ${uploadError.message}`)
          }
        } finally {
          setUploadingPhoto(false)
        }
        simPhotoPath = path
      } else if (removePhoto) {
        simPhotoPath = null
      }

      const savePayload = simPhotoPath === undefined
        ? payload
        : { ...payload, sim_photo_path: simPhotoPath }
      const { error: dbError } = device
        ? await supabase.from('devices').update(savePayload).eq('id', device.id)
        : await supabase.from('devices').insert({ ...savePayload, site_id: siteId })
      if (dbError) throw dbError
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devices', 'by-site', siteId] })
      void qc.invalidateQueries({ queryKey: ['devices-all'] })
      onClose()
    },
    onError: (err) => setError(
      err instanceof Error && err.message.startsWith('Could not upload SIM photo:')
        ? err.message
        : friendlyError(err),
    ),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (save.isPending) return
    setError('')

    const sim = values.sim_number.trim()
    if (sim && !/^[0-9]{18,22}$/.test(sim)) {
      return setError('SIM number must be 18 to 22 digits, with no spaces or symbols. Leave blank if unknown.')
    }
    if (photoFile && photoFile.size > MAX_PHOTO_SIZE) {
      return setError('SIM photo must be 5 MB or smaller.')
    }

    const payload: Record<string, unknown> = { device_status: status, notes: notes.trim() || null }
    for (const f of FIELDS) payload[f.key] = values[f.key].trim() || null
    save.mutate(payload)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={device ? 'Edit SIM card' : 'Add SIM card'}>
        <h2>{device ? 'Edit SIM card' : 'Add SIM card'}</h2>
        <form onSubmit={submit} noValidate className="grid-form">
          {FIELDS.map((f) => (
            <Fragment key={f.key}>
              <label>
                <span className="field-caption">{f.key === 'link_mac_id' ? 'Link MAC ID' : f.label} <span className="field-optional">Optional</span></span>
                <input
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  maxLength={120}
                />
              </label>
              {f.key === 'sim_number' && (
                <div className="sim-photo-field">
                  <label htmlFor="sim-photo">
                    <span className="field-caption">SIM card photo <span className="field-optional">Optional</span></span>
                    <input
                      id="sim-photo"
                      type="file"
                      accept="image/*"
                      disabled={save.isPending}
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null
                        e.target.value = ''
                        if (file && file.size > MAX_PHOTO_SIZE) {
                          setPhotoFile(null)
                          setError('SIM photo must be 5 MB or smaller.')
                          return
                        }
                        setError('')
                        setPhotoFile(file)
                        setRemovePhoto(false)
                      }}
                    />
                  </label>
                  {(photoPreview || (!removePhoto && savedPhoto.data)) && (
                    <div className="sim-photo-preview-wrap">
                      <img
                        className="sim-photo-preview"
                        src={photoPreview ?? savedPhoto.data}
                        alt="SIM card photo preview"
                      />
                      {device?.sim_photo_path && !removePhoto && (
                        <button
                          type="button"
                          className="link sim-photo-remove"
                          disabled={save.isPending}
                          onClick={() => {
                            setPhotoFile(null)
                            setRemovePhoto(true)
                          }}
                        >
                          Remove photo
                        </button>
                      )}
                    </div>
                  )}
                  {savedPhoto.isError && !photoFile && (
                    <span className="hint bad">Could not load the saved SIM photo.</span>
                  )}
                </div>
              )}
            </Fragment>
          ))}

          <label>
            <span className="field-caption">Status <span className="field-required">*</span></span>
            <select value={status} onChange={(e) => setStatus(e.target.value as 'Active' | 'Replaced')}>
              <option value="Active">Active</option>
              <option value="Replaced">Replaced</option>
            </select>
          </label>

          <label className="full">
            <span className="field-caption">Notes <span className="field-optional">Optional</span></span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          {error && <div className="banner error full form-error" role="alert">{error}</div>}

          <div className="actions full">
            <button type="button" className="secondary" onClick={onClose} disabled={save.isPending}>
              Cancel
            </button>
            <button type="submit" disabled={save.isPending}>
              {uploadingPhoto ? 'Uploading...' : save.isPending ? 'Saving...' : device ? 'Save changes' : 'Add SIM card'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
