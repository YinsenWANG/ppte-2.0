import type { Page } from 'playwright';
/** Exercise the explicit unsupported-browser fallback when there is no failure choice.
 * Capability override is test-only; this does not claim Safari/native browser evidence. */
export async function downloadUpdated(page: Page) {
  if(await page.locator('#ppte-save-ui').getAttribute('data-mode')==='read')await page.getByRole('button',{name:'编辑',exact:true}).click();
  let button = page.getByRole('button', {name:'下载更新后的文件', exact:true});
  if (!await button.isVisible()) {
    await page.locator('#ppte-save-panel summary').click();
    if (!await button.isVisible()) await page.evaluate(()=>{const w=window as any;w.__pickerBeforeDownload=w.showOpenFilePicker;w.showOpenFilePicker=undefined;w.PPTeSave.set(w.PPTeSave.state,w.PPTeSave.detail);});
  }
  await button.click();
  await page.evaluate(()=>{const w=window as any;if(w.__pickerBeforeDownload){w.showOpenFilePicker=w.__pickerBeforeDownload;delete w.__pickerBeforeDownload;w.PPTeSave.set(w.PPTeSave.state,w.PPTeSave.detail);}});
}
export async function confirmFirstSave(page: Page) {
  await page.getByRole('button',{name:'选择当前文件并保存',exact:true}).click();
}
/** Seed legacy object fixtures through Commands; this is NOT a product insertion UI test.
 * Subsequent selection, formatting, movement, undo and saving still exercise current UI.
 */
export async function seedLegacyObject(page: Page, kind: 'text'|'rect'|'ellipse'|'line'|'table', rows?: number, cols?: number) {
  await page.getByRole('button',{name:'插入图片',exact:true}).focus();
  await page.evaluate(({kind,rows,cols}) => {
    const e=(window as any).PPTeEditor, c=e.commands;
    const reference=e.selection[0];
    const slide=reference ? c.node(reference).closest('[data-ppte-slide]') : Array.from(c.doc.querySelectorAll('[data-ppte-slide]')).find((n:any)=>n.getBoundingClientRect().width>0);
    const n=c.insertObject(slide.dataset.ppteId,kind,reference,rows,cols);
    e.select([n.dataset.ppteId]);
  },{kind,rows,cols});
}
