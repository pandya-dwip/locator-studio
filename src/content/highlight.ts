// Temporary on-page highlight. Draws a fixed-position overlay in its own closed
// shadow root: the highlighted element and page styles are never modified.
// Removed on Escape, on any pointer press, on the next highlight or scan.

export interface Highlighter {
  show(el: Element, label: string): void
  clear(): void
}

export function createHighlighter(): Highlighter {
  let host: HTMLElement | null = null
  let box: HTMLElement | null = null
  let target: Element | null = null
  let frame = 0

  const place = () => {
    if (!box || !target) return
    if (!target.isConnected) return clear()
    const r = target.getBoundingClientRect()
    box.style.transform = `translate(${r.left}px, ${r.top}px)`
    box.style.width = `${r.width}px`
    box.style.height = `${r.height}px`
  }
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(place)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') clear()
  }
  const onPointer = () => clear()

  function clear() {
    cancelAnimationFrame(frame)
    window.removeEventListener('scroll', schedule, true)
    window.removeEventListener('resize', schedule)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('pointerdown', onPointer, true)
    host?.remove()
    host = box = target = null
  }

  function show(el: Element, label: string) {
    clear()
    target = el

    host = document.createElement('div')
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;'
    const shadow = host.attachShadow({ mode: 'closed' })

    const style = document.createElement('style')
    style.textContent = `
      .box { position: fixed; top: 0; left: 0; box-sizing: border-box; border: 2px solid #5e6ad2;
             background: rgb(94 106 210 / 15%); border-radius: 2px; transition: transform 60ms; }
      .label { position: absolute; bottom: 100%; left: -2px; margin-bottom: 2px; padding: 2px 6px;
               background: #5e6ad2; color: #fff; font: 600 11px/1.4 ui-monospace, Consolas, monospace;
               border-radius: 3px; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }`
    box = document.createElement('div')
    box.className = 'box'
    const tag = document.createElement('span')
    tag.className = 'label'
    tag.textContent = label // page-derived: always text, never HTML
    box.append(tag)
    shadow.append(style, box)
    document.documentElement.append(host)

    const r = el.getBoundingClientRect()
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
    place()

    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer, { capture: true, passive: true })
  }

  return { show, clear }
}
