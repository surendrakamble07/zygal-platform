import { strictEqual } from 'node:assert/strict'
import { test } from 'node:test'
import { matchReference } from './referenceMatcher.ts'
import { isSiteImportRowImportable, resolveSiteImportState } from './resolveSiteImportState.ts'
import { STATE_ALIASES } from './stateAliases.ts'

const canonicalStates = ['Bihar', 'Chhattisgarh', 'Delhi']

function row(
  state: string,
  reviewDecision: 'pending' | 'accepted' | 'rejected' = 'pending',
  selectedState = '',
  duplicate = false,
) {
  return {
    stateMatch: matchReference(state, canonicalStates, { aliases: STATE_ALIASES }),
    reviewDecision,
    selectedState,
    duplicate,
  }
}

test('allows exact, normalized, and known alias canonical states', () => {
  strictEqual(resolveSiteImportState(row('Delhi')), 'Delhi')
  strictEqual(resolveSiteImportState(row('  DELHI ')), 'Delhi')
  strictEqual(resolveSiteImportState(row('New Delhi')), 'Delhi')
})

test('requires fuzzy suggestions to be accepted', () => {
  const pending = row('Chhattisgar')
  strictEqual(resolveSiteImportState(pending), null)
  strictEqual(isSiteImportRowImportable(pending), false)
  strictEqual(
    resolveSiteImportState(row('Chhattisgar', 'accepted', 'Chhattisgarh')),
    'Chhattisgarh',
  )
})

test('requires an ambiguous candidate to be selected and confirmed', () => {
  const ambiguous = {
    stateMatch: matchReference('Bihr', ['Bihar', 'Bihor']),
    reviewDecision: 'pending' as const,
    selectedState: '',
    duplicate: false,
  }
  strictEqual(resolveSiteImportState(ambiguous), null)
  strictEqual(
    resolveSiteImportState({ ...ambiguous, reviewDecision: 'accepted', selectedState: 'Bihar' }),
    'Bihar',
  )
})

test('never imports unresolved, rejected, or duplicate rows', () => {
  strictEqual(isSiteImportRowImportable(row('ABCXYZ')), false)
  strictEqual(isSiteImportRowImportable(row('Chhattisgar', 'rejected')), false)
  strictEqual(isSiteImportRowImportable(row('Delhi', 'pending', '', true)), false)
})
