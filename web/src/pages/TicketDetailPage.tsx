import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import StatusBadge from '../components/StatusBadge'
import { supabase } from '../lib/supabase'
import {
  getProjectTeamLeadIds,
  insertTicketNotifications,
  invalidateTicketNotificationQueries,
} from '../lib/ticket-notifications'

interface TicketRecord {
  id: string
  project_id: string
  site_id: string
  status: string
  created_at: string
  cancelled_at: string | null
  cancel_reason: string | null
}

interface AssignmentRecord {
  id: string
  assigned_to: string
  assigned_at: string
  unassigned_at: string | null
  is_current: boolean
  full_name: string
}

interface WorkLogRecord {
  id: string
  author_id: string | null
  note: string
  logged_at: string
  author_name: string
}

interface CommentRecord {
  id: string
  author_id: string | null
  comment: string
  created_at: string
  author_name: string
}

interface AttachmentRecord {
  id: string
  storage_path: string
  file_name: string
  uploaded_by: string | null
  created_at: string
  download_url: string
}

interface ContributorDraft {
  profile_id: string
  full_name: string
  percent: string
}

interface TicketEmployee {
  id: string
  full_name: string
}

async function loadNames(ids: (string | null)[]) {
  const profileIds = [...new Set(ids.filter((id): id is string => !!id))]
  if (!profileIds.length) return new Map<string, string>()
  const { data, error } = await supabase.from('profiles').select('id, full_name').in('id', profileIds)
  if (error) throw error
  return new Map((data ?? []).map((profile) => [profile.id as string, profile.full_name as string]))
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default function TicketDetailPage() {
  const { ticketId } = useParams()
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [workLogNote, setWorkLogNote] = useState('')
  const [comment, setComment] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [statusError, setStatusError] = useState('')
  const [formError, setFormError] = useState('')
  const [notificationError, setNotificationError] = useState('')
  const [contributionDraft, setContributionDraft] = useState<ContributorDraft[] | null>(null)
  const [newContributorId, setNewContributorId] = useState('')
  const [contributionReason, setContributionReason] = useState('')
  const [contributionError, setContributionError] = useState('')
  const isLeadOrAdmin = profile?.role === 'team_lead' || profile?.role === 'admin'

  const ticket = useQuery({
    queryKey: ['ticket', ticketId],
    enabled: !!ticketId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('id, project_id, site_id, status, created_at, cancelled_at, cancel_reason')
        .eq('id', ticketId!)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('Ticket not found or you do not have access.')
      return data as TicketRecord
    },
  })
  const site = useQuery({
    queryKey: ['ticket-site', ticket.data?.site_id],
    enabled: !!ticket.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sites')
        .select('id, branch_code, branch_name, state, status')
        .eq('id', ticket.data!.site_id)
        .single()
      if (error) throw error
      return data
    },
  })
  const projectAccess = useQuery({
    queryKey: ['ticket-project-access', profile?.id, ticket.data?.project_id],
    enabled: !!profile?.id && !!ticket.data && isLeadOrAdmin && profile.role !== 'admin',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profile_projects')
        .select('project_id')
        .eq('profile_id', profile!.id)
        .eq('project_id', ticket.data!.project_id)
      if (error) throw error
      return (data ?? []).length > 0
    },
  })
  const assignmentHistory = useQuery({
    queryKey: ['ticket-assignment-history', ticketId],
    enabled: !!ticket.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_assignments')
        .select('id, assigned_to, assigned_at, unassigned_at, is_current')
        .eq('ticket_id', ticket.data!.id)
        .order('assigned_at', { ascending: true })
      if (error) throw error
      const rows = data ?? []
      const names = await loadNames(rows.map((row) => row.assigned_to as string))
      return rows.map((row) => ({
        ...row,
        id: row.id as string,
        assigned_to: row.assigned_to as string,
        assigned_at: row.assigned_at as string,
        unassigned_at: row.unassigned_at as string | null,
        is_current: row.is_current as boolean,
        full_name: names.get(row.assigned_to as string) ?? 'Unknown employee',
      })) as AssignmentRecord[]
    },
  })
  const currentAssignment = assignmentHistory.data?.find((assignment) => assignment.is_current)
  const isCurrentAssignee = !!profile?.id && currentAssignment?.assigned_to === profile.id
  const canManageProject = profile?.role === 'admin' || (isLeadOrAdmin && projectAccess.data === true)
  const canViewWorkLogs = isCurrentAssignee || canManageProject
  const contributions = useQuery({
    queryKey: ['ticket-contributions', ticketId],
    enabled: !!ticket.data && canManageProject && !assignmentHistory.isLoading,
    queryFn: async () => {
      const { data: savedContributors, error: savedError } = await supabase
        .from('ticket_contributors')
        .select('profile_id, contribution_percent')
        .eq('ticket_id', ticket.data!.id)
      if (savedError) throw savedError
      const { data: projectAccessRows, error: accessError } = await supabase
        .from('profile_projects')
        .select('profile_id')
        .eq('project_id', ticket.data!.project_id)
      if (accessError) throw accessError

      const assignedIds = (assignmentHistory.data ?? []).map((assignment) => assignment.assigned_to)
      const savedIds = (savedContributors ?? []).map((row) => row.profile_id as string)
      const memberIds = (projectAccessRows ?? []).map((row) => row.profile_id as string)
      const allIds = [...new Set([...assignedIds, ...savedIds, ...memberIds])]
      if (!allIds.length) return { rows: [] as ContributorDraft[], candidates: [] as TicketEmployee[] }

      const { data: people, error: peopleError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', allIds)
        .order('full_name')
      if (peopleError) throw peopleError
      const names = new Map((people ?? []).map((person) => [person.id as string, person.full_name as string]))
      const savedByProfile = new Map((savedContributors ?? []).map((row) => [
        row.profile_id as string,
        String(row.contribution_percent),
      ]))
      const participantIds = [...new Set([...assignedIds, ...savedIds])]
      return {
        rows: participantIds.map((id) => ({
          profile_id: id,
          full_name: names.get(id) ?? 'Unknown employee',
          percent: savedByProfile.get(id) ?? '0',
        })),
        candidates: memberIds
          .filter((id) => names.has(id))
          .map((id) => ({ id, full_name: names.get(id)! })),
      }
    },
  })
  const baseContributors = contributions.data?.rows ?? []
  const contributorDraft = contributionDraft ?? baseContributors
  const contributorIds = new Set(contributorDraft.map((row) => row.profile_id))
  const availableContributors = (contributions.data?.candidates ?? [])
    .filter((person) => !contributorIds.has(person.id))
  const contributionValues = contributorDraft.map((contributor) => contributor.percent.trim())
  const contributionDecimalPlaces = Math.max(
    0,
    ...contributionValues.map((value) => value.split('.')[1]?.length ?? 0),
  )
  const contributionScale = 10n ** BigInt(contributionDecimalPlaces)
  const contributionUnits = contributionValues.reduce((total, value) => {
    if (!/^\d+(?:\.\d*)?$/.test(value)) return total
    const [whole, fraction = ''] = value.split('.')
    return total + BigInt(whole) * contributionScale
      + BigInt(fraction.padEnd(contributionDecimalPlaces, '0') || '0')
  }, 0n)
  const hasValidContributionValues = contributorDraft.every((contributor) => {
    const value = Number(contributor.percent)
    return /^\d+(?:\.\d*)?$/.test(contributor.percent.trim())
      && Number.isFinite(value) && value >= 0 && value <= 100
  })
  const contributionTotalIsValid = contributionUnits === 100n * contributionScale && hasValidContributionValues
  const contributionWhole = contributionUnits / contributionScale
  const contributionFraction = (contributionUnits % contributionScale)
    .toString()
    .padStart(contributionDecimalPlaces, '0')
    .replace(/0+$/, '')
  const contributionTotalLabel = contributionFraction
    ? `${contributionWhole}.${contributionFraction}`
    : contributionWhole.toString()

  const workLogs = useQuery({
    queryKey: ['ticket-work-logs', ticketId],
    enabled: !!ticket.data && canViewWorkLogs,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_work_logs')
        .select('id, author_id, note, logged_at')
        .eq('ticket_id', ticket.data!.id)
        .order('logged_at', { ascending: false })
      if (error) throw error
      const rows = data ?? []
      const names = await loadNames(rows.map((row) => row.author_id as string | null))
      return rows.map((row) => ({
        ...row,
        id: row.id as string,
        author_id: row.author_id as string | null,
        note: row.note as string,
        logged_at: row.logged_at as string,
        author_name: names.get(row.author_id as string) ?? 'Unknown employee',
      })) as WorkLogRecord[]
    },
  })
  const comments = useQuery({
    queryKey: ['ticket-comments', ticketId],
    enabled: !!ticket.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_comments')
        .select('id, author_id, comment, created_at')
        .eq('ticket_id', ticket.data!.id)
        .order('created_at', { ascending: true })
      if (error) throw error
      const rows = data ?? []
      const names = await loadNames(rows.map((row) => row.author_id as string | null))
      return rows.map((row) => ({
        ...row,
        id: row.id as string,
        author_id: row.author_id as string | null,
        comment: row.comment as string,
        created_at: row.created_at as string,
        author_name: names.get(row.author_id as string) ?? 'Unknown employee',
      })) as CommentRecord[]
    },
  })
  const attachments = useQuery({
    queryKey: ['ticket-attachments', ticketId],
    enabled: !!ticket.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_attachments')
        .select('id, storage_path, file_name, uploaded_by, created_at')
        .eq('ticket_id', ticket.data!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      const signedAttachments = await Promise.all((data ?? []).map(async (attachment) => {
        const { data: signed, error: signedError } = await supabase.storage
          .from('ticket-attachments')
          .createSignedUrl(attachment.storage_path as string, 3600)
        if (signedError) throw signedError
        return {
          ...attachment,
          id: attachment.id as string,
          storage_path: attachment.storage_path as string,
          file_name: attachment.file_name as string,
          uploaded_by: attachment.uploaded_by as string | null,
          created_at: attachment.created_at as string,
          download_url: signed.signedUrl,
        }
      }))
      return signedAttachments as AttachmentRecord[]
    },
  })

  const refreshTicket = () => {
    void queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] })
    void queryClient.invalidateQueries({ queryKey: ['project-tickets'] })
    void queryClient.invalidateQueries({ queryKey: ['ticket-assignment-history', ticketId] })
    void queryClient.invalidateQueries({ queryKey: ['ticket-work-logs', ticketId] })
    void queryClient.invalidateQueries({ queryKey: ['ticket-comments', ticketId] })
    void queryClient.invalidateQueries({ queryKey: ['ticket-attachments', ticketId] })
  }
  const addWorkLog = useMutation({
    mutationFn: async () => {
      if (!ticket.data || !workLogNote.trim()) throw new Error('Enter a work log note.')
      const { error } = await supabase.from('ticket_work_logs').insert({
        ticket_id: ticket.data.id,
        assignment_id: currentAssignment?.id ?? null,
        note: workLogNote.trim(),
      })
      if (error) throw error
    },
    onSuccess: () => {
      setWorkLogNote('')
      setFormError('')
      refreshTicket()
    },
    onError: (error: Error) => setFormError(error.message),
  })
  const addComment = useMutation({
    mutationFn: async () => {
      if (!ticket.data || !comment.trim()) throw new Error('Enter a comment.')
      const { error } = await supabase.from('ticket_comments').insert({
        ticket_id: ticket.data.id,
        comment: comment.trim(),
      })
      if (error) throw error
    },
    onSuccess: async () => {
      setComment('')
      setFormError('')
      refreshTicket()
      try {
        if (ticket.data && profile?.id) {
          const recipients = currentAssignment?.assigned_to === profile.id
            ? await getProjectTeamLeadIds(ticket.data.project_id)
            : currentAssignment?.assigned_to
              ? [currentAssignment.assigned_to]
              : []
          const recipientsToNotify = recipients.filter((recipientId) => recipientId !== profile.id)
          await insertTicketNotifications(
            ticket.data.id,
            'Commented',
            `A new comment was added to the ticket for ${site.data?.branch_name || site.data?.branch_code || ticket.data.id}.`,
            recipientsToNotify,
          )
          invalidateTicketNotificationQueries(queryClient, recipientsToNotify)
        }
        setNotificationError('')
      } catch (error) {
        setNotificationError(`Comment posted, but the notification could not be sent: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    onError: (error: Error) => setFormError(error.message),
  })
  const uploadAttachment = useMutation({
    mutationFn: async (file: File) => {
      if (!ticket.data || !profile?.id) throw new Error('Your ticket session is unavailable.')
      const storagePath = `${ticket.data.id}/${profile.id}/${crypto.randomUUID()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('ticket-attachments')
        .upload(storagePath, file, { contentType: file.type || undefined })
      if (uploadError) throw uploadError
      const { error: metadataError } = await supabase.from('ticket_attachments').insert({
        ticket_id: ticket.data.id,
        storage_path: storagePath,
        file_name: file.name,
      })
      if (metadataError) {
        const { error: cleanupError } = await supabase.storage.from('ticket-attachments').remove([storagePath])
        if (cleanupError) {
          throw new Error(`${metadataError.message} (Also failed to remove uploaded file: ${cleanupError.message})`)
        }
        throw metadataError
      }
    },
    onSuccess: () => {
      setFormError('')
      refreshTicket()
    },
    onError: (error: Error) => setFormError(error.message),
  })
  const statusAction = useMutation({
    mutationFn: async ({ action, status, reason }: { action: string; status: string; reason?: string }) => {
      if (!ticket.data) throw new Error('Ticket is unavailable.')
      const { error: reviewError } = await supabase.from('ticket_reviews').insert({
        ticket_id: ticket.data.id,
        action,
        remark: reason ?? null,
      })
      if (reviewError) throw reviewError
      const patch = action === 'Cancelled'
        ? { status, cancel_reason: reason, cancelled_at: new Date().toISOString() }
        : { status }
      const { error: updateError } = await supabase.from('tickets').update(patch).eq('id', ticket.data.id)
      if (updateError) throw updateError
    },
    onSuccess: async (_data, variables) => {
      setStatusError('')
      setCancelReason('')
      refreshTicket()
      try {
        if (ticket.data) {
          let recipients: string[] = []
          if (variables.action === 'Submitted') {
            recipients = await getProjectTeamLeadIds(ticket.data.project_id)
          } else if (['Approved', 'Reopened'].includes(variables.action) && currentAssignment?.assigned_to) {
            recipients = [currentAssignment.assigned_to]
          }
          const recipientsToNotify = recipients.filter((recipientId) => recipientId !== profile?.id)
          await insertTicketNotifications(
            ticket.data.id,
            variables.action,
            `Ticket for ${site.data?.branch_name || site.data?.branch_code || ticket.data.id} was ${variables.action.toLowerCase()}.`,
            recipientsToNotify,
          )
          invalidateTicketNotificationQueries(queryClient, recipientsToNotify)
        }
        setNotificationError('')
      } catch (error) {
        setNotificationError(`Status updated, but the notification could not be sent: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    onError: (error: Error) => setStatusError(error.message),
  })
  const saveContributions = useMutation({
    mutationFn: async () => {
      if (!ticket.data) throw new Error('Ticket is unavailable.')
      if (!contributionTotalIsValid) throw new Error('Contribution percentages must total exactly 100%.')
      if (ticket.data.status === 'Approved' && !contributionReason.trim()) {
        throw new Error('Enter a change reason for this approved ticket.')
      }
      const { error } = await supabase.rpc('set_ticket_contributions', {
        p_ticket_id: ticket.data.id,
        p_contributions: contributorDraft.map((contributor) => ({
          profile_id: contributor.profile_id,
          percent: Number(contributor.percent),
        })),
        p_change_reason: ticket.data.status === 'Approved' ? contributionReason.trim() : null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setContributionError('')
      setContributionDraft(null)
      setContributionReason('')
      void queryClient.invalidateQueries({ queryKey: ['ticket-contributions', ticketId] })
    },
    onError: (error: Error) => setContributionError(error.message),
  })

  function submitComment(event: FormEvent) {
    event.preventDefault()
    addComment.mutate()
  }

  if (ticket.isLoading) return <section className="card">Loading ticket...</section>
  if (ticket.isError) return <section className="card"><div className="banner error" role="alert">{ticket.error.message}</div><Link className="link" to="/tickets">Back to Tickets</Link></section>
  if (!ticket.data) return null

  const status = ticket.data.status
  const canSubmit = isCurrentAssignee && ['Assigned', 'In Progress', 'Reopened'].includes(status)
  const canReview = canManageProject && status === 'Submitted'
  const canCancel = canManageProject && !['Approved', 'Cancelled'].includes(status)

  return (
    <div className="ticket-detail-page">
      <section className="card">
        <div className="head-row">
          <div>
            <Link className="link" to="/tickets">← Tickets</Link>
            <h1>Ticket details</h1>
          </div>
          <StatusBadge status={status} />
        </div>
        <p className="muted small">Created {formatTimestamp(ticket.data.created_at)}</p>
        {formError && <div className="banner error" role="alert">{formError}</div>}
        {notificationError && <div className="banner error" role="alert">{notificationError}</div>}
        {projectAccess.isError && <div className="banner error" role="alert">Could not verify project access: {projectAccess.error.message}</div>}
        {site.isError ? <div className="banner error" role="alert">Could not load site: {site.error.message}</div> : (
          <dl className="ticket-site-info">
            <div><dt>Site</dt><dd>{site.data ? `${site.data.branch_code}${site.data.branch_name ? ` — ${site.data.branch_name}` : ''}` : 'Loading...'}</dd></div>
            <div><dt>State</dt><dd>{site.data?.state ?? '—'}</dd></div>
            <div><dt>Site status</dt><dd>{site.data?.status ?? '—'}</dd></div>
          </dl>
        )}
      </section>

      <section className="card">
        <div className="section-heading"><h2>Assignment history</h2></div>
        {assignmentHistory.isError && <div className="banner error" role="alert">Could not load assignment history: {assignmentHistory.error.message}</div>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Assigned</th><th>Unassigned</th><th>State</th></tr></thead>
            <tbody>
              {assignmentHistory.isLoading && <tr><td colSpan={4}>Loading assignments...</td></tr>}
              {!assignmentHistory.isLoading && assignmentHistory.data?.length === 0 && <tr><td colSpan={4}>No assignment history.</td></tr>}
              {assignmentHistory.data?.map((assignment) => (
                <tr key={assignment.id}>
                  <td>{assignment.full_name}</td>
                  <td>{formatTimestamp(assignment.assigned_at)}</td>
                  <td>{assignment.unassigned_at ? formatTimestamp(assignment.unassigned_at) : '—'}</td>
                  <td><span className={`status-badge ${assignment.is_current ? 'success' : 'neutral'}`}>{assignment.is_current ? 'Current' : 'Historical'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canViewWorkLogs && (
        <section className="card">
          <h2>Work log</h2>
          {workLogs.isError && <div className="banner error" role="alert">Could not load work logs: {workLogs.error.message}</div>}
          <form className="grid-form" onSubmit={(event) => { event.preventDefault(); addWorkLog.mutate() }}>
            <label className="full">
              <span className="field-caption">Add a work log note</span>
              <textarea value={workLogNote} onChange={(event) => setWorkLogNote(event.target.value)} required rows={3} />
            </label>
            <div className="actions full">
              <button type="submit" disabled={!workLogNote.trim() || addWorkLog.isPending}>{addWorkLog.isPending ? 'Saving...' : 'Add work log'}</button>
            </div>
          </form>
          <div className="ticket-entry-list">
            {workLogs.data?.map((entry) => (
              <article className="ticket-entry" key={entry.id}>
                <div><strong>{entry.author_name}</strong><time>{formatTimestamp(entry.logged_at)}</time></div>
                <p>{entry.note}</p>
              </article>
            ))}
            {!workLogs.isLoading && !workLogs.isError && workLogs.data?.length === 0 && <p className="muted small">No work log entries.</p>}
          </div>
        </section>
      )}

      <section className="card">
        <h2>Comments</h2>
        {comments.isError && <div className="banner error" role="alert">Could not load comments: {comments.error.message}</div>}
        <div className="ticket-entry-list">
          {comments.data?.map((entry) => (
            <article className="ticket-entry" key={entry.id}>
              <div><strong>{entry.author_name}</strong><time>{formatTimestamp(entry.created_at)}</time></div>
              <p>{entry.comment}</p>
            </article>
          ))}
          {!comments.isLoading && !comments.isError && comments.data?.length === 0 && <p className="muted small">No comments yet.</p>}
        </div>
        <form className="grid-form" onSubmit={submitComment}>
          <label className="full">
            <span className="field-caption">Add a comment</span>
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} required rows={3} />
          </label>
          <div className="actions full">
            <button type="submit" disabled={!comment.trim() || addComment.isPending}>{addComment.isPending ? 'Posting...' : 'Post comment'}</button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Attachments</h2>
        {attachments.isError && <div className="banner error" role="alert">Could not load attachments: {attachments.error.message}</div>}
        <div className="ticket-attachments">
          {attachments.data?.map((attachment) => (
            <a key={attachment.id} href={attachment.download_url} target="_blank" rel="noopener noreferrer" className="link">
              {attachment.file_name}
            </a>
          ))}
          {!attachments.isLoading && !attachments.isError && attachments.data?.length === 0 && <p className="muted small">No attachments.</p>}
        </div>
        <label className="ticket-upload">
          <span className="field-caption">Upload attachment</span>
          <input type="file" onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) uploadAttachment.mutate(file)
            event.target.value = ''
          }} disabled={uploadAttachment.isPending} />
        </label>
        {uploadAttachment.isPending && <p className="muted small">Uploading attachment...</p>}
      </section>

      {(canSubmit || canReview || canCancel) && (
        <section className="card">
          <h2>Status actions</h2>
          {statusError && <div className="banner error" role="alert">{statusError}</div>}
          <div className="actions">
            {canSubmit && <button type="button" disabled={statusAction.isPending} onClick={() => statusAction.mutate({ action: 'Submitted', status: 'Submitted' })}>Submit for review</button>}
            {canReview && (
              <>
                <button type="button" disabled={statusAction.isPending} onClick={() => statusAction.mutate({ action: 'Approved', status: 'Approved' })}>Approve</button>
                <button type="button" className="secondary" disabled={statusAction.isPending} onClick={() => statusAction.mutate({ action: 'Reopened', status: 'Reopened' })}>Reopen</button>
              </>
            )}

          </div>
          {canCancel && (
            <form className="grid-form" onSubmit={(event) => {
              event.preventDefault()
              if (!cancelReason.trim()) {
                setStatusError('Enter a cancellation reason.')
                return
              }
              statusAction.mutate({ action: 'Cancelled', status: 'Cancelled', reason: cancelReason.trim() })
            }}>
              <label className="full">
                <span className="field-caption">Cancellation reason</span>
                <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} required rows={2} />
              </label>
              <div className="actions full">
                <button type="submit" className="danger" disabled={statusAction.isPending || !cancelReason.trim()}>{statusAction.isPending ? 'Cancelling...' : 'Cancel ticket'}</button>
              </div>
            </form>
          )}
        </section>
      )}

      {canManageProject && (
        <section className="card">
          <h2>Contribution percentages</h2>
          {contributions.isError && <div className="banner error" role="alert">Could not load contributors: {contributions.error.message}</div>}
          {contributions.isLoading ? <p className="muted small">Loading contributors...</p> : (
            <>
              {contributorDraft.map((contributor) => (
                <label className="contributor-editor-row" key={contributor.profile_id}>
                  <span>{contributor.full_name}</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={contributor.percent}
                    aria-label={`${contributor.full_name} contribution percentage`}
                    onChange={(event) => {
                      const percent = event.target.value
                      setContributionDraft((current) => (current ?? baseContributors).map((row) =>
                        row.profile_id === contributor.profile_id ? { ...row, percent } : row,
                      ))
                    }}
                  />
                </label>
              ))}
              {availableContributors.length > 0 && (
                <div className="actions">
                  <select value={newContributorId} onChange={(event) => setNewContributorId(event.target.value)} aria-label="Add contributor">
                    <option value="">Add someone with project access</option>
                    {availableContributors.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
                  </select>
                  <button type="button" className="secondary" disabled={!newContributorId} onClick={() => {
                    const person = availableContributors.find((candidate) => candidate.id === newContributorId)
                    if (!person) return
                    setContributionDraft((current) => [
                      ...(current ?? baseContributors),
                      { profile_id: person.id, full_name: person.full_name, percent: '0' },
                    ])
                    setNewContributorId('')
                  }}>Add contributor</button>
                </div>
              )}
              <p className="muted small">
                Total: {contributionTotalLabel}%{contributionTotalIsValid ? '' : ' — must equal 100%'}
              </p>
              {ticket.data.status === 'Approved' && (
                <label>
                  <span className="field-caption">Change reason</span>
                  <textarea value={contributionReason} onChange={(event) => setContributionReason(event.target.value)} required rows={2} />
                </label>
              )}
              {contributionError && <div className="banner error" role="alert">{contributionError}</div>}
              <div className="actions">
                <button
                  type="button"
                  disabled={!contributionTotalIsValid || saveContributions.isPending || contributions.isError || (ticket.data.status === 'Approved' && !contributionReason.trim())}
                  onClick={() => saveContributions.mutate()}
                >
                  {saveContributions.isPending ? 'Saving...' : 'Save contributions'}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}
