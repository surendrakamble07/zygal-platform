import type { QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

export function invalidateTicketNotificationQueries(queryClient: QueryClient, recipientIds: string[]) {
  for (const recipientId of new Set(recipientIds)) {
    void queryClient.invalidateQueries({ queryKey: ['ticket-notifications', recipientId] })
    void queryClient.invalidateQueries({ queryKey: ['ticket-notification-unread-count', recipientId] })
  }
}

export async function insertTicketNotifications(
  ticketId: string,
  type: string,
  message: string,
  recipientIds: string[],
) {
  const uniqueRecipients = [...new Set(recipientIds)]
  if (!uniqueRecipients.length) return
  const { error } = await supabase.rpc('create_ticket_notifications', {
    p_ticket_id: ticketId,
    p_type: type,
    p_message: message,
    p_recipient_ids: uniqueRecipients,
  })
  if (error) throw error
}

export async function getProjectTeamLeadIds(projectId: string) {
  const { data: accessRows, error: accessError } = await supabase
    .from('profile_projects')
    .select('profile_id')
    .eq('project_id', projectId)
  if (accessError) throw accessError

  const profileIds = [...new Set((accessRows ?? []).map((row) => row.profile_id as string))]
  if (!profileIds.length) return []
  const { data: leadRows, error: leadsError } = await supabase
    .from('profiles')
    .select('id')
    .in('id', profileIds)
    .eq('role', 'team_lead')
  if (leadsError) throw leadsError
  return (leadRows ?? []).map((row) => row.id as string)
}
