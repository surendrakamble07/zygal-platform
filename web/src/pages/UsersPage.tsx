import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/auth-context'
import { callProvision } from '../lib/user-queries'
import type { EmployeeRow, Role } from '../lib/user-types'
import Icon from '../components/Icon'
import Avatar from '../components/Avatar'
import StatusBadge from '../components/StatusBadge'
import { TestDataBadge, TestDataFilter, TestDataToggle, type DummyFilter } from '../components/TestDataControls'
import Pagination from '../components/Pagination'
import { TableEmptyState, TableSkeleton } from '../components/TableStates'
import UserForm from './UserForm'
import AvailabilityIndicator from '../components/AvailabilityIndicator'
import type { AvailabilityValue } from '../lib/availability'

const PAGE_SIZE = 25
const LIVE_REFRESH_MS = 20_000
const ROLE_LABEL: Record<Role, string> = {
  support: 'Support',
  team_lead: 'Team Lead',
  admin: 'Admin',
  other: 'Limited',
}

interface OnlineRow {
  session_id: string
  user_id: string
  full_name: string
  started_at: string
  last_active_at: string
  availability: {
    status: AvailabilityValue
    remark: string | null
    since: string
  } | null
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
      const onlineRows = (data ?? []) as Omit<OnlineRow, 'availability'>[]
      const userIds = [...new Set(onlineRows.map((row) => row.user_id))]
      const availabilityByUser = new Map<
        string,
        NonNullable<OnlineRow['availability']>
      >()
      if (userIds.length > 0) {
        const { data: availabilityRows, error: availabilityError } = await supabase
          .from('availability_status')
          .select('user_id, status, remark, since')
          .in('user_id', userIds)
        if (availabilityError) throw availabilityError
        for (const row of (availabilityRows ?? []) as unknown as {
          user_id: string
          status: AvailabilityValue
          remark: string | null
          since: string
        }[]) {
          availabilityByUser.set(row.user_id, {
            status: row.status,
            remark: row.remark,
            since: row.since,
          })
        }
      }
      return onlineRows.map((row) => ({
        ...row,
        availability: availabilityByUser.get(row.user_id) ?? null,
      }))
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
              <th>Availability</th>
            </tr>
          </thead>
          <tbody>
            {online.isLoading && <TableSkeleton columns={4} rows={2} />}
            {!online.isLoading && rows.length === 0 && (
              <TableEmptyState columns={4} message="Nobody is online right now." />
            )}
            {rows.map((r) => {
              const availability = r.availability
              return (
                <tr key={r.session_id}>
                  <td>
                    <span className="person-cell">
                      <Avatar name={r.full_name} />
                      <span><span className="dot-online" aria-hidden="true" /> {r.full_name}</span>
                    </span>
                  </td>
                  <td>{new Date(r.started_at).toLocaleTimeString()}</td>
                  <td>{timeAgo(r.last_active_at)}</td>
                  <td>
                    <AvailabilityIndicator
                      status={availability?.status ?? 'Free'}
                      since={availability?.since}
                    />
                    {availability?.status === 'Busy' && availability.remark && (
                      <span className="availability-remark">{availability.remark}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function UsersPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const qc = useQueryClient()

  const [page, setPage] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dummyFilter, setDummyFilter] = useState<DummyFilter>('real')
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
    queryKey: ['employees', { page, search, roleFilter, statusFilter, dummyFilter, isAdmin }],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase
        .from('profiles')
        .select('id, full_name, email, phone, role, job_title, is_active, is_dummy, created_at', { count: 'exact' })

      const clean = search.replace(/[,()*%\\"]/g, ' ').trim()
      if (clean) q = q.or(`full_name.ilike.*${clean}*,email.ilike.*${clean}*`)
      if (roleFilter) q = q.eq('role', roleFilter)
      if (statusFilter) q = q.eq('is_active', statusFilter === 'active')
      if (isAdmin && dummyFilter !== 'all') q = q.eq('is_dummy', dummyFilter === 'test')

      const from = page * PAGE_SIZE
      const { data, count, error } = await q.order('full_name').range(from, from + PAGE_SIZE - 1)
      if (error) throw error
      return { rows: (data ?? []) as EmployeeRow[], total: count ?? 0 }
    },
  })

  const activeEmployeeCount = useQuery({
    queryKey: ['active-employee-count', isAdmin],
    queryFn: async () => {
      let q = supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
      if (isAdmin) q = q.eq('is_dummy', false)
      const { count, error } = await q
      if (error) throw error
      return count
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

  const toggleTestData = useMutation({
    mutationFn: async ({ id, is_dummy }: { id: string; is_dummy: boolean }) => {
      const { error } = await supabase.from('profiles').update({ is_dummy }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      setActionError('')
      void qc.invalidateQueries({ queryKey: ['employees'] })
      void qc.invalidateQueries({ queryKey: ['active-employee-count'] })
    },
    onError: (error: Error) => setActionError(error.message),
  })

  const rows = employees.data?.rows ?? []
  const total = employees.data?.total ?? 0
  return (
    <>
      <OnlineNow />

      <section className="card">
        <div className="head-row">
          <div>
            <h2>Users</h2>
            {activeEmployeeCount.isError ? (
              <span className="hint bad" role="alert">Could not load active employee count.</span>
            ) : (
              <span className="muted small">
                {activeEmployeeCount.isLoading
                  ? 'Loading active users...'
                  : `${activeEmployeeCount.data ?? 0} active users`}
              </span>
            )}
          </div>
          {isAdmin && <button onClick={() => setAdding(true)}><Icon name="plus" size={17} />Add employee</button>}
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
            <option value="other">Limited</option>
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
                <th>Mobile number</th>
                <th>Role</th>
                <th>Job title</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {employees.isLoading && <TableSkeleton columns={7} />}
              {!employees.isLoading && rows.length === 0 && (
                <TableEmptyState columns={7} message="No employees match these filters." />
              )}
              {rows.map((u) => (
                <tr key={u.id}>
                  <td><span className="person-cell"><Avatar name={u.full_name} />{u.full_name}{u.is_dummy && <TestDataBadge />}</span></td>
                  <td>{u.email}</td>
                  <td>{u.phone ?? '-'}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>{u.job_title ?? '-'}</td>
                  <td><StatusBadge status={u.is_active ? 'Active' : 'Inactive'} /></td>
                  <td className="row-actions">
                    {isAdmin && (
                      <>
                        <button className="link icon-action" aria-label={`Edit ${u.full_name}`} onClick={() => setEditing(u)}><Icon name="edit" size={16} />Edit</button>
                        <button
                          className="link"
                          disabled={toggleActive.isPending || u.id === profile?.id}
                          onClick={() => toggleActive.mutate({ user_id: u.id, is_active: !u.is_active })}
                        >
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <TestDataToggle
                          checked={u.is_dummy}
                          disabled={toggleTestData.isPending}
                          itemName={u.full_name}
                          onChange={(is_dummy) => toggleTestData.mutate({ id: u.id, is_dummy })}
                        />
                      </>
                    )}
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
