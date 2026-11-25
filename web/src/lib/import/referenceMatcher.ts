import { normalizeReference } from './normalizeReference.ts'

export interface ReferenceMatcherOptions {
  aliases?: Readonly<Record<string, string>>
}

interface ResolvedReferenceMatch {
  status: 'exact' | 'normalized' | 'alias'
  originalValue: string
  canonicalValue: string
  suggestedValue: null
  candidates: readonly string[]
  confidence: 1
}

interface SuggestedReferenceMatch {
  status: 'suggestion'
  originalValue: string
  canonicalValue: null
  suggestedValue: string
  candidates: readonly string[]
  confidence: number
}

interface AmbiguousReferenceMatch {
  status: 'ambiguous'
  originalValue: string
  canonicalValue: null
  suggestedValue: null
  candidates: readonly string[]
  confidence: number
}

interface UnmatchedReferenceMatch {
  status: 'unmatched'
  originalValue: string
  canonicalValue: null
  suggestedValue: null
  candidates: readonly string[]
  confidence: 0
}

interface InvalidAliasReferenceMatch {
  status: 'invalid-alias'
  originalValue: string
  canonicalValue: null
  suggestedValue: null
  candidates: readonly string[]
  confidence: 0
  reason: string
}

export type ReferenceMatchResult =
  | ResolvedReferenceMatch
  | SuggestedReferenceMatch
  | AmbiguousReferenceMatch
  | UnmatchedReferenceMatch
  | InvalidAliasReferenceMatch

interface FuzzyCandidate {
  value: string
  distance: number
  confidence: number
}

const MIN_FUZZY_INPUT_LENGTH = 4
const MAX_FUZZY_DISTANCE = 3
const MIN_FUZZY_CONFIDENCE = 0.72
const AMBIGUITY_MARGIN = 0.08

function resolved(
  originalValue: string,
  status: ResolvedReferenceMatch['status'],
  canonicalValue: string,
): ResolvedReferenceMatch {
  return {
    status,
    originalValue,
    canonicalValue,
    suggestedValue: null,
    candidates: [canonicalValue],
    confidence: 1,
  }
}

function ambiguous(
  originalValue: string,
  candidates: readonly string[],
  confidence: number,
): AmbiguousReferenceMatch {
  return {
    status: 'ambiguous',
    originalValue,
    canonicalValue: null,
    suggestedValue: null,
    candidates,
    confidence,
  }
}

function invalidAlias(originalValue: string, reason: string): InvalidAliasReferenceMatch {
  return {
    status: 'invalid-alias',
    originalValue,
    canonicalValue: null,
    suggestedValue: null,
    candidates: [],
    confidence: 0,
    reason,
  }
}

function editDistance(left: string, right: string): number {
  const leftChars = Array.from(left)
  const rightChars = Array.from(right)
  let previousRow = Array.from({ length: rightChars.length + 1 }, (_, index) => index)

  for (let leftIndex = 0; leftIndex < leftChars.length; leftIndex += 1) {
    const currentRow = [leftIndex + 1]

    for (let rightIndex = 0; rightIndex < rightChars.length; rightIndex += 1) {
      const substitutionCost = leftChars[leftIndex] === rightChars[rightIndex] ? 0 : 1
      currentRow.push(
        Math.min(
          currentRow[rightIndex] + 1,
          previousRow[rightIndex + 1] + 1,
          previousRow[rightIndex] + substitutionCost,
        ),
      )
    }

    previousRow = currentRow
  }

  return previousRow[rightChars.length]
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function findFuzzyMatch(
  originalValue: string,
  normalizedInput: string,
  canonicalValues: readonly string[],
): ReferenceMatchResult {
  const inputLength = Array.from(normalizedInput).length
  if (inputLength < MIN_FUZZY_INPUT_LENGTH) {
    return {
      status: 'unmatched',
      originalValue,
      canonicalValue: null,
      suggestedValue: null,
      candidates: [],
      confidence: 0,
    }
  }

  const maxDistance = Math.min(
    MAX_FUZZY_DISTANCE,
    Math.max(1, Math.floor(inputLength * 0.2)),
  )
  const candidates: FuzzyCandidate[] = []

  for (const value of canonicalValues) {
    const normalizedCandidate = normalizeReference(value)
    if (!normalizedCandidate) continue

    const distance = editDistance(normalizedInput, normalizedCandidate)
    const maxLength = Math.max(inputLength, Array.from(normalizedCandidate).length)
    const confidence = 1 - distance / maxLength

    if (distance <= maxDistance && confidence >= MIN_FUZZY_CONFIDENCE) {
      candidates.push({ value, distance, confidence })
    }
  }

  candidates.sort(
    (left, right) =>
      left.distance - right.distance ||
      right.confidence - left.confidence ||
      compareStrings(left.value, right.value),
  )

  const best = candidates[0]
  if (!best) {
    return {
      status: 'unmatched',
      originalValue,
      canonicalValue: null,
      suggestedValue: null,
      candidates: [],
      confidence: 0,
    }
  }

  const closeCandidates = candidates.filter(
    (candidate) =>
      candidate.distance === best.distance ||
      best.confidence - candidate.confidence <= AMBIGUITY_MARGIN,
  )
  if (closeCandidates.length > 1) {
    return ambiguous(
      originalValue,
      closeCandidates.map((candidate) => candidate.value),
      best.confidence,
    )
  }

  return {
    status: 'suggestion',
    originalValue,
    canonicalValue: null,
    suggestedValue: best.value,
    candidates: [best.value],
    confidence: best.confidence,
  }
}

export function matchReference(
  originalValue: string,
  canonicalValues: readonly string[],
  options: ReferenceMatcherOptions = {},
): ReferenceMatchResult {
  const canonical = [...new Set(canonicalValues.filter((value) => normalizeReference(value)))]
  const exactMatch = canonical.find((value) => value === originalValue)
  if (exactMatch !== undefined) return resolved(originalValue, 'exact', exactMatch)

  const normalizedInput = normalizeReference(originalValue)
  if (!normalizedInput) {
    return {
      status: 'unmatched',
      originalValue,
      canonicalValue: null,
      suggestedValue: null,
      candidates: [],
      confidence: 0,
    }
  }

  const normalizedMatches = canonical.filter(
    (value) => normalizeReference(value) === normalizedInput,
  )
  if (normalizedMatches.length === 1) {
    return resolved(originalValue, 'normalized', normalizedMatches[0])
  }
  if (normalizedMatches.length > 1) {
    return ambiguous(originalValue, normalizedMatches, 1)
  }

  const aliasTargets = Object.entries(options.aliases ?? {})
    .filter(([alias]) => normalizeReference(alias) === normalizedInput)
    .map(([, target]) => target)
  const uniqueAliasTargets = [...new Set(aliasTargets)]

  if (uniqueAliasTargets.length > 1) {
    return ambiguous(originalValue, uniqueAliasTargets, 1)
  }

  const aliasTarget = uniqueAliasTargets[0]
  if (aliasTarget !== undefined) {
    if (!canonical.includes(aliasTarget)) {
      return invalidAlias(
        originalValue,
        `Alias target "${aliasTarget}" is not an exact canonical value.`,
      )
    }
    return resolved(originalValue, 'alias', aliasTarget)
  }

  return findFuzzyMatch(originalValue, normalizedInput, canonical)
}
