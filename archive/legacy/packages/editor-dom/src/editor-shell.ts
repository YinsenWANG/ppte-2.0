/** Shared keyboard behavior for the two offline editor shells. No document writes. */
export function mountEditorShell(root: HTMLElement): () => void {
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return
    const details = (event.target as HTMLElement).closest('details[open]')
    if (details) {
      details.removeAttribute('open')
      details.querySelector('summary')?.focus()
      event.preventDefault()
      // Let document-level gesture cancellation observe the same Escape.
    }
  }
  root.addEventListener('keydown', keydown)
  return () => root.removeEventListener('keydown', keydown)
}

export const editorShellCss = `
button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #e34461;outline-offset:3px}
.ppte-toolbar-label,.ppte-file-label{position:relative}
.ppte-toolbar-label input[type=file],.ppte-file-label input[type=file]{display:block!important;position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
.ppte-toolbar-label:focus-within,.ppte-file-label:focus-within{outline:3px solid #e34461;outline-offset:3px}
[data-ppte-pages-panel]>summary,[data-ppte-properties-panel]>summary{cursor:pointer;padding:8px;font-weight:600}
[data-ppte-mode=present] [data-ppte-pages-panel],[data-ppte-mode=present] [aria-label="选区格式"]{display:none!important}
`
