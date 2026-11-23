export function coordinatesFromMapLink(
  value: string,
): { latitude: number; longitude: number } | null {
  const pinned = value.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i)
  if (pinned) {
    return { latitude: Number(pinned[1]), longitude: Number(pinned[2]) }
  }

  const pair = /(-?\d+(?:\.\d+)?)\s*(?:,|%2c)\s*(-?\d+(?:\.\d+)?)/i
  const matchPair = (text: string) => {
    const match = text.match(pair)
    return match ? { latitude: Number(match[1]), longitude: Number(match[2]) } : null
  }

  try {
    const url = new URL(value)
    for (const key of ['query', 'q', 'll', 'center']) {
      const coordinates = matchPair(url.searchParams.get(key) ?? '')
      if (coordinates) return coordinates
    }
  } catch {
    // Continue with coordinate formats that do not require a fully qualified URL.
  }

  const viewport = value.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)
  if (viewport) {
    return { latitude: Number(viewport[1]), longitude: Number(viewport[2]) }
  }
  return null
}
