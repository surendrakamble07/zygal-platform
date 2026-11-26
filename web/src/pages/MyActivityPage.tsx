import { useState } from 'react'
import { useAuth } from '../auth/auth-context'
import { useMyProductivity } from '../lib/report-queries'
import Icon from '../components/Icon'

type DateRangePreset = 'this-month' | 'last-month' | 'custom'

function dateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthRange(offset: number): { from: string; to: string } {
  const today = new Date()
  const firstDay = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const lastDay = offset === 0
    ? today
    : new Date(today.getFullYear(), today.getMonth() + offset + 1, 0)
  return { from: dateInputValue(firstDay), to: dateInputValue(lastDay) }
}

export default function MyActivityPage() {
  const { profile } = useAuth()
  const [preset, setPreset] = useState<DateRangePreset>('this-month')
  const [dates, setDates] = useState(() => monthRange(0))
  const activity = useMyProductivity(profile?.id ?? null, dates.from, dates.to)
  const row = activity.data?.[0]

  function changePreset(nextPreset: DateRangePreset) {
    setPreset(nextPreset)
    if (nextPreset !== 'custom') setDates(monthRange(nextPreset === 'this-month' ? 0 : -1))
  }

  return (
    <section className="card">
      <div className="head-row">
        <h2>My Activity</h2>
        <span className="muted small">Your work summary</span>
      </div>

      <div className="filters">
        <label>
          Date range
          <select value={preset} onChange={(event) => changePreset(event.target.value as DateRangePreset)}>
            <option value="this-month">This month</option>
            <option value="last-month">Last month</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <label className="date-field">
              From
              <input
                type="date"
                value={dates.from}
                max={dates.to}
                onChange={(event) => setDates((current) => ({ ...current, from: event.target.value }))}
              />
            </label>
            <label className="date-field">
              To
              <input
                type="date"
                value={dates.to}
                min={dates.from}
                onChange={(event) => setDates((current) => ({ ...current, to: event.target.value }))}
              />
            </label>
          </>
        )}
      </div>

      {activity.isError && (
        <div className="banner error" role="alert">
          Could not load your activity. Please refresh and try again.
        </div>
      )}
      {!profile && <div className="banner error" role="alert">Your profile is unavailable.</div>}
      {profile && !activity.isError && !activity.isLoading && !row && (
        <div className="banner error" role="alert">Could not load your profile activity.</div>
      )}

      <div className="project-dashboard-grid" aria-live="polite">
        <article className="kpi">
          <div className="kpi-heading">
            <span className="kpi-icon kpi-icon-blue"><Icon name="jobs" size={20} /></span>
            <div className="kpi-label">Jobs created</div>
          </div>
          <div className="kpi-number">{activity.isLoading ? '...' : row?.jobs_created ?? '-'}</div>
        </article>
        <article className="kpi">
          <div className="kpi-heading">
            <span className="kpi-icon kpi-icon-ok"><Icon name="reports" size={20} /></span>
            <div className="kpi-label">Jobs completed / live</div>
          </div>
          <div className="kpi-number">{activity.isLoading ? '...' : row?.completed_jobs ?? '-'}</div>
        </article>
        <article className="kpi">
          <div className="kpi-heading">
            <span className="kpi-icon kpi-icon-neutral"><Icon name="logs" size={20} /></span>
            <div className="kpi-label">Hours logged in</div>
          </div>
          <div className="kpi-number">{activity.isLoading ? '...' : row?.active_time ?? '-'}</div>
        </article>
      </div>
    </section>
  )
}
