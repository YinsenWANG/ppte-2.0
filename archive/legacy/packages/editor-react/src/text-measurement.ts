/** Browser-only measurement after embedded fonts have settled. The Core's
 * deterministic reference diagnostics remain available in non-browser hosts. */
export function actualTextOverflow(node:HTMLElement){
  const box=node.getBoundingClientRect();const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text:Node|null
  while((text=walker.nextNode())){if(!text.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(text);for(const rect of Array.from(range.getClientRects()))if(rect.top<box.top-1||rect.bottom>box.bottom+1||rect.left<box.left-1||rect.right>box.right+1)return true}
  return false
}
export async function fittedBrowserFont(node:HTMLElement,min=8):Promise<number>{
  await document.fonts.ready
  const copy=node.cloneNode(true) as HTMLElement
  copy.removeAttribute('contenteditable');copy.style.transform='none';copy.style.visibility='hidden';copy.style.left='-10000px';copy.style.top='0';copy.style.position='fixed'
  // Keep the stage's paragraph/list rules when measuring the detached copy.
  for(const p of Array.from(copy.querySelectorAll<HTMLElement>('p,ul,ol'))){const source=node.querySelector<HTMLElement>(`[data-ppte-paragraph-id="${CSS.escape(p.dataset.ppteParagraphId??'')}"]`);if(source){const style=getComputedStyle(source);p.style.margin=style.margin;p.style.padding=style.padding}}
  document.body.append(copy)
  try{let size=parseFloat(getComputedStyle(node).fontSize);while(size>min&&actualTextOverflow(copy)){size=Math.max(min,size-.5);copy.style.fontSize=`${size}px`}return size}finally{copy.remove()}
}

/** Read-only DOM measurement, shared by design verification and editor surfaces.
 * Serializable for browser automation: no closure dependencies, no font fitting. */
export async function measureRenderedLayout(input: { timeoutMs: number; fonts: Array<{ family: string; source: string }> }) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        for (const font of input.fonts) {
          const face = new FontFace(font.family, `url(${JSON.stringify(font.source)})`)
          ;(document.fonts as FontFaceSet & { add(face: FontFace): void }).add(await face.load())
        }
        await document.fonts.ready
        await Promise.all(Array.from(document.images).map(image => image.decode()))
        const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-ppte-type="text"]'))
        const elements = nodes.map(node => {
          const box = node.getBoundingClientRect()
          const style = getComputedStyle(node)
          let overflow = false
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
          let text: Node | null
          while ((text = walker.nextNode())) {
            if (!text.textContent?.trim()) continue
            const parentStyle = getComputedStyle(text.parentElement!)
            const families = parentStyle.fontFamily.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''))
            if (!input.fonts.some(f => families[0] === f.family)) throw new Error(`FONT_UNPINNED: ${families[0]}`)
            if (!document.fonts.check(`${parentStyle.fontSize} "${families[0]}"`, text.textContent)) throw new Error('FONT_NOT_READY')
            const range = document.createRange(); range.selectNodeContents(text)
            for (const rect of Array.from(range.getClientRects())) if (rect.left < box.left - 1 || rect.top < box.top - 1 || rect.right > box.right + 1 || rect.bottom > box.bottom + 1) overflow = true
          }
          return { id: node.dataset.ppteElementId!, overflow, font: style.font, width: box.width, height: box.height }
        })
        return elements
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('FONT_OR_RESOURCE_TIMEOUT')), input.timeoutMs) }),
    ])
  } finally { clearTimeout(timer) }
}
