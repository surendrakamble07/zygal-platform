import type { ReactNode } from 'react'
import Icon from './Icon'

export function TableSkeleton({ columns, rows = 3 }: { columns: number; rows?: number }) {
  return Array.from({ length: rows }, (_, row) => (
    <tr className="skeleton-row" key={row} aria-hidden="true">
      {Array.from({ length: columns }, (_, column) => (
        <td key={column}>
          <span className="skeleton-bar" style={{ width: `${48 + ((row + column) % 4) * 12}%` }} />
        </td>
      ))}
    </tr>
  ))
}

export function TableEmptyState({
  columns,
  message,
  action,
}: {
  columns: number
  message: string
  action?: ReactNode
}) {
  return (
    <tr>
      <td colSpan={columns}>
        <div className="empty-state">
          <Icon name="empty" className="empty-state-icon" />
          <span>{message}</span>
          {action}
        </div>
      </td>
    </tr>
  )
}
