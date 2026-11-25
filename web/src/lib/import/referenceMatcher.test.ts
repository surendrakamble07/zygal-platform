import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { test } from 'node:test'
import { matchReference } from './referenceMatcher.ts'
import { normalizeReference } from './normalizeReference.ts'
import { STATE_ALIASES } from './stateAliases.ts'

const canonicalStates = [
  'Andhra Pradesh',
  'Bihar',
  'Chhattisgarh',
  'Delhi',
  'Goa',
  'Telangana',
  'Uttarakhand',
]

test('matches an exact canonical state', () => {
  const result = matchReference('Delhi', canonicalStates, { aliases: STATE_ALIASES })
  const telangana = matchReference('Telangana', canonicalStates, { aliases: STATE_ALIASES })

  strictEqual(result.status, 'exact')
  strictEqual(result.originalValue, 'Delhi')
  strictEqual(result.canonicalValue, 'Delhi')
  strictEqual(telangana.status, 'exact')
  strictEqual(telangana.canonicalValue, 'Telangana')
})

test('resolves known aliases to canonical values', () => {
  const newDelhi = matchReference('New Delhi', canonicalStates, { aliases: STATE_ALIASES })
  const chattisgarh = matchReference('Chattisgarh', canonicalStates, { aliases: STATE_ALIASES })
  const andraPradesh = matchReference('Andra Pradesh', canonicalStates, {
    aliases: STATE_ALIASES,
  })

  strictEqual(newDelhi.status, 'alias')
  strictEqual(newDelhi.canonicalValue, 'Delhi')
  strictEqual(chattisgarh.status, 'alias')
  strictEqual(chattisgarh.canonicalValue, 'Chhattisgarh')
  strictEqual(andraPradesh.status, 'alias')
  strictEqual(andraPradesh.canonicalValue, 'Andhra Pradesh')
})

test('normalizes case and extra spaces while preserving the original value', () => {
  const original = '  uTtArAkHaNd   '
  const result = matchReference(original, canonicalStates, { aliases: STATE_ALIASES })

  strictEqual(normalizeReference(original), 'uttarakhand')
  strictEqual(result.status, 'normalized')
  strictEqual(result.originalValue, original)
  strictEqual(result.canonicalValue, 'Uttarakhand')
})

test('returns a fuzzy suggestion without accepting it', () => {
  const result = matchReference('Chhattisgar', canonicalStates, { aliases: STATE_ALIASES })

  strictEqual(result.status, 'suggestion')
  strictEqual(result.originalValue, 'Chhattisgar')
  strictEqual(result.canonicalValue, null)
  strictEqual(result.suggestedValue, 'Chhattisgarh')
})

test('does not guess when fuzzy candidates are equally close', () => {
  const result = matchReference('Bihr', ['Bihar', 'Bihor'])

  strictEqual(result.status, 'ambiguous')
  strictEqual(result.canonicalValue, null)
  deepStrictEqual(result.candidates, ['Bihar', 'Bihor'])
})

test('returns unmatched for values without a safe candidate', () => {
  const result = matchReference('ABCXYZ', canonicalStates, { aliases: STATE_ALIASES })

  strictEqual(result.status, 'unmatched')
  strictEqual(result.originalValue, 'ABCXYZ')
  strictEqual(result.canonicalValue, null)
  strictEqual(result.suggestedValue, null)
})

test('rejects aliases whose target is absent from canonical values', () => {
  const result = matchReference('New Delhi', ['Delhi'], {
    aliases: { 'New Delhi': 'NCT Delhi' },
  })

  strictEqual(result.status, 'invalid-alias')
  strictEqual(result.canonicalValue, null)
})
