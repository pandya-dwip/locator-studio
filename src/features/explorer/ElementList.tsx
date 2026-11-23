import { memo } from 'react'
import { CATEGORIES } from '../../shared/constants'
import type { ScannedElement } from '../../shared/types'
import { ENABLED_LABEL, VISIBILITY_LABEL, identifier } from './format'

interface Props {
  elements: ScannedElement[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function ElementList({ elements, selectedId, onSelect }: Props) {
  const groups = CATEGORIES.map((c) => ({ ...c, items: elements.filter((e) => e.category === c.id) })).filter(
    (g) => g.items.length > 0,
  )

  if (groups.length === 0) return <p className="muted explorer-none">No elements match the current search and filter.</p>

  return (
    <section className="el-list" aria-label="Extracted elements">
      {groups.map((g) => (
        <details key={g.id} className="el-group" open>
          <summary>
            {g.label}
            <span className="count">{g.items.length}</span>
          </summary>
          {g.items.map((el) => (
            <Row key={el.id} el={el} selected={el.id === selectedId} onSelect={onSelect} />
          ))}
        </details>
      ))}
    </section>
  )
}

// Memoised: selecting a row re-renders two rows, not thousands.
const Row = memo(function Row({
  el,
  selected,
  onSelect,
}: {
  el: ScannedElement
  selected: boolean
  onSelect: (id: string) => void
}) {
  const id = identifier(el)
  const label = el.accessibleName ?? el.textContent
  return (
    <button
      type="button"
      className="el-row"
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(el.id)}
    >
      <code className="el-tag">{el.tagName}</code>
      {id && <code className="el-id truncate">{id}</code>}
      <span className="el-label truncate">{label}</span>
      {el.enabledState === 'disabled' || el.enabledState === 'readonly' ? (
        <span className="badge">{ENABLED_LABEL[el.enabledState]}</span>
      ) : null}
      <span className="vis-dot" data-vis={el.visibility} title={VISIBILITY_LABEL[el.visibility]} />
    </button>
  )
})
