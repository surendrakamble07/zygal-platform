import { useMemo } from 'react'
import type { ReferenceMatchResult } from '../lib/import/referenceMatcher.ts'
import {
  isSiteImportRowImportable,
  resolveSiteImportState,
} from '../lib/import/resolveSiteImportState.ts'

export interface SiteImportIssue {
  row: number
  reason: string
}

export type SiteImportReviewDecision = 'pending' | 'accepted' | 'rejected'

export interface SiteImportPreviewRow {
  row: number
  branchCode: string
  originalState: string
  stateMatch: ReferenceMatchResult
  duplicate: boolean
  reviewDecision: SiteImportReviewDecision
  selectedState: string
}

export interface SiteImportResult {
  inserted: number
  failed: number
  skipped: number
  duplicates: number
  details: readonly SiteImportIssue[]
}

interface Props {
  fileName: string
  totalRows: number
  validRows: number
  rows: readonly SiteImportPreviewRow[]
  issues: readonly SiteImportIssue[]
  result: SiteImportResult | null
  importing: boolean
  onConfirmImport: () => void
  onAcceptSuggestion: (row: number) => void
  onRejectReview: (row: number) => void
  onSelectCandidate: (row: number, state: string) => void
  onConfirmCandidate: (row: number) => void
  onResetReview: (row: number) => void
  onClose: () => void
}

function stateStatusLabel(row: SiteImportPreviewRow): string {
  switch (row.stateMatch.status) {
    case 'exact':
      return 'Exact match'
    case 'normalized':
      return 'Normalized'
    case 'alias':
      return 'Auto-corrected'
    case 'suggestion':
      if (row.reviewDecision === 'accepted') return 'Fuzzy suggestion accepted'
      if (row.reviewDecision === 'rejected') return 'Suggestion rejected'
      return 'Needs confirmation'
    case 'ambiguous':
      if (row.reviewDecision === 'accepted') return 'Manual choice confirmed'
      if (row.reviewDecision === 'rejected') return 'Rejected'
      return 'Ambiguous'
    case 'invalid-alias':
      return 'Invalid alias target'
    case 'unmatched':
      return 'Invalid'
  }
}

function stateStatusTone(row: SiteImportPreviewRow): string {
  switch (row.stateMatch.status) {
    case 'exact':
    case 'normalized':
    case 'alias':
      return 'success'
    case 'suggestion':
    case 'ambiguous':
      return row.reviewDecision === 'rejected' ? 'danger' : 'warning'
    case 'invalid-alias':
    case 'unmatched':
      return 'danger'
  }
}

function suggestedState(row: SiteImportPreviewRow): string {
  const { stateMatch } = row
  if (
    stateMatch.status === 'exact' ||
    stateMatch.status === 'normalized' ||
    stateMatch.status === 'alias'
  ) {
    return stateMatch.canonicalValue
  }
  if (stateMatch.status === 'suggestion') return stateMatch.suggestedValue
  if (stateMatch.status === 'ambiguous') return 'Review candidates'
  if (stateMatch.status === 'invalid-alias') return 'No valid alias target'
  return 'No match'
}

export default function SiteImportPreview({
  fileName,
  totalRows,
  validRows,
  rows,
  issues,
  result,
  importing,
  onConfirmImport,
  onAcceptSuggestion,
  onRejectReview,
  onSelectCandidate,
  onConfirmCandidate,
  onResetReview,
  onClose,
}: Props) {
  const summary = useMemo(() => {
    const counts = {
      exact: 0,
      normalized: 0,
      aliases: 0,
      fuzzyPending: 0,
      ambiguous: 0,
      invalid: 0,
      duplicates: 0,
      unresolved: 0,
      ready: 0,
    }

    for (const row of rows) {
      switch (row.stateMatch.status) {
        case 'exact':
          counts.exact += 1
          break
        case 'normalized':
          counts.normalized += 1
          break
        case 'alias':
          counts.aliases += 1
          break
        case 'suggestion':
          if (row.reviewDecision === 'pending') counts.fuzzyPending += 1
          break
        case 'ambiguous':
          counts.ambiguous += 1
          break
        case 'invalid-alias':
        case 'unmatched':
          counts.invalid += 1
          break
      }

      if (row.duplicate) counts.duplicates += 1
      const state = resolveSiteImportState(row)
      if (state === null) counts.unresolved += 1
      if (isSiteImportRowImportable(row)) counts.ready += 1
    }

    return counts
  }, [rows])

  return (
    <section className="card site-import-preview" aria-labelledby="site-import-preview-title">
      <div className="head-row">
        <div>
          <h2 id="site-import-preview-title">Smart import preview</h2>
          <p className="site-import-file-name">{fileName}</p>
        </div>
        <button type="button" className="secondary" disabled={importing} onClick={onClose}>
          Close preview
        </button>
      </div>

      <div className="banner info" role="status">
        {result
          ? 'Import complete. Close this preview before preparing another file.'
          : 'Preview only. No sites will be written until you confirm the import.'}
      </div>

      <div className="site-import-summary" aria-label="Import preview summary">
        <div className="site-import-metric">
          <strong>{totalRows}</strong>
          <span>Total Excel rows</span>
        </div>
        <div className="site-import-metric">
          <strong>{validRows}</strong>
          <span>Valid rows (required values and project)</span>
        </div>
        <div className="site-import-metric">
          <strong>{summary.exact}</strong>
          <span>Exact matches</span>
        </div>
        <div className="site-import-metric">
          <strong>{summary.normalized}</strong>
          <span>Automatically normalized</span>
        </div>
        <div className="site-import-metric">
          <strong>{summary.aliases}</strong>
          <span>Known alias corrections</span>
        </div>
        <div className="site-import-metric">
          <strong>{summary.fuzzyPending}</strong>
          <span>Fuzzy suggestions needing confirmation</span>
        </div>
        <div className="site-import-metric">
          <strong>{summary.ambiguous}</strong>
          <span>Ambiguous values</span>
        </div>
        <div className="site-import-metric">
          <strong>{summary.invalid}</strong>
          <span>Invalid state values</span>
        </div>
        <div className="site-import-metric">
          <strong>{summary.duplicates}</strong>
          <span>Duplicate site-code rows</span>
        </div>
        <div className="site-import-metric">
          <strong>{summary.unresolved}</strong>
          <span>Unresolved state rows</span>
        </div>
        <div className="site-import-metric">
          <strong>{summary.ready}</strong>
          <span>Ready to import</span>
        </div>
      </div>

      {result && (
        <div
          className={`banner ${
            result.failed > 0 || result.skipped > 0 || result.duplicates > 0 ? 'warn' : 'info'
          }`}
          role="status"
        >
          <p>
            Import finished: {result.inserted} inserted, {result.failed} failed, {result.skipped} skipped,
            {` ${result.duplicates} duplicate rows.`}
          </p>
          {result.details.length > 0 && (
            <details className="site-import-issues">
              <summary>View {result.details.length} skipped, duplicate, or failed row(s)</summary>
              <ul>
                {result.details.map((detail) => (
                  <li key={`${detail.row}-${detail.reason}`}>
                    Excel row {detail.row}: {detail.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {issues.length > 0 && (
        <details className="site-import-issues">
          <summary>{issues.length} row(s) have missing required values or an unknown project</summary>
          <ul>
            {issues.map((issue) => (
              <li key={`${issue.row}-${issue.reason}`}>
                Excel row {issue.row}: {issue.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {rows.length === 0 ? (
        <div className="banner warn">No rows have all required values and a recognized project.</div>
      ) : (
        <div className="table-wrap site-import-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Excel Row</th>
                <th>Branch Code</th>
                <th>Original State</th>
                <th>Suggested State</th>
                <th>Status</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.row}>
                  <td>{row.row}</td>
                  <td>{row.branchCode}</td>
                  <td className="site-import-original-state">{row.originalState}</td>
                  <td>
                    {suggestedState(row)}
                    {row.stateMatch.status === 'ambiguous' && (
                      <small className="site-import-candidates">
                        {row.stateMatch.candidates.join(', ')}
                      </small>
                    )}
                  </td>
                  <td>
                    <span className={`status-badge ${stateStatusTone(row)}`}>
                      {stateStatusLabel(row)}
                    </span>
                    {row.duplicate && (
                      <span className="status-badge danger site-import-duplicate-badge">
                        Duplicate site code
                      </span>
                    )}
                  </td>
                  <td>
                    {row.stateMatch.status === 'suggestion' &&
                      (row.reviewDecision === 'pending' ? (
                        <div className="site-import-review-actions">
                          <button
                            type="button"
                            className="secondary"
                            disabled={importing || result !== null}
                            onClick={() => onAcceptSuggestion(row.row)}
                          >
                            Accept suggestion
                          </button>
                          <button
                            type="button"
                            className="link"
                            disabled={importing || result !== null}
                            onClick={() => onRejectReview(row.row)}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <div className="site-import-review-actions">
                          <span className="hint">
                            {row.reviewDecision === 'accepted' ? 'Accepted for preview' : 'Rejected'}
                          </span>
                          <button
                            type="button"
                            className="link"
                            disabled={importing || result !== null}
                            onClick={() => onResetReview(row.row)}
                          >
                            Change
                          </button>
                        </div>
                      ))}
                    {row.stateMatch.status === 'ambiguous' &&
                      (row.reviewDecision === 'pending' ? (
                        <div className="site-import-review-actions">
                          <select
                            aria-label={`Choose a state for Excel row ${row.row}`}
                            value={row.selectedState}
                            disabled={importing || result !== null}
                            onChange={(event) => onSelectCandidate(row.row, event.target.value)}
                          >
                            <option value="">Choose a state</option>
                            {row.stateMatch.candidates.map((candidate) => (
                              <option key={candidate} value={candidate}>
                                {candidate}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="secondary"
                            disabled={
                              importing ||
                              result !== null ||
                              !row.stateMatch.candidates.includes(row.selectedState)
                            }
                            onClick={() => onConfirmCandidate(row.row)}
                          >
                            Confirm choice
                          </button>
                          <button
                            type="button"
                            className="link"
                            disabled={importing || result !== null}
                            onClick={() => onRejectReview(row.row)}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <div className="site-import-review-actions">
                          <span className="hint">
                            {row.reviewDecision === 'accepted'
                              ? `Selected: ${row.selectedState}`
                              : 'Rejected'}
                          </span>
                          <button
                            type="button"
                            className="link"
                            disabled={importing || result !== null}
                            onClick={() => onResetReview(row.row)}
                          >
                            Change
                          </button>
                        </div>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!result && (
        <div className="actions">
          <button
            type="button"
            disabled={importing || summary.ready === 0}
            onClick={onConfirmImport}
          >
            {importing ? 'Importing...' : `Confirm & Import (${summary.ready})`}
          </button>
        </div>
      )}
    </section>
  )
}
