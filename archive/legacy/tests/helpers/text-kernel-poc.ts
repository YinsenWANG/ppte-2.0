/** E02 experiment only. Neither candidate owns a deck or a history plugin. */
import { ImeTextEditSession, cloneRichText, editRichText } from '../../packages/richtext-adapter/src/index.js'
import type { RichTextDocument, TextElement, TextMarks } from '../../packages/schema/src/index.js'

export interface Kernel {
  root: HTMLElement
  read(): RichTextDocument
  select(anchor: number, head: number): void
  insert(text: string): void
  paste(html: string): void
  bold(): void
  destroy(): void
}
export type Factory = (root: HTMLElement, content: RichTextDocument) => Kernel

export const nativeFactory: Factory = (root, content) => {
  root.contentEditable = 'true'
  root.replaceChildren(...content.paragraphs.map(p => {
    const node = document.createElement('p')
    for (const r of p.runs) {
      const span = document.createElement(r.marks?.bold ? 'strong' : 'span')
      span.textContent = r.text; node.append(span)
    }
    return node
  }))
  const command = (name: string, value?: string) => { root.focus(); document.execCommand(name, false, value) }
  return {
    root,
    // Existing plain-text diff boundary with explicit paragraph separators for the POC.
    read: () => editRichText(content, Array.from(root.children).map(p=>(p as HTMLElement).innerText).join('\n').replaceAll('\u00a0', ' ')),
    select: (anchor, head) => {
      const points: {node: Node; offset: number}[] = []
      const paragraphs = Array.from(root.children)
      for (const [i, p] of paragraphs.entries()) {
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
        let n: Node | null
        while ((n = walker.nextNode())) for (let j=0;j<n.textContent!.length;j++) points.push({node:n,offset:j})
        const tail = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
        let last: Node = p, next: Node | null
        while ((next=tail.nextNode())) last=next
        points.push({node:last,offset:last.textContent?.length ?? 0})
        if (i === paragraphs.length-1) break
      }
      root.focus()
      const a=points[anchor], h=points[head]
      if (!a || !h) throw Error('selection outside text')
      window.getSelection()!.setBaseAndExtent(a.node,a.offset,h.node,h.offset)
    },
    insert: text => command('insertText',text),
    paste: html => command('insertHTML',html),
    bold: () => command('bold'),
    destroy: () => root.replaceChildren(),
  }
}

export function mount(factory: Factory, root: HTMLElement, element: TextElement, revision: string) {
  const initial = cloneRichText(element.content)
  const kernel = factory(root, initial)
  const draft = new ImeTextEditSession(element, 'slide_main', revision)
  const capture = () => draft.input(kernel.read())
  const start = () => draft.beginComposition()
  const end = () => draft.endComposition(kernel.read())
  const history = (event: Event) => {
    const input = event as InputEvent
    if (input.inputType === 'historyUndo' || input.inputType === 'historyRedo') event.preventDefault()
  }
  root.addEventListener('compositionstart', start)
  root.addEventListener('compositionend', end)
  root.addEventListener('input', capture)
  root.addEventListener('beforeinput', history, true)
  return { kernel, draft, capture, destroy() {
    root.removeEventListener('compositionstart',start);root.removeEventListener('compositionend',end)
    root.removeEventListener('input',capture);root.removeEventListener('beforeinput',history,true)
    kernel.destroy()
  } }
}
export function textOf(content: RichTextDocument) { return content.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n') }
export function marksOf(content: RichTextDocument): {text:string;marks:TextMarks}[] {
  return content.paragraphs.flatMap(p=>p.runs.flatMap(r=>Array.from(r.text).map(text=>({text,marks:r.marks??{}}))))
}
