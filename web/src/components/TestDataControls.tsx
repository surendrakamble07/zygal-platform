export type DummyFilter = 'real' | 'all' | 'test'

interface FilterProps {
  value: DummyFilter
  onChange: (value: DummyFilter) => void
}

export function TestDataFilter({ value, onChange }: FilterProps) {
  return (
    <select
      aria-label="Filter by test data"
      value={value}
      onChange={(event) => {
        const selected = event.target.value
        onChange(selected === 'all' || selected === 'test' ? selected : 'real')
      }}
    >
      <option value="real">Real data only</option>
      <option value="all">All records</option>
      <option value="test">Test data only</option>
    </select>
  )
}

export function TestDataBadge() {
  return <span className="test-data-badge">TEST DATA</span>
}

interface ToggleProps {
  checked: boolean
  disabled?: boolean
  itemName: string
  onChange: (checked: boolean) => void
}

export function TestDataToggle({ checked, disabled, itemName, onChange }: ToggleProps) {
  return (
    <label className="test-data-toggle">
      <input
        type="checkbox"
        aria-label={`${checked ? 'Remove' : 'Mark'} ${itemName} ${checked ? 'from' : 'as'} test data`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      Test data
    </label>
  )
}
