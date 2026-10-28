import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Device } from '../lib/device-types'

interface Props {
  siteId: string
  device: Device | null // null = adding a new device
  onClose: () => void
}

function friendlyError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code
  if (code === '23505') return 'An active device with this SIM number or MAC ID already exists.'
  if (code === '42501') return 'You do not have permission to do this.'
  return 'Could not save the device. Please try again.'
}

const FIELDS: { key: keyof Device; label: string }[] = [
  { key: 'sim_name', label: 'SIM name (e.g. JIO, JIOM2M)' },
  { key: 'sim_number', label: 'SIM number' },
  { key: 'link_ip', label: 'Link IP' },
  { key: 'link_mac_id', label: 'Link device MAC ID' },
  { key: 'vault_tam', label: 'Vault TAM' },
  { key: 'cash_counter_tam', label: 'Cash counter TAM' },
  { key: 'main_door_tam', label: 'Main door TAM' },
  { key: 'ngl_main_door_tam', label: 'NGL main door TAM' },
]

export default function DeviceForm({ siteId, device, onClose }: Props) {
  const qc = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, (device?.[f.key] as string | null) ?? ''])),
  )
  const [status, setStatus] = useState<'Active' | 'Replaced'>(device?.device_status ?? 'Active')
  const [notes, setNotes] = useState(device?.notes ?? '')
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { error: dbError } = device
        ? await supabase.from('devices').update(payload).eq('id', device.id)
        : await supabase.from('devices').insert({ ...payload, site_id: siteId })
      if (dbError) throw dbError
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devices', 'by-site', siteId] })
      onClose()
    },
    onError: (err) => setError(friendlyError(err)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (save.isPending) return
    setError('')

    const sim = values.sim_number.trim()
    if (sim && !/^[0-9]{18,22}$/.test(sim)) {
      return setError('SIM number must be 18 to 22 digits, with no spaces or symbols. Leave blank if unknown.')
    }

    const payload: Record<string, unknown> = { device_status: status, notes: notes.trim() || null }
    for (const f of FIELDS) payload[f.key] = values[f.key].trim() || null
    save.mutate(payload)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={device ? 'Edit device' : 'Add device'}>
        <h2>{device ? 'Edit device' : 'Add device'}</h2>
        <form onSubmit={submit} noValidate className="grid-form">
          {FIELDS.map((f) => (
            <label key={f.key}>
              <span className="field-caption">{f.label} <span className="field-optional">Optional</span></span>
              <input
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                maxLength={120}
              />
            </label>
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
              {save.isPending ? 'Saving...' : device ? 'Save changes' : 'Add device'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
