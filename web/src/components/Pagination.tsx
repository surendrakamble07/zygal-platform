interface Props {
  currentPage: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
  disabled?: boolean
  itemLabel?: string
}

type PageToken = number | 'ellipsis'

function getPageTokens(currentPage: number, pageCount: number): PageToken[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index)
  if (currentPage <= 2) return [0, 1, 2, 3, 'ellipsis', pageCount - 1]
  if (currentPage >= pageCount - 3) {
    return [0, 'ellipsis', pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1]
  }
  return [0, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', pageCount - 1]
}

export default function Pagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  disabled = false,
  itemLabel = 'items',
}: Props) {
  const pageCount = Math.ceil(totalItems / pageSize)
  const first = totalItems === 0 ? 0 : currentPage * pageSize + 1
  const last = Math.min((currentPage + 1) * pageSize, totalItems)

  return (
    <div className="shared-pagination">
      <span className="muted small">
        {totalItems === 0 ? `0 ${itemLabel}` : `Showing ${first}-${last} of ${totalItems} ${itemLabel}`}
      </span>
      <nav className="pagination-controls" aria-label="Pagination">
        <button
          type="button"
          className="secondary pagination-arrow"
          aria-label="Previous page"
          disabled={disabled || currentPage <= 0}
          onClick={() => onPageChange(currentPage - 1)}
        >
          ‹
        </button>
        {getPageTokens(currentPage, pageCount).map((token, index) => token === 'ellipsis'
          ? <span className="pagination-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">…</span>
          : (
            <button
              type="button"
              className={token === currentPage ? 'secondary pagination-page active' : 'secondary pagination-page'}
              aria-label={`Page ${token + 1}`}
              aria-current={token === currentPage ? 'page' : undefined}
              disabled={disabled || token === currentPage}
              key={token}
              onClick={() => onPageChange(token)}
            >
              {token + 1}
            </button>
          ))}
        <button
          type="button"
          className="secondary pagination-arrow"
          aria-label="Next page"
          disabled={disabled || currentPage >= pageCount - 1}
          onClick={() => onPageChange(currentPage + 1)}
        >
          ›
        </button>
      </nav>
    </div>
  )
}
