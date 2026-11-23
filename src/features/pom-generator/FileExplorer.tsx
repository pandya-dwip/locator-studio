import { useState } from 'react'
import { Check, Copy, Download, FileCode, FolderDown, FolderOpen } from 'lucide-react'
import { createZip, type FileRole, type GeneratedPackage } from '../../generators/playwright'
import { errorMessage } from '../../shared/utils'
import { downloadBlob, downloadText } from './download'

export type EditedFiles = Partial<Record<FileRole, { code: string; base: string }>>

const ROLE_LABEL: Record<FileRole, string> = { page: 'Page object', data: 'Test data', spec: 'Tests' }

interface Props {
  pkg: GeneratedPackage
  active: FileRole
  onSelect: (role: FileRole) => void
  edited: EditedFiles
  onEdit: (role: FileRole, value: { code: string; base: string } | undefined) => void
}

/** The generated folder: file list, full-size editable preview, copy and download (file or ZIP). */
export function FileExplorer({ pkg, active, onSelect, edited, onEdit }: Props) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const file = pkg.files.find((f) => f.role === active) ?? pkg.files[0]!
  const edit = edited[file.role]
  const content = (role: FileRole) => {
    const f = pkg.files.find((x) => x.role === role)!
    return edited[role]?.code ?? f.content
  }
  const code = content(file.role)
  const outdated = !!edit && edit.base !== file.content

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      setError(`Copy failed: ${errorMessage(err)}`)
    }
  }

  function downloadZip() {
    const zip = createZip(pkg.files.map((f) => ({ path: f.path, content: content(f.role) })))
    downloadBlob(`${pkg.folder}.zip`, new Blob([zip.slice().buffer], { type: 'application/zip' }))
  }

  return (
    <div className="files">
      <aside className="file-tree" aria-label="Generated files">
        <div className="file-folder">
          <FolderOpen size={14} /> {pkg.folder}/
        </div>
        {pkg.files.map((f) => (
          <button key={f.role} type="button" className="file-item" aria-pressed={f.role === file.role} onClick={() => onSelect(f.role)}>
            <FileCode size={14} aria-hidden="true" />
            <span className="file-name">{f.name}</span>
            <span className="file-meta">
              {ROLE_LABEL[f.role]}
              {edited[f.role] && <span className="badge">edited</span>}
            </span>
          </button>
        ))}
        <button type="button" className="btn btn-primary file-zip" onClick={downloadZip}>
          <FolderDown size={14} /> Download {pkg.folder}.zip
        </button>
      </aside>

      <section className="file-view" aria-label={file.name}>
        <div className="file-bar">
          <code className="file-path">{file.path}</code>
          <span className="muted file-lines">{code.split('\n').length - 1} lines</span>
          <span className="spacer" />
          {edit && (
            <button type="button" className="link-btn" onClick={() => onEdit(file.role, undefined)}>
              Discard edits
            </button>
          )}
          <button type="button" className="btn" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="btn" onClick={() => downloadText(file.name, code)}>
            <Download size={14} /> Download
          </button>
        </div>
        {outdated && (
          <p className="file-outdated">
            The generated version of this file changed since you edited it (options, validation or test data changed).{' '}
            <button type="button" className="link-btn" onClick={() => onEdit(file.role, undefined)}>
              Use the regenerated file
            </button>
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <textarea
          className="file-code"
          value={code}
          onChange={(e) => onEdit(file.role, { code: e.target.value, base: edit?.base ?? file.content })}
          onKeyDown={insertSpacesOnTab}
          spellCheck={false}
          wrap="off"
          aria-label={`${file.name} (editable)`}
        />
      </section>
    </div>
  )
}

/** Tab inserts two spaces instead of leaving the editor. */
function insertSpacesOnTab(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== 'Tab' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
  e.preventDefault()
  const t = e.currentTarget
  t.setRangeText('  ', t.selectionStart, t.selectionEnd, 'end')
  t.dispatchEvent(new Event('input', { bubbles: true }))
}
