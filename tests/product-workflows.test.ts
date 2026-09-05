import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import {
  createEmptyDocument,
  buildAuthoringTransaction,
} from "../packages/authoring/src/index.js";
import { PpteSession } from "../packages/core/src/index.js";
import { openCheckpoint } from "../packages/file-format/src/index.js";
import { buildPortable } from "../packages/portable-runtime/src/index.js";
import {
  canonicalRevision,
  equalJson,
  canonicalJsonString,
} from "../packages/canonical-json/src/index.js";
import { contentOnlyContract } from "../packages/change-contract/src/index.js";
import { plainTextToRichText } from "../packages/richtext-adapter/src/index.js";
import { makeGABContractDocument } from "../apps/contract-deck/index.js";
import { withProjectLock } from "../packages/node-runtime/src/index.js";
import type { Transaction } from "../packages/schema/src/index.js";

function cli(...args: string[]) {
  const child = spawnSync(
    process.execPath,
    [resolve("dist/apps/cli/index.js"), ...args],
    { encoding: "utf8" },
  );
  let result;
  try {
    result = JSON.parse(child.stdout);
  } catch {
    throw new Error(child.stderr || child.stdout);
  }
  return { status: child.status, result };
}
function titleEdit(project: string, text: string): Transaction {
  const document = openCheckpoint(project, { recovery: "ignore" }).document;
  const slideId = document.slideOrder[0]!;
  const title = Object.values(document.slides[slideId]!.elements).find(
    (e) => e.role === "title",
  )!;
  return {
    transactionId: `test:${text}`,
    baseRevision: canonicalRevision(document),
    actor: { type: "agent", id: "test" },
    scope: {
      kind: "selection",
      slideIds: [slideId],
      elementIds: [title.id],
      permissions: ["content"],
      allowInsert: false,
      allowDelete: false,
    },
    changeContract: contentOnlyContract(title.id),
    reason: "Change one title",
    createdAt: new Date().toISOString(),
    operations: [
      {
        opId: "text",
        kind: "text.replaceContent",
        slideId,
        elementId: title.id,
        content: plainTextToRichText(text),
      },
    ],
  };
}

test("CLI compiles actual source facts, previews, rejects stale edits, persists undo/redo across processes, and delivers", () => {
  const dir = mkdtempSync(join(tmpdir(), "ppte-cli-"));
  try {
    const project = join(dir, "季度.ppte");
    const compiled = cli(
      "compile",
      "examples/quarterly-design.json",
      "--out",
      project,
    );
    assert.equal(compiled.status, 0, JSON.stringify(compiled.result));
    assert.equal(compiled.result.slides, 10);
    const doc = openCheckpoint(project).document;
    const text = Object.values(doc.slides)
      .flatMap((s) => Object.values(s.elements))
      .filter((e) => e.type === "text")
      .map((e) =>
        e.content.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join(""),
      )
      .join("\n");
    for (const fact of ["128", "99.95%", "负责人", "验收延期"])
      assert.ok(text.includes(fact), fact);
    assert.equal(
      new Set(Object.values(doc.slides).map((s) => s.semantic?.keyMessage))
        .size,
      10,
    );
    const tx = titleEdit(project, "已审核季度业绩");
    const txFile = join(dir, "tx.json");
    writeFileSync(txFile, JSON.stringify(tx));
    const receipt = join(dir, "review.json");
    const preview = cli(
      "preview",
      project,
      "--transaction",
      txFile,
      "--out",
      receipt,
    );
    assert.equal(preview.status, 0, JSON.stringify(preview.result));
    assert.notEqual(preview.result.proposedRevision, compiled.result.revision);
    assert.equal(
      canonicalRevision(openCheckpoint(project).document),
      compiled.result.revision,
    );
    const committed = cli("commit", project, "--preview", receipt);
    assert.equal(committed.status, 0, JSON.stringify(committed.result));
    const changed = canonicalRevision(openCheckpoint(project).document);
    assert.equal(changed, preview.result.proposedRevision);
    const stale = cli("commit", project, "--preview", receipt);
    assert.equal(stale.status, 1);
    assert.equal(stale.result.issues[0].code, "REVISION_CONFLICT");
    assert.equal(canonicalRevision(openCheckpoint(project).document), changed);
    const undo = cli("undo", project, "--expect-revision", changed);
    assert.equal(undo.status, 0, JSON.stringify(undo.result));
    assert.equal(
      canonicalRevision(openCheckpoint(project).document),
      compiled.result.revision,
    );
    const redo = cli(
      "redo",
      project,
      "--expect-revision",
      compiled.result.revision,
    );
    assert.equal(redo.status, 0, JSON.stringify(redo.result));
    assert.equal(canonicalRevision(openCheckpoint(project).document), changed);
    const delivered = cli("deliver", project);
    assert.equal(delivered.status, 0, JSON.stringify(delivered.result));
    const primary = delivered.result.artifacts.find((a: any) => a.primary);
    assert.ok(primary.path.endsWith(".editable.ppte.html"));
    assert.ok(existsSync(primary.path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI writers serialize, modified preview receipts and out-of-scope transactions cannot commit", () => {
  const dir = mkdtempSync(join(tmpdir(), "ppte-lock-"));
  try {
    const project = join(dir, "project.ppte");
    assert.equal(cli("new", project).status, 0);
    withProjectLock(project, () => {
      const result = cli("deliver", project);
      assert.equal(result.status, 1);
      assert.equal(result.result.issues[0].code, "PROJECT_BUSY");
    });
    const tx = titleEdit(project, "review");
    const txFile = join(dir, "tx.json");
    writeFileSync(txFile, JSON.stringify(tx));
    const review = join(dir, "review.json");
    assert.equal(
      cli("preview", project, "--transaction", txFile, "--out", review).status,
      0,
    );
    const receipt = JSON.parse(readFileSync(review, "utf8"));
    receipt.transaction.operations[0].content =
      plainTextToRichText("unreviewed");
    writeFileSync(review, JSON.stringify(receipt));
    const result = cli("commit", project, "--preview", review);
    assert.equal(result.status, 1);
    assert.equal(result.result.issues[0].code, "PREVIEW_INVALID");
    const scope = join(dir, "scope.json");
    writeFileSync(
      scope,
      JSON.stringify({
        kind: "selection",
        slideIds: ["slide_1"],
        elementIds: ["text_body"],
        permissions: ["content"],
        allowInsert: false,
        allowDelete: false,
      }),
    );
    const rejected = cli(
      "preview",
      project,
      "--transaction",
      txFile,
      "--out",
      join(dir, "bad.json"),
      "--scope",
      scope,
    );
    assert.equal(rejected.status, 1);
    assert.ok(!existsSync(join(dir, "bad.json")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Authoring rejects malformed designs and overflowing content before altering the source document", () => {
  const session = new PpteSession(createEmptyDocument());
  const before = session.getRevision();
  assert.throws(
    () =>
      buildAuthoringTransaction(session.getDocument(), {
        presentation: { slides: [] },
      } as any),
    /AUTHORING_INVALID/,
  );
  const input = JSON.parse(
    readFileSync("examples/quarterly-design.json", "utf8"),
  );
  input.presentation.slides[0].blocks[0].content = "超长标题".repeat(500);
  assert.throws(
    () => buildAuthoringTransaction(session.getDocument(), input),
    /OVERFLOW|QUALITY|RECIPE/,
  );
  assert.equal(session.getRevision(), before);
});

test("Browser portable enforces Core locks, edits arbitrary chart cells visibly, validates crop, and reopens Undo history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ppte-browser-core-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const fixture = makeGABContractDocument();
    fixture.document.slides.slide_main!.elements.text_title!.locked = true;
    const build = buildPortable(fixture.document, {
      profile: "full-portable",
      assetBytes: { asset_pixel: fixture.imageBytes },
    });
    assert.equal(build.ok, true, JSON.stringify(build.issues));
    const path = join(dir, "edit.html");
    writeFileSync(path, build.html);
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path).href);
    await page.waitForFunction(() => Boolean((globalThis as any).PPTEPortable));
    const locked = await page.evaluate(() => {
      const a = (globalThis as any).PPTEPortable;
      const before = a.getRevision();
      const r = a.editText({ elementId: "text_title" }, "must not write");
      return {
        ok: r.ok,
        unchanged: before === a.getRevision(),
        issues: r.issues,
      };
    });
    assert.equal(locked.ok, false);
    assert.equal(locked.unchanged, true);
    await page.evaluate(() =>
      (globalThis as any).PPTEPortable.select("chart_revenue"),
    );
    const beforeChart = await page
      .locator('[data-ppte-element-id="chart_revenue"] svg')
      .innerHTML();
    await page.locator('[data-ppte-action="chart-data"]').click();
    const numeric = page.locator('dialog input[type="number"]').first();
    await numeric.fill("87");
    await page.locator("[data-ppte-dialog-apply]").click();
    assert.equal(await page.locator("dialog").count(), 0);
    const afterChart = await page
      .locator('[data-ppte-element-id="chart_revenue"] svg')
      .innerHTML();
    assert.notEqual(afterChart, beforeChart);
    assert.equal(
      await page.evaluate(
        () =>
          (globalThis as any).PPTEPortable.getDocument().slides.slide_main
            .elements.chart_revenue.data.rows[0].values.revenue,
      ),
      87,
    );
    const invalid = await page.evaluate(() => {
      const a = (globalThis as any).PPTEPortable;
      const before = a.getRevision();
      const r = a.cropImage(
        { elementId: "image_hero" },
        { x: -0.2, y: 0, width: 1, height: 1 },
      );
      return { ok: r.ok, unchanged: before === a.getRevision() };
    });
    assert.deepEqual(invalid, { ok: false, unchanged: true });
    const saved = await page.evaluate(() => {
      const r = (globalThis as any).PPTEPortable.saveAsPortable();
      return { ok: r.ok, html: r.html };
    });
    assert.equal(saved.ok, true);
    const savedPath = join(dir, "saved.html");
    writeFileSync(savedPath, saved.html);
    const reopened = await browser.newPage();
    await reopened.goto(pathToFileURL(savedPath).href);
    await reopened.waitForFunction(() =>
      Boolean((globalThis as any).PPTEPortable),
    );
    const undone = await reopened.evaluate(() => {
      const a = (globalThis as any).PPTEPortable;
      const result = a.undo();
      return {
        ok: result.ok,
        value:
          a.getDocument().slides.slide_main.elements.chart_revenue.data.rows[0]
            .values.revenue,
      };
    });
    assert.equal(undone.ok, true);
    assert.notEqual(undone.value, 87);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Fast equality and path diffs preserve canonical JSON semantics", () => {
  const values: any[] = [
    null,
    0,
    -0,
    "",
    false,
    [],
    {},
    { a: 1, b: undefined },
    { b: undefined, a: 1 },
    [1, { a: "中文" }],
    [1, { a: "different" }],
  ];
  for (const a of values)
    for (const b of values)
      assert.equal(
        equalJson(a, b),
        canonicalJsonString(a) === canonicalJsonString(b),
      );
});

test('native CLI patch embeds image bytes and remains reversible across process restarts',async()=>{
  const {writeCheckpoint}=await import('../packages/file-format/src/index.js')
  const {sha256HexBytes}=await import('../packages/canonical-json/src/index.js')
  const {makeContractDocument}=await import('../apps/contract-deck/index.js')
  const dir=mkdtempSync(join(tmpdir(),'ppte-patch-cli-'))
  try{
    const {document,imageBytes}=makeContractDocument();const base=join(dir,'base.ppte'),revised=join(dir,'revised.ppte'),patch=join(dir,'change.ppte.patch'),receipt=join(dir,'review.json')
    writeCheckpoint(document,base,{assetBytes:{asset_pixel:imageBytes}})
    const changed=structuredClone(document);const asset=changed.assets.asset_pixel!;const next=new Uint8Array([...imageBytes,0]);asset.hash=`sha256-${sha256HexBytes(next)}`;asset.byteLength=next.length;asset.path=`assets/${asset.hash.slice(7)}.png`
    writeCheckpoint(changed,revised,{assetBytes:{asset_pixel:next}})
    for(const args of [['patch-create',base,'--revised',revised,'--out',patch],['patch-preview',base,'--patch',patch,'--out',receipt],['commit',base,'--preview',receipt,'--confirmed']]){const r=cli(...args);assert.equal(r.status,0,JSON.stringify(r.result))}
    assert.equal(openCheckpoint(base).document.assets.asset_pixel!.hash,asset.hash)
    let revision=canonicalRevision(openCheckpoint(base).document)
    const undone=cli('undo',base,'--expect-revision',revision);assert.equal(undone.status,0,JSON.stringify(undone.result));assert.equal(openCheckpoint(base).document.assets.asset_pixel!.hash,document.assets.asset_pixel!.hash)
    revision=canonicalRevision(openCheckpoint(base).document)
    const redone=cli('redo',base,'--expect-revision',revision);assert.equal(redone.status,0,JSON.stringify(redone.result));assert.equal(openCheckpoint(base).document.assets.asset_pixel!.hash,asset.hash)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
