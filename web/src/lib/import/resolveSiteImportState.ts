import type { ReferenceMatchResult } from './referenceMatcher.ts'

export interface SiteImportStateReview {
  stateMatch: ReferenceMatchResult
  reviewDecision: 'pending' | 'accepted' | 'rejected'
  selectedState: string
}

export interface SiteImportEligibility extends SiteImportStateReview {
  duplicate: boolean
}

export function resolveSiteImportState(row: SiteImportStateReview): string | null {
  const { stateMatch } = row

  if (
    stateMatch.status === 'exact' ||
    stateMatch.status === 'normalized' ||
    stateMatch.status === 'alias'
  ) {
    return stateMatch.canonicalValue
  }
  if (
    stateMatch.status === 'suggestion' &&
    row.reviewDecision === 'accepted' &&
    row.selectedState === stateMatch.suggestedValue
  ) {
    return stateMatch.suggestedValue
  }
  if (
    stateMatch.status === 'ambiguous' &&
    row.reviewDecision === 'accepted' &&
    stateMatch.candidates.includes(row.selectedState)
  ) {
    return row.selectedState
  }

  return null
}

export function isSiteImportRowImportable(row: SiteImportEligibility): boolean {
  return !row.duplicate && resolveSiteImportState(row) !== null
}
