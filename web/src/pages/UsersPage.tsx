import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/auth-context'
import { callProvision } from '../lib/user-queries'
import type { EmployeeRow, Role } from '../lib/user-types'
import Icon from '../components/Icon'
import Avatar from '../components/Avatar'
import StatusBadge from '../components/StatusBadge'
import Pagination from '../components/Pagination'
import { TableEmptyState, TableSkeleton } from '../components/TableStates'
import UserForm from './UserForm'

const PAGE_SIZE = 25
const LIVE_REFRESH_MS = 20_000
const ROLE_LABEL: Record<Role, string> = {
  support: 'Support',
  team_lead: 'Team Lead',
  admin: 'Admin',
}

interface OnlineRow {
  session_id: string
  user_id: string
  full_name: string
  started_at: string
  last_active_at: string
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins === 1) return '1 min ago'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`
}

function OnlineNow() {
  const online = useQuery({
    queryKey: ['online-now'],
    refetchInterval: LIVE_REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_online_now')
        .select('session_id, user_id, full_name, started_at, last_active_at')
        .order('last_active_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as OnlineRow[]
    },
  })

  const rows = online.data ?? []

  return (
    <section className="card">
      <div className="head-row">
        <h2>
          Live now <span className="pill">{rows.length}</span>
        </h2>
        <span className="muted small">Updates automatically every 20 seconds</span>
      </div>
      {online.isError && <div className="banner error">Could not load who is online.</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Logged in since</th>
              <th>Last active</th>
            </tr>
          </thead>
          <tbody>
            {online.isLoading && <TableSkeleton columns={3} rows={2} />}
            {!online.isLoading && rows.length === 0 && (
              <TableEmptyState columns={3} message="Nobody is online right now." />
            )}
            {rows.map((r) => (
              <tr key={r.session_id}>
                <td>
                  <span className="person-cell">
                    <Avatar name={r.full_name} />
                    <span><span className="dot-online" aria-hidden="true" /> {r.full_name}</span>
                  </span>
                </td>
                <td>{new Date(r.started_at).toLocaleTimeString()}</td>
                <td>{timeAgo(r.last_active_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function UsersPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()

  const [page, setPage] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<EmployeeRow | null>(null)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(0)
    }, 350)
    return () => window.clearTimeout(t)
  }, [searchInput])

  const employees = useQuery({
    queryKey: ['employees', { page, search, roleFilter, statusFilter }],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase
        .from('profiles')
        .select('id, full_name, email, role, job_title, is_active, created_at', { count: 'exact' })

      const clean = search.replace(/[,()*%\\"]/g, ' ').trim()
      if (clean) q = q.or(`full_name.ilike.*${clean}*,email.ilike.*${clean}*`)
      if (roleFilter) q = q.eq('role', roleFilter)
      if (statusFilter) q = q.eq('is_active', statusFilter === 'active')

      const from = page * PAGE_SIZE
      const { data, count, error } = await q.order('full_name').range(from, from + PAGE_SIZE - 1)
      if (error) throw error
      return { rows: (data ?? []) as EmployeeRow[], total: count ?? 0 }
    },
  })

  const toggleActive = useMutation({
    mutationFn: (vars: { user_id: string; is_active: boolean }) => callProvision({ action: 'set_active', ...vars }),
    onSuccess: () => {
      setActionError('')
      void qc.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (err: Error) => setActionError(err.message),
  })

  const rows = employees.data?.rows ?? []
  const total = employees.data?.total ?? 0
  return (
    <>
      <OnlineNow />

      <section className="card">
        <div className="head-row">
          <h2>Users</h2>
          <button onClick={() => setAdding(true)}><Icon name="plus" size={17} />Add employee</button>
        </div>
        <p className="muted small">
          New employees sign in with their office email and a one-time code sent by email. There is no
          password to set here.
        </p>

        <div className="filters">
          <input
            type="search"
            placeholder="Search name or email"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(0) }}>
            <option value="">All roles</option>
            <option value="support">Support</option>
            <option value="team_lead">Team Lead</option>
            <option value="admin">Admin</option>
          </select>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {employees.isError && <div className="banner error">Could not load employees. Please refresh and try again.</div>}
        {actionError && <div className="banner error">{actionError}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Job title</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {employees.isLoading && <TableSkeleton columns={6} />}
              {!employees.isLoading && rows.length === 0 && (
                <TableEmptyState columns={6} message="No employees match these filters." />
              )}
              {rows.map((u) => (
                <tr key={u.id}>
                  <td><span className="person-cell"><Avatar name={u.full_name} />{u.full_name}</span></td>
                  <td>{u.email}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>{u.job_title ?? '-'}</td>
                  <td><StatusBadge status={u.is_active ? 'Active' : 'Inactive'} /></td>
                  <td className="row-actions">
                    <button className="link icon-action" aria-label={`Edit ${u.full_name}`} onClick={() => setEditing(u)}><Icon name="edit" size={16} />Edit</button>
                    <button
                      className="link"
                      disabled={toggleActive.isPending || u.id === profile?.id}
                      onClick={() => toggleActive.mutate({ user_id: u.id, is_active: !u.is_active })}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination currentPage={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} disabled={employees.isFetching} itemLabel="employees" />
      </section>

      {adding && <UserForm employee={null} onClose={() => setAdding(false)} />}
      {editing && <UserForm employee={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
