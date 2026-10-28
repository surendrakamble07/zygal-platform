interface Props {
  status: string
}

function getTone(status: string): string {
  const normalized = status.trim().toLowerCase()
  if (/^(active|completed|complete|resolved|live|done|online|ok)$/.test(normalized)) return 'success'
  if (/pending|warning|partially/.test(normalized)) return 'warning'
  if (/blocked|inactive|failed|rejected|error|offline|deactivated|removed/.test(normalized)) return 'danger'
  if (normalized === 'logged in') return 'progress'
  if (normalized === 'logged out') return 'neutral'
  if (normalized === 'timed out') return 'warning'
  if (/created|logged in/.test(normalized)) return 'success'
  if (/updated|changed|status change/.test(normalized)) return 'progress'
  if (/wip|progress|working|in progress/.test(normalized)) return 'progress'
  return 'neutral'
}

export default function StatusBadge({ status }: Props) {
  return <span className={`status-badge ${getTone(status)}`}>{status}</span>
}
