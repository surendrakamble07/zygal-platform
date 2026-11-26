export type IconName =
  | 'dashboard'
  | 'sites'
  | 'building'
  | 'devices'
  | 'smartphone'
  | 'jobs'
  | 'clipboard-list'
  | 'reports'
  | 'chart'
  | 'users'
  | 'logs'
  | 'list'
  | 'activity'
  | 'utensils'
  | 'coffee'
  | 'message-square'
  | 'note'
  | 'edit'
  | 'view'
  | 'plus'
  | 'empty'
  | 'logout'

interface Props {
  name: IconName
  size?: number
  className?: string
}

const PATHS: Record<IconName, string> = {
  dashboard: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  sites: 'M3 21h18M5 21V4h14v17M9 8h1m4 0h1m-5 4h1m4 0h1m-5 4h1m4 0h1',
  building: 'M3 21h18M5 21V4h14v17M9 8h1m4 0h1m-5 4h1m4 0h1m-5 4h1m4 0h1',
  devices: 'M7 2h10v20H7zM10 5h4m-4 14h4',
  smartphone: 'M7 2h10v20H7zM10 5h4m-4 14h4',
  jobs: 'M8 4h13v17H3V4h5m0 0V2h8v2m-8 5h8m-8 4h8m-8 4h5',
  'clipboard-list': 'M9 4h6m-5-2h4a2 2 0 0 1 2 2v1h3v17H5V5h3V4a2 2 0 0 1 2-2Zm-1 8h8m-8 4h8m-8 4h5',
  reports: 'M4 19V5m0 14h17M8 15v-4m5 4V7m5 8V3',
  chart: 'M4 19V5m0 14h17M8 15v-4m5 4V7m5 8V3',
  users: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8m7-7a4 4 0 0 1 0 8m3 3a4 4 0 0 1 2 4v2',
  logs: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  utensils: 'M4 3v6a3 3 0 0 0 6 0V3m-3 0v18m10-18c-2 2-3 5-3 8h3m0-8v18m0-10h3',
  coffee: 'M4 8h13v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zm13 2h2a2 2 0 1 1 0 4h-2M7 4c0 1 2 1 2 3m3-3c0 1 2 1 2 3',
  'message-square': 'M4 4h16v13H8l-4 4V4Zm4 5h8m-8 4h6',
  note: 'M5 3h10l4 4v14H5zM14 3v5h5m-10 4h6m-6 4h6m-6 4h4',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z',
  view: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  plus: 'M12 5v14m-7-7h14',
  empty: 'M4 5h16v14H4zM8 9h8m-8 4h5',
  logout: 'M10 17l5-5-5-5m5 5H3m9-8h8v16h-8',
}

export default function Icon({ name, size = 20, className }: Props) {
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
