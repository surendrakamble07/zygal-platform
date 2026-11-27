import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import { supabase } from '../lib/supabase'
import { useProjects } from '../lib/queries'
import { callProvision } from '../lib/user-queries'
import type { EmployeeRow, Role } from '../lib/user-types'

interface Props {
  employee: EmployeeRow | null
  onClose: () => void
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'support', label: 'Support' },
  { value: 'team_lead', label: 'Team Lead / Assistant Manager' },
  { value: 'admin', label: 'Admin' },
  { value: 'other', label: 'Limited' },
]

const PAGE_OPTIONS = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'sites', label: 'Sites' },
  { value: 'devices', label: 'SIM Cards' },
  { value: 'jobs', label: 'Jobs' },
  { value: 'notes', label: 'My Notes' },
  { value: 'reports', label: 'Reports' },
  { value: 'logs', label: 'Logs' },
  { value: 'users', label: 'Users' },
] as const

export default function UserForm({ employee, onClose }: Props) {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const projects = useProjects()
  const authorizedProjectQuery = useQuery({
    queryKey: ['profile-projects', employee?.id],
    enabled: profile?.role === 'admin' && !!employee?.id,
    queryFn: async () => {
      if (!employee?.id) return []
      const { data, error } = await supabase
        .from('profile_projects')
        .select('project_id')
        .eq('profile_id', employee.id)
      if (error) throw error
      return (data ?? []).map((row) => row.project_id as string)
    },
  })
  const [email, setEmail] = useState(employee?.email ?? '')
  const [fullName, setFullName] = useState(employee?.full_name ?? '')
  const [phone, setPhone] = useState(employee?.phone ?? '')
  const [role, setRole] = useState<Role>(employee?.role ?? 'support')
  const [jobTitle, setJobTitle] = useState(employee?.job_title ?? '')
  const [allowedPages, setAllowedPages] = useState<string[]>(() => employee?.allowed_pages ?? ['dashboard'])
  const [authorizedProjects, setAuthorizedProjects] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const selectedProjectIds = authorizedProjects ?? authorizedProjectQuery.data ?? []

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const limitedRolePages = useMemo(() => {
    if (role !== 'other') return []
    return allowedPages
  }, [allowedPages, role])

  function togglePage(page: string) {
    setAllowedPages((prev) => {
      if (prev.includes(page)) return prev.filter((value) => value !== page)
      return [...prev, page]
    })
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        action: employee ? 'update' : 'create',
        user_id: employee?.id,
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        role,
        job_title: jobTitle,
      }

      if (!employee) {
        payload.email = email.trim().toLowerCase()
      }

      if (role === 'other') {
        payload.allowed_pages = allowedPages
      }

      const result = await callProvision<{ ok: boolean; user_id?: string }>(payload)
      if (profile?.role === 'admin') {
        const profileId = employee?.id ?? result.user_id
        if (!profileId) throw new Error('The employee was saved, but their profile ID was not returned.')

        const { data: currentRows, error: currentError } = await supabase
          .from('profile_projects')
          .select('project_id')
          .eq('profile_id', profileId)
        if (currentError) throw currentError

        const currentIds = (currentRows ?? []).map((row) => row.project_id as string)
        const removedIds = currentIds.filter((projectId) => !selectedProjectIds.includes(projectId))
        const addedIds = selectedProjectIds.filter((projectId) => !currentIds.includes(projectId))
        if (removedIds.length) {
          const { error: deleteError } = await supabase
            .from('profile_projects')
            .delete()
            .eq('profile_id', profileId)
            .in('project_id', removedIds)
          if (deleteError) throw deleteError
        }
        if (addedIds.length) {
          const { error: insertError } = await supabase
            .from('profile_projects')
            .insert(addedIds.map((project_id) => ({ profile_id: profileId, project_id })))
          if (insertError) throw insertError
        }
      }
      return result
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employees'] })
      void qc.invalidateQueries({ queryKey: ['profile-projects'] })
      void qc.invalidateQueries({ queryKey: ['employee-project-names'] })
      onClose()
    },
    onError: (err: Error) => setError(err.message),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (save.isPending) return
    setError('')
    if (!employee && !email.trim().includes('@'))
      return setError('Enter a valid office email.')
    if (!fullName.trim()) return setError('Enter the full name.')
    if (role === 'other' && limitedRolePages.length === 0) {
      return setError('Select at least one page for the Limited role.')
    }
    save.mutate()
  }

  return (
    <div
      className='modal-backdrop'
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className='modal'
        role='dialog'
        aria-modal='true'
        aria-label={employee ? 'Edit employee' : 'Add employee'}
      >
        <h2>{employee ? 'Edit employee' : 'Add employee'}</h2>
        <form onSubmit={submit} noValidate className='grid-form'>
          <label className={employee ? 'full' : ''}>
            <span className='field-caption'>Office email {!employee && <span className='field-required'>*</span>}</span>
            <input
              aria-required={!employee}
              type='email'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!!employee}
              placeholder='name@zygal.io'
            />
            {employee && <span className='hint'>Email cannot be changed here.</span>}
          </label>

          <label className={employee ? 'full' : ''}>
            <span className='field-caption'>Full name <span className='field-required'>*</span></span>
            <input
              aria-required='true'
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={120}
            />
          </label>

          <label>
            <span className='field-caption'>Mobile number <span className='field-optional'>Optional</span></span>
            <input
              type='tel'
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
            />
          </label>

          <label>
            <span className='field-caption'>Role <span className='field-required'>*</span></span>
            <select value={role} onChange={(e) => {
              const nextRole = e.target.value as Role
              setRole(nextRole)
              if (nextRole === 'other' && allowedPages.length === 0) setAllowedPages(['dashboard'])
            }}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className='field-caption'>Job title <span className='field-optional'>Optional</span></span>
            <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={120} />
          </label>

          {role === 'other' && (
            <div className='full'>
              <span className='field-caption'>Allowed pages <span className='field-required'>*</span></span>
              <div className='check-list'>
                {PAGE_OPTIONS.map((page) => (
                  <label key={page.value} className='check-item'>
                    <input
                      type='checkbox'
                      checked={allowedPages.includes(page.value)}
                      onChange={() => togglePage(page.value)}
                    />
                    <span>{page.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {profile?.role === 'admin' && (
            <div className='full'>
              <span className='field-caption'>Authorized Projects</span>
              {projects.isLoading || authorizedProjectQuery.isLoading ? (
                <span className='muted small'>Loading projects...</span>
              ) : projects.isError || authorizedProjectQuery.isError ? (
                <div className='banner error' role='alert'>Could not load authorized projects.</div>
              ) : projects.data?.length ? (
                <div className='check-list'>
                  {projects.data.map((project) => (
                    <label key={project.id} className='check-item'>
                      <input
                        type='checkbox'
                        checked={selectedProjectIds.includes(project.id)}
                        onChange={() => setAuthorizedProjects((current) => {
                          const currentProjects = current ?? authorizedProjectQuery.data ?? []
                          return currentProjects.includes(project.id)
                            ? currentProjects.filter((projectId) => projectId !== project.id)
                            : [...currentProjects, project.id]
                        },
                        )}
                      />
                      <span>{project.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <span className='muted small'>No projects available.</span>
              )}
            </div>
          )}

          {error && <div className='banner error full form-error' role='alert'>{error}</div>}

          <div className='actions full'>
            <button type='button' className='secondary' onClick={onClose} disabled={save.isPending}>
              Cancel
            </button>
            <button
              type='submit'
              disabled={save.isPending || (profile?.role === 'admin' && (projects.isLoading || authorizedProjectQuery.isLoading || projects.isError || authorizedProjectQuery.isError))}
            >
              {save.isPending ? 'Saving...' : employee ? 'Save changes' : 'Create employee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
