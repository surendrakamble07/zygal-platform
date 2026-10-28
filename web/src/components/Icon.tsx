export type IconName = 'dashboard' | 'sites' | 'devices' | 'jobs' | 'reports' | 'users' | 'logs' | 'edit' | 'view' | 'plus' | 'empty'

interface Props {
  name: IconName
  size?: number
  className?: string
}

const PATHS: Record<IconName, string> = {
  dashboard: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  sites: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1',
  devices: 'M7 2h10v20H7zM10 5h4m-4 14h4',
  jobs: 'M8 4h13v17H3V4h5m0 0V2h8v2m-8 5h8m-8 4h8m-8 4h5',
  reports: 'M4 19V5m0 14h17M8 15v-4m5 4V7m5 8V3',
  users: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8m7-7a4 4 0 0 1 0 8m3 3a4 4 0 0 1 2 4v2',
  logs: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z',
  view: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  plus: 'M12 5v14m-7-7h14',
  empty: 'M4 5h16v14H4zM8 9h8m-8 4h5',
}

export default function Icon({ name, size = 18, className }: Props) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
