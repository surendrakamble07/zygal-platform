import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import Pagination from '../components/Pagination'
import { TableEmptyState, TableSkeleton } from '../components/TableStates'
import { useAuth } from '../auth/auth-context'
import { supabase } from '../lib/supabase'
import { insertTicketNotifications, invalidateTicketNotificationQueries } from '../lib/ticket-notifications'

interface TicketProject {
  id: string
  name: string
}

interface TicketSite {
  id: string
  branch_code: string
  branch_name: string | null
}

interface ProjectTicket {
  id: string
  project_id: string
  site_id: string
  status: string
  created_at: string
  site_name: string
  assignee_name: string
  assigned_to: string | null
}

interface TicketEmployee {
  id: string
  full_name: string
}

const SITE_PAGE_SIZE = 50

export default function TicketsPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [projectId, setProjectId] = useState('')
  const [activeTab, setActiveTab] = useState<'plans' | 'tickets'>('plans')
  const [planType, setPlanType] = useState<'Daily' | 'Weekly'>('Daily')
  const [planDate, setPlanDate] = useState('')
  const [selectedSites, setSelectedSites] = useState<string[]>([])
  const [siteSearchInput, setSiteSearchInput] = useState('')
  const [siteSearch, setSiteSearch] = useState('')
  const [sitePage, setSitePage] = useState(0)
  const [generationError, setGenerationError] = useState('')
  const [generationNotice, setGenerationNotice] = useState('')
  const [selectedTicketId, setSelectedTicketId] = useState('')
  const [selectedAssignee, setSelectedAssignee] = useState('')
  const [assignmentError, setAssignmentError] = useState('')
  const [notificationError, setNotificationError] = useState('')
  const allProjects = useQuery({
    queryKey: ['ticket-projects-admin'],
    enabled: profile?.role === 'admin',
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, name').order('name')
      if (error) throw error
      return (data ?? []) as TicketProject[]
    },
  })
  const sites = useQuery({
    queryKey: ['ticket-sites', projectId, siteSearch, sitePage],
    enabled: !!projectId,
    queryFn: async () => {
      let query = supabase
        .from('sites')
        .select('id, branch_code, branch_name', { count: 'exact' })
        .eq('project_id', projectId)
      const cleanSearch = siteSearch.replace(/[,()*%\\"]/g, ' ').trim()
      if (cleanSearch) {
        query = query.or(`branch_code.ilike.*${cleanSearch}*,branch_name.ilike.*${cleanSearch}*`)
      }
      const from = sitePage * SITE_PAGE_SIZE
      const { data, count, error } = await query
        .order('branch_code')
        .range(from, from + SITE_PAGE_SIZE - 1)
      if (error) throw error
      return { rows: (data ?? []) as TicketSite[], total: count ?? 0 }
    },
  })
  const projectTickets = useQuery({
    queryKey: ['project-tickets', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data: ticketRows, error: ticketsError } = await supabase
        .from('tickets')
        .select('id, project_id, site_id, status, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (ticketsError) throw ticketsError
      const tickets = ticketRows ?? []
      if (!tickets.length) return [] as ProjectTicket[]

      const ticketIds = tickets.map((ticket) => ticket.id as string)
      const siteIds = [...new Set(tickets.map((ticket) => ticket.site_id as string))]
      const { data: assignmentRows, error: assignmentsError } = await supabase
        .from('ticket_assignments')
        .select('ticket_id, assigned_to')
        .in('ticket_id', ticketIds)
        .eq('is_current', true)
      if (assignmentsError) throw assignmentsError

      const assignedIds = [...new Set((assignmentRows ?? []).map((assignment) => assignment.assigned_to as string))]
      const [siteResult, profileResult] = await Promise.all([
        supabase.from('sites').select('id, branch_code, branch_name').in('id', siteIds),
        assignedIds.length
          ? supabase.from('profiles').select('id, full_name').in('id', assignedIds)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (siteResult.error) throw siteResult.error
      if (profileResult.error) throw profileResult.error

      const sitesById = new Map((siteResult.data ?? []).map((site) => [
        site.id as string,
        [site.branch_code, site.branch_name].filter(Boolean).join(' — '),
      ]))
      const peopleById = new Map((profileResult.data ?? []).map((person) => [
        person.id as string,
        person.full_name as string,
      ]))
      const assigneeByTicket = new Map((assignmentRows ?? []).map((assignment) => [
        assignment.ticket_id as string,
        assignment.assigned_to as string,
      ]))
      return tickets.map((ticket) => {
        const assignedTo = assigneeByTicket.get(ticket.id as string) ?? null
        return {
          id: ticket.id as string,
          project_id: ticket.project_id as string,
          site_id: ticket.site_id as string,
          status: ticket.status as string,
          created_at: ticket.created_at as string,
          site_name: sitesById.get(ticket.site_id as string) ?? 'Unknown site',
          assignee_name: assignedTo ? peopleById.get(assignedTo) ?? 'Unknown employee' : 'Unassigned',
          assigned_to: assignedTo,
        }
      })
    },
  })
  const assignmentCandidates = useQuery({
    queryKey: ['ticket-assignees', projectId],
    enabled: !!projectId && (profile?.role === 'team_lead' || profile?.role === 'admin'),
    queryFn: async () => {
      const { data: accessRows, error: accessError } = await supabase
        .from('profile_projects')
        .select('profile_id')
        .eq('project_id', projectId)
      if (accessError) throw accessError
      const profileIds = [...new Set((accessRows ?? []).map((row) => row.profile_id as string))]
      if (!profileIds.length) return [] as TicketEmployee[]
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', profileIds)
        .order('full_name')
      if (error) throw error
      return (data ?? []) as TicketEmployee[]
    },
  })
  const authorizedProjects = useQuery({
    queryKey: ['ticket-projects', profile?.id, profile?.role],
    enabled: !!profile && profile.role !== 'admin',
    queryFn: async () => {
      if (!profile?.id) throw new Error('Your profile is unavailable.')
      const { data: accessRows, error: accessError } = await supabase
        .from('profile_projects')
        .select('project_id')
        .eq('profile_id', profile.id)
      if (accessError) throw accessError

      const projectIds = [...new Set((accessRows ?? []).map((row) => row.project_id as string))]
      if (!projectIds.length) return [] as TicketProject[]

      const { data, error } = await supabase
        .from('projects')
        .select('id, name')
        .in('id', projectIds)
        .order('name')
      if (error) throw error
      return (data ?? []) as TicketProject[]
    },
  })
  const projects = profile?.role === 'admin'
    ? allProjects.data ?? []
    : authorizedProjects.data ?? []
  const projectsLoading = profile?.role === 'admin'
    ? allProjects.isLoading
    : authorizedProjects.isLoading
  const projectsError = profile?.role === 'admin'
    ? allProjects.error
    : authorizedProjects.error
  const selectedProject = projects.find((project) => project.id === projectId)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSiteSearch(siteSearchInput.trim())
      setSitePage(0)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [siteSearchInput])
  const selectedTicket = projectTickets.data?.find((ticket) => ticket.id === selectedTicketId)
  const assignTicket = useMutation({
    mutationFn: async () => {
      if (!selectedTicket || !selectedAssignee) throw new Error('Choose an employee.')
      const { error } = await supabase.rpc('assign_ticket', {
        p_ticket_id: selectedTicket.id,
        p_employee_id: selectedAssignee,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setAssignmentError('')
      setNotificationError('')
      const ticket = selectedTicket
      const recipientId = selectedAssignee
      setSelectedTicketId('')
      setSelectedAssignee('')
      void queryClient.invalidateQueries({ queryKey: ['project-tickets', projectId] })
      if (ticket && recipientId) {
        void insertTicketNotifications(
          ticket.id,
          'Assigned',
          `You have been assigned the ticket for ${ticket.site_name}.`,
          [recipientId],
        ).then(() => invalidateTicketNotificationQueries(queryClient, [recipientId]))
          .catch((error: Error) => setNotificationError(`Assignment succeeded, but the notification could not be sent: ${error.message}`))
      }
    },
    onError: (error: Error) => setAssignmentError(error.message),
  })
  const generateTickets = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error('Choose a project.')
      if (!planDate) throw new Error('Choose a plan date.')
      if (selectedSites.length === 0) throw new Error('Select at least one site.')

      let foundActiveTicket = false
      for (const siteId of selectedSites) {
        const { data, error } = await supabase.rpc('site_has_active_ticket', { p_site_id: siteId })
        if (error) throw error
        if (data) foundActiveTicket = true
      }
      if (foundActiveTicket && !window.confirm('An active ticket already exists for this site. Continue anyway?')) {
        return { cancelled: true, count: 0 }
      }

      const { data: plan, error: planError } = await supabase
        .from('ticket_plans')
        .insert({ project_id: projectId, plan_type: planType, plan_date: planDate })
        .select('id')
        .single()
      if (planError) throw planError
      if (!plan?.id) throw new Error('The plan was created without returning an ID.')

      const { error: ticketsError } = await supabase
        .from('tickets')
        .insert(selectedSites.map((site_id) => ({
          plan_id: plan.id,
          project_id: projectId,
          site_id,
        })))
      if (ticketsError) throw ticketsError
      return { cancelled: false, count: selectedSites.length }
    },
    onSuccess: (result) => {
      setGenerationError('')
      if (result.cancelled) {
        setGenerationNotice('')
        return
      }
      setGenerationNotice(`Created ${result.count} ticket${result.count === 1 ? '' : 's'}.`)
      setSelectedSites([])
      void queryClient.invalidateQueries({ queryKey: ['project-tickets', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['project-plans', projectId] })
    },
    onError: (error: Error) => {
      setGenerationNotice('')
      setGenerationError(error.message)
    },
  })

  return (
    <div className="tickets-page">
      <section className="card">
        <div className="head-row">
          <div>
            <h1>Tickets</h1>
            <p className="muted small">Plans and ticket work are scoped to the selected project.</p>
          </div>
          <label>
            <span className="field-caption">Project</span>
            <select
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value)
                setSelectedSites([])
                setSiteSearchInput('')
                setSiteSearch('')
                setSitePage(0)
                setSelectedTicketId('')
                setGenerationError('')
                setGenerationNotice('')
              }}
              disabled={projectsLoading || !!projectsError || projects.length === 0}
            >
              <option value="">
                {projectsLoading ? 'Loading projects...' : 'Choose a project'}
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
        </div>
        {projectsError && (
          <div className="banner error" role="alert">
            Could not load projects: {projectsError.message}
          </div>
        )}
        {!projectsLoading && !projectsError && projects.length === 0 && (
          <div className="empty-state compact">No projects are available to your account.</div>
        )}
      </section>

      {selectedProject && (
        <section className="card">
          <div className="tab-row" role="tablist" aria-label="Project ticket views">
            <button type="button" className={activeTab === 'plans' ? 'tab active' : 'tab'} role="tab" aria-selected={activeTab === 'plans'} onClick={() => setActiveTab('plans')}>Plans</button>
            <button type="button" className={activeTab === 'tickets' ? 'tab active' : 'tab'} role="tab" aria-selected={activeTab === 'tickets'} onClick={() => setActiveTab('tickets')}>Tickets</button>
          </div>
          <p className="muted small">{selectedProject.name}</p>
          {activeTab === 'plans' && (
            <form className="grid-form" onSubmit={(event) => { event.preventDefault(); generateTickets.mutate() }}>
              <label>
                <span className="field-caption">Plan type</span>
                <select value={planType} onChange={(event) => setPlanType(event.target.value as 'Daily' | 'Weekly')}>
                  <option value="Daily">Daily</option>
                  <option value="Weekly">Weekly</option>
                </select>
              </label>
              <label>
                <span className="field-caption">Plan date</span>
                <input type="date" value={planDate} onChange={(event) => setPlanDate(event.target.value)} required />
              </label>
              <div className="full">
                <span className="field-caption">Sites</span>
                <div className="ticket-site-picker-toolbar">
                  <input
                    type="search"
                    placeholder="Search branch code or name"
                    aria-label="Search sites by branch code or name"
                    value={siteSearchInput}
                    onChange={(event) => setSiteSearchInput(event.target.value)}
                  />
                  <span className="muted small" aria-live="polite">
                    {selectedSites.length} {selectedSites.length === 1 ? 'site' : 'sites'} selected
                  </span>
                </div>
                {sites.isError ? (
                  <div className="banner error" role="alert">Could not load sites: {sites.error.message}</div>
                ) : sites.isLoading ? (
                  <div className="table-wrap"><table><tbody><TableSkeleton columns={1} rows={3} /></tbody></table></div>
                ) : sites.data?.rows.length ? (
                  <div className="check-list">
                    {sites.data.rows.map((site) => (
                      <label key={site.id} className="check-item">
                        <input
                          type="checkbox"
                          checked={selectedSites.includes(site.id)}
                          onChange={() => setSelectedSites((current) =>
                            current.includes(site.id)
                              ? current.filter((id) => id !== site.id)
                              : [...current, site.id],
                          )}
                        />
                        <span>{site.branch_code}{site.branch_name ? ` — ${site.branch_name}` : ''}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="table-wrap"><table><tbody><TableEmptyState columns={1} message={siteSearch ? 'No sites match this search.' : 'No sites are available in this project.'} /></tbody></table></div>
                )}
                {!sites.isLoading && !sites.isError && (sites.data?.total ?? 0) > SITE_PAGE_SIZE && (
                  <Pagination
                    currentPage={sitePage}
                    totalItems={sites.data?.total ?? 0}
                    pageSize={SITE_PAGE_SIZE}
                    onPageChange={setSitePage}
                    disabled={sites.isFetching}
                    itemLabel="sites"
                  />
                )}
              </div>
              {generationError && <div className="banner error full" role="alert">{generationError}</div>}
              {generationNotice && <div className="banner info full" role="status">{generationNotice}</div>}
              <div className="actions full">
                <button type="submit" disabled={generateTickets.isPending || sites.isLoading || sites.isError || selectedSites.length === 0}>
                  {generateTickets.isPending ? 'Generating...' : 'Create plan and generate tickets'}
                </button>
              </div>
            </form>
          )}
          {activeTab === 'tickets' && (
            <>
              {notificationError && <div className="banner error" role="alert">{notificationError}</div>}
              {projectTickets.isError && <div className="banner error" role="alert">Could not load tickets: {projectTickets.error.message}</div>}
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Status</th><th>Site</th><th>Current assignee</th><th>Created</th>{(profile?.role === 'team_lead' || profile?.role === 'admin') && <th>Assignment</th>}</tr></thead>
                  <tbody>
                    {projectTickets.isLoading && <TableSkeleton columns={profile?.role === 'team_lead' || profile?.role === 'admin' ? 5 : 4} />}
                    {!projectTickets.isLoading && !projectTickets.isError && projectTickets.data?.length === 0 && (
                      <TableEmptyState columns={profile?.role === 'team_lead' || profile?.role === 'admin' ? 5 : 4} message="No tickets in this project." />
                    )}
                    {projectTickets.data?.map((ticket) => (
                      <tr key={ticket.id}>
                        <td><span className="status-badge neutral">{ticket.status}</span></td>
                        <td><Link className="link" to={`/tickets/${ticket.id}`}>{ticket.site_name}</Link></td>
                        <td>{ticket.assignee_name}</td>
                        <td>{new Date(ticket.created_at).toLocaleDateString()}</td>
                        {(profile?.role === 'team_lead' || profile?.role === 'admin') && (
                          <td className="row-actions">
                            <button type="button" className="link" onClick={() => {
                              setSelectedTicketId(ticket.id)
                              setSelectedAssignee(ticket.assigned_to ?? '')
                              setAssignmentError('')
                            }}>
                              {ticket.assigned_to ? 'Reassign' : 'Assign'}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {selectedTicket && (profile?.role === 'team_lead' || profile?.role === 'admin') && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelectedTicketId('')}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Assign ticket">
            <h2>{selectedTicket.assigned_to ? 'Reassign ticket' : 'Assign ticket'}</h2>
            <p className="muted small">{selectedTicket.site_name}</p>
            {assignmentCandidates.isError ? (
              <div className="banner error" role="alert">Could not load project employees: {assignmentCandidates.error.message}</div>
            ) : (
              <label>
                <span className="field-caption">Employee with project access</span>
                <select value={selectedAssignee} onChange={(event) => setSelectedAssignee(event.target.value)}>
                  <option value="">Choose an employee</option>
                  {assignmentCandidates.data?.map((employee) => (
                    <option key={employee.id} value={employee.id}>{employee.full_name}</option>
                  ))}
                </select>
              </label>
            )}
            {assignmentError && <div className="banner error" role="alert">{assignmentError}</div>}
            <div className="actions">
              <button type="button" className="secondary" onClick={() => setSelectedTicketId('')} disabled={assignTicket.isPending}>Cancel</button>
              <button type="button" onClick={() => assignTicket.mutate()} disabled={assignTicket.isPending || assignmentCandidates.isLoading || assignmentCandidates.isError || !selectedAssignee}>
                {assignTicket.isPending ? 'Assigning...' : 'Confirm assignment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
