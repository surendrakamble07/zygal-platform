import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  useChecklistItems,
  useChecklistResults,
  useFinalStatuses,
  useHandoverStatuses,
  useMaterialItems,
  useMaterialProblems,
} from '../lib/job-queries'
import { friendlyJobError } from '../lib/job-errors'
import type { ChecklistLine, Job, MaterialLine } from '../lib/job-types'
import JobForm from './JobForm'

function useJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ['job', jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select(
          'id, job_no, job_date, call_type, site_id, call_taken_by, engineer_id, handover_status, final_status, has_minor_issue, remark, completed_at',
        )
        .eq('id', jobId)
        .single()
      if (error) throw error
      return data as Job
    },
  })
}

function useNames(job: Job | undefined) {
  return useQuery({
    queryKey: ['job-names', job?.id],
    enabled: !!job,
    queryFn: async () => {
      const [site, taken, eng] = await Promise.all([
        supabase.from('sites').select('branch_code, branch_name').eq('id', job!.site_id).maybeSingle(),
        supabase.from('profiles').select('full_name').eq('id', job!.call_taken_by).maybeSingle(),
        job!.engineer_id
          ? supabase.from('engineers').select('full_name').eq('id', job!.engineer_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      return {
        site: site.data as { branch_code: string; branch_name: string | null } | null,
        takenBy: (taken.data as { full_name: string } | null)?.full_name ?? '-',
        engineer: (eng.data as { full_name: string } | null)?.full_name ?? 'Not assigned',
      }
    },
  })
}

export default function JobDetail() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const job = useJob(jobId)
  const names = useNames(job.data)

  const handoverStatuses = useHandoverStatuses()
  const finalStatuses = useFinalStatuses()
  const checklistItems = useChecklistItems()
  const checklistResults = useChecklistResults()
  const materialItems = useMaterialItems()
  const materialProblems = useMaterialProblems()

  const [editing, setEditing] = useState(false)
  const [statusError, setStatusError] = useState('')

  const checklist = useQuery({
    queryKey: ['job-checklist', jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_checklist')
        .select('id, job_id, item, result, remark')
        .eq('job_id', jobId)
        .order('item')
      if (error) throw error
      return (data ?? []) as ChecklistLine[]
    },
  })

  const materials = useQuery({
    queryKey: ['job-materials', jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('material_issues')
        .select('id, job_id, item, problem, quantity, status, remark')
        .eq('job_id', jobId)
        .order('status', { ascending: false })
      if (error) throw error
      return (data ?? []) as MaterialLine[]
    },
  })

  const invalidateJob = () => {
    void qc.invalidateQueries({ queryKey: ['job', jobId] })
    void qc.invalidateQueries({ queryKey: ['jobs'] })
  }

  const updateStatus = useMutation({
    mutationFn: async (patch: Partial<Pick<Job, 'handover_status' | 'final_status' | 'has_minor_issue'>>) => {
      const { error } = await supabase.from('jobs').update(patch).eq('id', jobId)
      if (error) throw error
    },
    onSuccess: () => {
      setStatusError('')
      invalidateJob()
    },
    onError: (err) => setStatusError(friendlyJobError(err)),
  })

  const addChecklist = useMutation({
    mutationFn: async (vars: { item: string; result: string; remark: string }) => {
      const { error } = await supabase.from('job_checklist').insert({
        job_id: jobId,
        item: vars.item,
        result: vars.result,
        remark: vars.remark || null,
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job-checklist', jobId] }),
  })

  const updateChecklistResult = useMutation({
    mutationFn: async (vars: { id: string; result: string }) => {
      const { error } = await supabase.from('job_checklist').update({ result: vars.result }).eq('id', vars.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job-checklist', jobId] }),
  })

  const deleteChecklist = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('job_checklist').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job-checklist', jobId] }),
  })

  const addMaterial = useMutation({
    mutationFn: async (vars: { item: string; problem: string; quantity: number; remark: string }) => {
      const { error } = await supabase.from('material_issues').insert({
        job_id: jobId,
        item: vars.item,
        problem: vars.problem,
        quantity: vars.quantity,
        remark: vars.remark || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['job-materials', jobId] })
      invalidateJob()
    },
  })

  const resolveMaterial = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('material_issues').update({ status: 'Resolved' }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['job-materials', jobId] })
      invalidateJob()
    },
  })

  if (job.isLoading) return <p className="muted">Loading...</p>
  if (job.isError || !job.data) return <p className="muted">Job not found.</p>
  const j = job.data

  return (
    <>
      <section className="card">
        <div className="head-row">
          <div>
            <Link to="/jobs" className="link">
              ← Back to Jobs
            </Link>
            <h2>Job #{j.job_no}</h2>
          </div>
          <button className="secondary" onClick={() => setEditing(true)}>
            Edit details
          </button>
        </div>

        <div className="detail-grid">
          <div>
            <span className="muted small">Date</span>
            <div>{j.job_date}</div>
          </div>
          <div>
            <span className="muted small">Call type</span>
            <div>{j.call_type}</div>
          </div>
          <div>
            <span className="muted small">Site</span>
            <div>
              {names.data?.site ? `${names.data.site.branch_code} — ${names.data.site.branch_name ?? ''}` : '...'}
            </div>
          </div>
          <div>
            <span className="muted small">Call taken by</span>
            <div>{names.data?.takenBy ?? '...'}</div>
          </div>
          <div>
            <span className="muted small">Engineer</span>
            <div>{names.data?.engineer ?? '...'}</div>
          </div>
          <div>
            <span className="muted small">Completed</span>
            <div>{j.completed_at ? new Date(j.completed_at).toLocaleString() : 'Not yet'}</div>
          </div>
        </div>

        {j.remark && (
          <div>
            <span className="muted small">Remark</span>
            <p>{j.remark}</p>
          </div>
        )}

        <div className="filters">
          <label>
            Handover status
            <select
              value={j.handover_status}
              disabled={updateStatus.isPending}
              onChange={(e) => updateStatus.mutate({ handover_status: e.target.value })}
            >
              {handoverStatuses.data?.map((h) => (
                <option key={h.name} value={h.name}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Final status
            <select
              value={j.final_status}
              disabled={updateStatus.isPending}
              onChange={(e) => updateStatus.mutate({ final_status: e.target.value })}
            >
              {finalStatuses.data?.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Minor issue
            <select
              value={j.has_minor_issue ? 'Yes' : 'No'}
              disabled={updateStatus.isPending}
              onChange={(e) => updateStatus.mutate({ has_minor_issue: e.target.value === 'Yes' })}
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </label>
        </div>
        {statusError && <div className="banner error">{statusError}</div>}
      </section>

      <section className="card">
        <h3>Checklist</h3>
        <ChecklistAdder
          items={checklistItems.data ?? []}
          results={checklistResults.data ?? []}
          existing={checklist.data ?? []}
          onAdd={(item, result, remark) => addChecklist.mutate({ item, result, remark })}
          busy={addChecklist.isPending}
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Result</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(checklist.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No checklist entries yet.
                  </td>
                </tr>
              )}
              {(checklist.data ?? []).map((c) => (
                <tr key={c.id}>
                  <td>{c.item}</td>
                  <td>
                    <select
                      value={c.result}
                      onChange={(e) => updateChecklistResult.mutate({ id: c.id, result: e.target.value })}
                    >
                      {checklistResults.data?.map((r) => (
                        <option key={r.name} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="link" onClick={() => deleteChecklist.mutate(c.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Material issues</h3>
        <p className="muted small">The job cannot be Completed or Live while any issue here is Pending.</p>
        <MaterialAdder
          items={materialItems.data ?? []}
          problems={materialProblems.data ?? []}
          onAdd={(item, problem, quantity, remark) => addMaterial.mutate({ item, problem, quantity, remark })}
          busy={addMaterial.isPending}
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Problem</th>
                <th>Qty</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(materials.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No material issues logged.
                  </td>
                </tr>
              )}
              {(materials.data ?? []).map((m) => (
                <tr key={m.id}>
                  <td>{m.item}</td>
                  <td>{m.problem}</td>
                  <td>{m.quantity}</td>
                  <td>{m.status}</td>
                  <td>
                    {m.status === 'Pending' && (
                      <button className="link" onClick={() => resolveMaterial.mutate(m.id)}>
                        Mark resolved
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <JobForm
          job={j}
          onClose={() => {
            setEditing(false)
            invalidateJob()
          }}
        />
      )}

      {!job.data && <button onClick={() => navigate('/jobs')}>Back</button>}
    </>
  )
}

function ChecklistAdder({
  items,
  results,
  existing,
  onAdd,
  busy,
}: {
  items: { name: string }[]
  results: { name: string }[]
  existing: ChecklistLine[]
  onAdd: (item: string, result: string, remark: string) => void
  busy: boolean
}) {
  const used = new Set(existing.map((e) => e.item))
  const [item, setItem] = useState('')
  const [result, setResult] = useState(results[0]?.name ?? 'Done')
  const [remark, setRemark] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!item) return
    onAdd(item, result, remark)
    setItem('')
    setRemark('')
  }

  return (
    <form onSubmit={submit} className="inline-form">
      <select value={item} onChange={(e) => setItem(e.target.value)}>
        <option value="">Add a checklist item...</option>
        {items.filter((i) => !used.has(i.name)).map((i) => (
          <option key={i.name} value={i.name}>
            {i.name}
          </option>
        ))}
      </select>
      <select value={result} onChange={(e) => setResult(e.target.value)}>
        {results.map((r) => (
          <option key={r.name} value={r.name}>
            {r.name}
          </option>
        ))}
      </select>
      <input placeholder="Remark (optional)" value={remark} onChange={(e) => setRemark(e.target.value)} />
      <button type="submit" disabled={!item || busy}>
        Add
      </button>
    </form>
  )
}

function MaterialAdder({
  items,
  problems,
  onAdd,
  busy,
}: {
  items: { name: string }[]
  problems: { name: string }[]
  onAdd: (item: string, problem: string, quantity: number, remark: string) => void
  busy: boolean
}) {
  const [item, setItem] = useState('')
  const [problem, setProblem] = useState(problems[0]?.name ?? '')
  const [quantity, setQuantity] = useState('1')
  const [remark, setRemark] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    const qty = Number(quantity)
    if (!item || !problem || !Number.isInteger(qty) || qty < 1) return
    onAdd(item, problem, qty, remark)
    setItem('')
    setRemark('')
    setQuantity('1')
  }

  return (
    <form onSubmit={submit} className="inline-form">
      <select value={item} onChange={(e) => setItem(e.target.value)}>
        <option value="">Item...</option>
        {items.map((i) => (
          <option key={i.name} value={i.name}>
            {i.name}
          </option>
        ))}
      </select>
      <select value={problem} onChange={(e) => setProblem(e.target.value)}>
        <option value="">Problem...</option>
        {problems.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      <input type="number" min={1} max={1000} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="qty" />
      <input placeholder="Remark (optional)" value={remark} onChange={(e) => setRemark(e.target.value)} />
      <button type="submit" disabled={!item || !problem || busy}>
        Add
      </button>
    </form>
  )
}
