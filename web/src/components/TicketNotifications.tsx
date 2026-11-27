import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import Icon from './Icon'

interface Props {
  profileId: string
}

interface TicketNotification {
  id: number
  ticket_id: string
  type: string
  message: string
  is_read: boolean
  created_at: string
}

export default function TicketNotifications({ profileId }: Props) {
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const recent = useQuery({
    queryKey: ['ticket-notifications', profileId],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_notifications')
        .select('id, ticket_id, type, message, is_read, created_at')
        .eq('recipient_id', profileId)
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return (data ?? []) as TicketNotification[]
    },
  })
  const unreadCount = useQuery({
    queryKey: ['ticket-notification-unread-count', profileId],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('ticket_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', profileId)
        .eq('is_read', false)
      if (error) throw error
      return count ?? 0
    },
  })
  const markRead = useMutation({
    mutationFn: async (notificationId: number) => {
      const { error } = await supabase
        .from('ticket_notifications')
        .update({ is_read: true })
        .eq('id', notificationId)
        .eq('recipient_id', profileId)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ticket-notifications', profileId] })
      void queryClient.invalidateQueries({ queryKey: ['ticket-notification-unread-count', profileId] })
    },
  })

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  return (
    <div className="ticket-notification-wrap" ref={rootRef}>
      <button
        type="button"
        className="ticket-notification-trigger"
        aria-label={`Ticket notifications${unreadCount.data ? `, ${unreadCount.data} unread` : ''}`}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Icon name="bell" size={20} />
        {!!unreadCount.data && <span className="ticket-notification-count">{unreadCount.data > 99 ? '99+' : unreadCount.data}</span>}
      </button>
      {isOpen && (
        <div className="ticket-notification-menu" role="region" aria-label="Recent ticket notifications">
          <div className="ticket-notification-heading"><strong>Ticket notifications</strong><span>{unreadCount.isLoading ? '…' : `${unreadCount.data ?? 0} unread`}</span></div>
          {unreadCount.isError && <p className="banner error" role="alert">Could not load unread count: {unreadCount.error.message}</p>}
          {recent.isError && <p className="banner error" role="alert">Could not load notifications: {recent.error.message}</p>}
          {recent.isLoading ? <p className="muted small">Loading notifications...</p> : (
            <div className="ticket-notification-list">
              {recent.data?.map((notification) => (
                <article key={notification.id} className={`ticket-notification-item${notification.is_read ? '' : ' unread'}`}>
                  <Link to={`/tickets/${notification.ticket_id}`} onClick={() => setIsOpen(false)}>
                    <strong>{notification.type}</strong>
                    <span>{notification.message}</span>
                    <time>{new Date(notification.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time>
                  </Link>
                  {!notification.is_read && (
                    <button type="button" className="link" disabled={markRead.isPending} onClick={() => markRead.mutate(notification.id)}>
                      Mark as read
                    </button>
                  )}
                </article>
              ))}
              {!recent.isError && recent.data?.length === 0 && <p className="muted small">No ticket notifications.</p>}
            </div>
          )}
          {markRead.isError && <p className="banner error" role="alert">{markRead.error.message}</p>}
        </div>
      )}
    </div>
  )
}
