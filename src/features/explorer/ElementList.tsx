import { memo } from 'react'
import type { ScannedElement } from '../../shared/types'
import { KINDS, VISIBILITY_LABEL, elementKind, identifier } from './format'

const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label]))

interface Props {
  elements: ScannedElement[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Elements ticked for the Page Object. */
  picked: Set<string>
  onTogglePicked: (id: string) => void
  /** Show the element type on each row (only useful on the All tab). */
  showKind: boolean
}

/** Compact, flat list in document order. Filtering by type happens in the tabs above it. */
export function ElementList({ elements, selectedId, onSelect, picked, onTogglePicked, showKind }: Props) {
  if (elements.length === 0) return <p className="muted list-none">No elements match.</p>
  return (
    <div className="el-list" role="group" aria-label="Extracted elements">
      {elements.map((el) => (
        <Row
          key={el.id}
          el={el}
          selected={el.id === selectedId}
          picked={picked.has(el.id)}
          onSelect={onSelect}
          onTogglePicked={onTogglePicked}
          showKind={showKind}
        />
      ))}
    </div>
  )
}

// Memoised: selecting a row re-renders two rows, not thousands.
const Row = memo(function Row({
  el,
  selected,
  picked,
  onSelect,
  onTogglePicked,
  showKind,
}: {
  el: ScannedElement
  selected: boolean
  picked: boolean
  onSelect: (id: string) => void
  onTogglePicked: (id: string) => void
  showKind: boolean
}) {
  const label = el.accessibleName ?? el.textContent ?? identifier(el)
  const hidden = el.visibility === 'hidden' || el.visibility === 'not-rendered'
  return (
    <div className={`el-item${hidden ? ' el-row-hidden' : ''}`}>
      <input
        type="checkbox"
        checked={picked}
        onChange={() => onTogglePicked(el.id)}
        aria-label={`Include <${el.tagName}> ${label ?? ''} in the Page Object`}
      />
      <button
        type="button"
        className="el-row"
        aria-pressed={selected}
        onClick={() => onSelect(el.id)}
        title={hidden ? VISIBILITY_LABEL[el.visibility] : undefined}
      >
        <code className="el-tag">{el.tagName}</code>
        <span className="el-label truncate">{label}</span>
        {showKind && <span className="el-cat">{KIND_LABEL[elementKind(el)]}</span>}
      </button>
    </div>
  )
})
