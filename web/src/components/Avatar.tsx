const AVATAR_COLORS = [
  'var(--zy-green)',
  'var(--zy-blue)',
  'var(--zy-orange)',
  'var(--zy-dark)',
  'var(--zy-green-dark)',
  'var(--zy-blue-dark)',
] as const

interface Props {
  name: string
  size?: number
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words.length === 1
    ? words[0][0].toLocaleUpperCase()
    : `${words[0][0]}${words[words.length - 1][0]}`.toLocaleUpperCase()
}

function colorForName(name: string): string {
  let hash = 0
  for (const character of name.trim().toLocaleLowerCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export default function Avatar({ name, size = 32 }: Props) {
  const color = colorForName(name)
  return (
    <span
      className="person-avatar"
      aria-hidden="true"
      style={{ width: size, height: size, backgroundColor: color }}
    >
      {initials(name)}
    </span>
  )
}
