import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCallTypes, useFinalStatuses, useHandoverStatuses } from '../lib/job-queries'
import type { Job } from '../lib/job-types'
import JobForm from './JobForm'

const PAGE_SIZE = 25

interface Names {
  siteLabel: string
  takenBy: string
  engineer: string
}

export default function JobsPage() {
  const callTypes = useCallTypes()
  const handoverStatuses = useHandoverStatuses()
  const finalStatuses = useFinalStatuses()

  const [page, setPage] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [callType, setCallType] = useState('')
  const [handover, setHandover] = useState('')
  const [finalStatus, setFinalStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [adding, setAdding] = useState(false)
  const [names, setNames] = useState<Record<string, Names>>({})

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(0)
    }, 350)
    return () => window.clearTimeout(t)
  }, [searchInput])

  const jobs = useQuery({
    queryKey: ['jobs', { page, search, callType, handover, finalStatus, dateFrom, dateTo }],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase
        .from('jobs')
        .select(
          'id, job_no, job_date, call_type, site_id, call_taken_by, engineer_id, handover_status, final_status, has_minor_issue, remark, completed_at',
          { count: 'exact' },
        )
        .is('deleted_at', null)

      if (callType) q = q.eq('call_type', callType)
      if (handover) q = q.eq('handover_status', handover)
      if (finalStatus) q = q.eq('final_status', finalStatus)
      if (dateFrom) q = q.gte('job_date', dateFrom)
      if (dateTo) q = q.lte('job_date', dateTo)

      const clean = search.replace(/[,()*%\\"]/g, ' ').trim()
      let siteIds: string[] | null = null
      if (clean) {
        const { data: siteMatches } = await supabase
          .from('sites')
          .select('id')
          .or(`branch_code.ilike.*${clean}*,branch_name.ilike.*${clean}*`)
          .limit(200)
        siteIds = (siteMatches ?? []).map((s) => s.id as string)
        if (siteIds.length === 0) return { rows: [] as Job[], total: 0 }
        q = q.in('site_id', siteIds)
      }

      const from = page * PAGE_SIZE
      const { data, count, error } = await q.order('job_date', { ascending: false }).order('job_no', { ascending: false }).range(from, from + PAGE_SIZE - 1)
      if (error) throw error
      return { rows: (data ?? []) as Job[], total: count ?? 0 }
    },
  })

  const rows = jobs.data?.rows ?? []
  const total = jobs.data?.total ?? 0
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1
  const last = Math.min((page + 1) * PAGE_SIZE, total)
  const hasNext = (page + 1) * PAGE_SIZE < total

  // Look up site / person names for just the rows on screen (cheap, since it's at most 25).
  useEffect(() => {
    if (rows.length === 0) return
    let cancelled = false
    ;(async () => {
      const siteIds = [...new Set(rows.map((r) => r.site_id))]
      const userIds = [...new Set(rows.map((r) => r.call_taken_by))]
      const engIds = [...new Set(rows.map((r) => r.engineer_id).filter((x): x is string => !!x))]

      const [sites, users, engs] = await Promise.all([
        supabase.from('sites').select('id, branch_code, branch_name').in('id', siteIds),
        supabase.from('profiles').select('id, full_name').in('id', userIds),
        engIds.length ? supabase.from('engineers').select('id, full_name').in('id', engIds) : Promise.resolve({ data: [] }),
      ])
      if (cancelled) return

      const siteMap = new Map((sites.data ?? []).map((s: any) => [s.id, `${s.branch_code}${s.branch_name ? ' - ' + s.branch_name : ''}`]))
      const userMap = new Map((users.data ?? []).map((u: any) => [u.id, u.full_name]))
      const engMap = new Map((engs.data ?? []).map((e: any) => [e.id, e.full_name]))

      const next: Record<string, Names> = {}
      for (const r of rows) {
        next[r.id] = {
          siteLabel: siteMap.get(r.site_id) ?? r.site_id,
          takenBy: userMap.get(r.call_taken_by) ?? '-',
          engineer: r.engineer_id ? engMap.get(r.engineer_id) ?? '-' : 'Not assigned',
        }
      }
      setNames(next)
    })()
    return () => {
      cancelled = true
    }
  }, [rows])

  return (
    <>
      <section className="card">
        <div className="head-row">
          <h2>Jobs</h2>
          <button onClick={() => setAdding(true)}>New job</button>
        </div>

        <div className="filters">
          <input
            type="search"
            placeholder="Search site branch code or name"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select value={callType} onChange={(e) => { setCallType(e.target.value); setPage(0) }}>
            <option value="">All call types</option>
            {callTypes.data?.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          <select value={handover} onChange={(e) => { setHandover(e.target.value); setPage(0) }}>
            <option value="">Any handover</option>
            {handoverStatuses.data?.map((h) => (
              <option key={h.name} value={h.name}>{h.name}</option>
            ))}
          </select>
          <select value={finalStatus} onChange={(e) => { setFinalStatus(e.target.value); setPage(0) }}>
            <option value="">Any final status</option>
            {finalStatuses.data?.map((f) => (
              <option key={f.name} value={f.name}>{f.name}</option>
            ))}
          </select>
          <label className="date-field">
            From
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0) }} />
          </label>
          <label className="date-field">
            To
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0) }} />
          </label>
        </div>

        {jobs.isError && <div className="banner error">Could not load jobs. Please refresh and try again.</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job #</th>
                <th>Date</th>
                <th>Call type</th>
                <th>Site</th>
                <th>Engineer</th>
                <th>Handover</th>
                <th>Final status</th>
                <th>Minor</th>
              </tr>
            </thead>
            <tbody>
              {jobs.isLoading && (
                <tr><td colSpan={8} className="muted">Loading...</td></tr>
              )}
              {!jobs.isLoading && rows.length === 0 && (
                <tr><td colSpan={8} className="muted">No jobs found.</td></tr>
              )}
              {rows.map((j) => (
                <tr key={j.id}>
                  <td><Link to={`/jobs/${j.id}`}>#{j.job_no}</Link></td>
                  <td>{j.job_date}</td>
                  <td>{j.call_type}</td>
                  <td>{names[j.id]?.siteLabel ?? '...'}</td>
                  <td>{names[j.id]?.engineer ?? '...'}</td>
                  <td>{j.handover_status}</td>
                  <td>{j.final_status}</td>
                  <td>{j.has_minor_issue ? 'Yes' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="head-row">
          <span className="muted small">{total === 0 ? 'No results' : `Showing ${first}-${last} of ${total}`}</span>
          <div className="actions">
            <button className="secondary" disabled={page === 0 || jobs.isFetching} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button className="secondary" disabled={!hasNext || jobs.isFetching} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      </section>

      {adding && <JobForm job={null} onClose={() => setAdding(false)} />}
    </>
  )
}
