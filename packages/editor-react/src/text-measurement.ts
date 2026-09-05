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
