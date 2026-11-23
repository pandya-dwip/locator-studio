import { memo } from 'react'
import type { ScannedElement } from '../../shared/types'
import { KINDS, VISIBILITY_LABEL, elementKind, identifier } from './format'

const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label]))

interface Props {
  elements: ScannedElement[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Show the element type on each row (only useful on the All tab). */
  showKind: boolean
}

/** Compact, flat list in document order. Filtering by type happens in the tabs above it. */
export function ElementList({ elements, selectedId, onSelect, showKind }: Props) {
  if (elements.length === 0) return <p className="muted list-none">No elements match.</p>
  return (
    <div className="el-list" role="group" aria-label="Extracted elements">
      {elements.map((el) => (
        <Row key={el.id} el={el} selected={el.id === selectedId} onSelect={onSelect} showKind={showKind} />
      ))}
    </div>
  )
}

// Memoised: selecting a row re-renders two rows, not thousands.
const Row = memo(function Row({
  el,
  selected,
  onSelect,
  showKind,
}: {
  el: ScannedElement
  selected: boolean
  onSelect: (id: string) => void
  showKind: boolean
}) {
  const label = el.accessibleName ?? el.textContent ?? identifier(el)
  const hidden = el.visibility === 'hidden' || el.visibility === 'not-rendered'
  return (
    <button
      type="button"
      className={`el-row${hidden ? ' el-row-hidden' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(el.id)}
      title={hidden ? VISIBILITY_LABEL[el.visibility] : undefined}
    >
      <code className="el-tag">{el.tagName}</code>
      <span className="el-label truncate">{label}</span>
      {showKind && <span className="el-cat">{KIND_LABEL[elementKind(el)]}</span>}
    </button>
  )
})
