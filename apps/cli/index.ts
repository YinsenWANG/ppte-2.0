#!/usr/bin/env node
import {compareDocuments,compareTwoWayDocuments,createPatch} from '../../packages/reviewer/src/index.js'
import {encodePatch,decodePatch,buildPatchTransaction} from '../../packages/patch-format/src/codec.js'
import {validateRuntimeDocument} from '../../packages/validation/src/index.js'
import {readCheckpointResources} from '../../packages/node-runtime/src/delivery.js'
import {openCheckpoint} from '../../packages/file-format/src/index.js'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  cpSync,
  realpathSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalHash,
  canonicalRevision,
} from "../../packages/canonical-json/src/index.js";
import { PpteSession } from "../../packages/core/src/index.js";
import {
  AGENT_TOOL_DEFINITIONS,
  AgentToolServer,
  type AgentToolName,
} from "../../packages/agent-tools/src/index.js";
import { buildCheckpointBytes } from "../../packages/file-format/src/index.js";
import {
  createEmptyDocument,
  buildAuthoringTransaction,
  authoringProject,
  type AuthoringInput,
} from "../../packages/authoring/src/index.js";
import {
  openFileSession,
  withProjectLock,
} from "../../packages/node-runtime/src/index.js";
import { deliverPresentation } from "../../packages/node-runtime/src/delivery.js";
import { exportPdf, exportPng } from "../../packages/exporter-pdf/src/index.js";
import {
  exportImagePptx,
  exportSemanticPptx,
} from "../../packages/exporter-pptx/src/index.js";
import { MCP_TOOL_INPUT_SCHEMAS } from "../../packages/agent-tools/src/tool-schemas.js";
import type {
  Transaction,
  TransactionScope,
} from "../../packages/schema/src/index.js";

const HELP = `PPTe CLI — file-based presentation tools; no daemon or model credentials.
ppte new <project.ppte> [--title "Title"]
ppte compile <design.json> --out <project.ppte>
ppte inspect <project.ppte>
ppte validate <project.ppte>
ppte diff <project.ppte> --revised <revised.ppte> [--base <base.ppte>]
ppte patch-create <base.ppte> --revised <revised.ppte> --out <changes.ppte.patch>
ppte patch-preview <project.ppte> --patch <changes.ppte.patch> --out <review.json>
ppte tool <project.ppte> <tool-name> [--args <args.json>] [--scope <scope.json>]
ppte preview <project.ppte> --transaction <tx.json> --out <review.json> [--scope <scope.json>]
ppte commit <project.ppte> --preview <review.json> [--confirmed]
ppte undo|redo <project.ppte> --expect-revision <revision>
ppte deliver <project.ppte> [--replace-existing --confirmed]
ppte export <project.ppte> --format pdf|png|pptx|pptx-image --out <file>
ppte host --out <editor.html>
ppte schema [presentation|slide|transaction|document|tool-name]
ppte skill-install --out <native-skill-directory>
All results are JSON on stdout (except --help); errors exit nonzero.
Compile consumes genuine Presentation IR authored by your existing Agent. It does not call a model.
Preview receipts bind transaction, scope, source revision and proposed result; stale receipts are rejected.
`;
type Flags = Record<string, string | boolean>;
function parse(argv: string[]) {
  const positional: string[] = [];
  const flags: Flags = {};
  const booleans = new Set(["confirmed", "replace-existing", "help", "json"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const k = a.slice(2);
    if (booleans.has(k)) flags[k] = true;
    else {
      const v = argv[++i];
      if (!v || v.startsWith("--"))
        throw new Error(`ARGUMENT_INVALID: --${k} requires a value.`);
      flags[k] = v;
    }
  }
  return { positional, flags };
}
function required(flags: Flags, key: string) {
  const v = flags[key];
  if (typeof v !== "string")
    throw new Error(`ARGUMENT_MISSING: --${key} is required.`);
  return v;
}
function json(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}
function freshOutput(path: string, data: string | Uint8Array) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, data, { flag: "wx" });
}
function receiptHash(r: any) {
  return canonicalHash({
    documentId: r.documentId,
    baseRevision: r.baseRevision,
    proposedRevision: r.proposedRevision,
    transaction: r.transaction,
    scope: r.scope,
    ...(r.resources?{resources:r.resources}:{}),
  });
}
export function runCli(argv: string[]): any {
  const { positional, flags } = parse(argv);
  const [command, path, tool] = positional;
  if (!command || flags.help) return { help: HELP };
  if (command === "skill-install") {
    const output = required(flags, "out");
    if (existsSync(output))
      throw new Error(
        "OUTPUT_EXISTS: skill directory already exists; review an update before replacing it.",
      );
    const source = fileURLToPath(
      new URL("../../../skills/ppte", import.meta.url),
    );
    cpSync(source, output, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    return { ok: true, path: resolve(output) };
  }
  if (command === "schema") {
    const files: Record<string, string> = {
      presentation: "presentation-ir",
      slide: "slide-ir",
      transaction: "transaction",
      document: "document",
    };
    if (path && files[path])
      return {
        ok: true,
        schema: json(
          fileURLToPath(
            new URL(
              `../../../schemas/${files[path]}.schema.json`,
              import.meta.url,
            ),
          ),
        ),
      };
    const name = path as keyof typeof MCP_TOOL_INPUT_SCHEMAS;
    if (path && !MCP_TOOL_INPUT_SCHEMAS[name])
      throw new Error(
        "SCHEMA_UNKNOWN: use presentation, slide, transaction, document, or a tool name.",
      );
    return {
      ok: true,
      tools: path
        ? { [name]: MCP_TOOL_INPUT_SCHEMAS[name] }
        : MCP_TOOL_INPUT_SCHEMAS,
    };
  }
  if (command === "host") {
    const output = required(flags, "out");
    const source = fileURLToPath(
      new URL("../../../host/index.html", import.meta.url),
    );
    if (!existsSync(source))
      throw new Error(
        "HOST_BUILD_MISSING: run pnpm host:build and pnpm package:stage first.",
      );
    freshOutput(output, readFileSync(source));
    return { ok: true, path: resolve(output), openWith: "browser" };
  }
  if (!path) throw new Error("ARGUMENT_MISSING: provide the input path.");
  if (command === "new" || command === "compile") {
    const output = command === "new" ? path : required(flags, "out");
    mkdirSync(dirname(resolve(output)), { recursive: true });
    return withProjectLock(output, (absolute) => {
      if (existsSync(absolute))
        throw new Error("OUTPUT_EXISTS: choose a new project path.");
      const session = new PpteSession(
        createEmptyDocument(
          typeof flags.title === "string" ? flags.title : undefined,
        ),
      );
      let resources: {
        assetBytes: Record<string, Uint8Array>;
        fontBytes: Record<string, Uint8Array>;
      } = { assetBytes: {}, fontBytes: {} };
      if (command === "compile") {
        const input = json(path) as AuthoringInput;
        const project = authoringProject(input);
        resources = {
          assetBytes: Object.fromEntries(
            Object.entries(project.assetBytes ?? {}).map(([id, b]) => [
              id,
              new Uint8Array(Buffer.from(b, "base64")),
            ]),
          ),
          fontBytes: Object.fromEntries(
            Object.entries(project.fontBytes ?? {}).map(([id, b]) => [
              id,
              new Uint8Array(Buffer.from(b, "base64")),
            ]),
          ),
        };
        const tx = buildAuthoringTransaction(session.getDocument(), input);
        const result = session.commit(tx);
        if (!result.ok) return result;
      }
      const bytes = buildCheckpointBytes(session.getDocument(), {
        ...resources,
        recentTransactions: session.getHistory().map((h) => h.transaction),
      });
      freshOutput(absolute, bytes);
      return {
        ok: true,
        path: absolute,
        revision: session.getRevision(),
        slides: session.getDocument().slideOrder.length,
      };
    });
  }
  const mutation = ["commit", "undo", "redo", "deliver"].includes(command);
  const run = (absolute: string) => {
    const scope =
      typeof flags.scope === "string"
        ? (json(flags.scope) as TransactionScope)
        : undefined;
    const workspace = openFileSession(absolute, { readonly: !mutation, scope });
    const { session, agent, resources } = workspace;
    if (command === "inspect") return agent.execute("inspect_document");
    if(command==='validate'){const issues=validateRuntimeDocument(session.getDocument());return {ok:!issues.some(i=>i.severity==='error'),issues}}
    if(command==='diff'||command==='patch-create'){
      const revisedPath=required(flags,'revised');const revised=openCheckpoint(revisedPath,{recovery:'ignore'}).document;
      if(revised.documentId!==session.getDocument().documentId)throw new Error('DOCUMENT_MISMATCH: choose copies of the same project');
      if(command==='diff'){const comparison=typeof flags.base==='string'?compareDocuments(openCheckpoint(flags.base,{recovery:'ignore'}).document,session.getDocument(),revised):compareTwoWayDocuments(session.getDocument(),revised);return {ok:!comparison.issues.some(i=>i.severity==='error'),comparison}}
      const patch=createPatch(session.getDocument(),revised,readCheckpointResources(revisedPath,revised));freshOutput(required(flags,'out'),encodePatch(patch));return {ok:true,path:resolve(required(flags,'out')),operations:patch.operations.length}
    }
    if (command === "tool") {
      const def = AGENT_TOOL_DEFINITIONS.find((d) => d.name === tool);
      if (!def || def.mutates)
        throw new Error(
          "TOOL_UNAVAILABLE: use preview/commit/undo for persistent changes.",
        );
      return agent.execute(
        tool as AgentToolName,
        typeof flags.args === "string" ? json(flags.args) : {},
      );
    }
    if (command === "preview" || command === "patch-preview") {
      const patch=command==='patch-preview'?decodePatch(new Uint8Array(readFileSync(required(flags,'patch')))):undefined;
      if(patch){const checked=session.previewPatch(patch);if(!checked.ok)return checked}
      const transaction = patch?buildPatchTransaction(patch):json(required(flags, "transaction")) as Transaction;
      const preview = agent.execute("preview_transaction", { transaction });
      if (!preview.ok) return preview;
      const data = preview.data as any;
      const receipt = {
        version: 1,
        documentId: session.getDocument().documentId,
        baseRevision: session.getRevision(),
        proposedRevision: preview.revision,
        transaction,
        scope,
        ...(patch?{resources:{assets:Object.fromEntries(Object.entries(patch.assets??{}).map(([id,b])=>[id,Buffer.from(b).toString('base64')])),fonts:Object.fromEntries(Object.entries(patch.fonts??{}).map(([id,b])=>[id,Buffer.from(b).toString('base64')]))}}:{}),
        diff: preview.diff ?? data.diff,
        issues: preview.issues,
        requiresConfirmation:
          transaction.changeContract.requireConfirmation === true,
      };
      const output = { ...receipt, digest: receiptHash(receipt) };
      freshOutput(
        required(flags, "out"),
        JSON.stringify(output, null, 2) + "\n",
      );
      return { ok: true, ...output };
    }
    if (command === "commit") {
      const receipt = json(required(flags, "preview"));
      if (receipt.version !== 1 || receipt.digest !== receiptHash(receipt))
        throw new Error(
          "PREVIEW_INVALID: receipt was modified or has an unsupported version.",
        );
      if (
        receipt.documentId !== session.getDocument().documentId ||
        receipt.baseRevision !== session.getRevision()
      )
        throw new Error(
          "REVISION_CONFLICT: preview is stale; inspect and preview again.",
        );
      const scopedAgent = new AgentToolServer(session, {
        grantedScope: receipt.scope,
      });
      const checked = scopedAgent.execute("preview_transaction", {
        transaction: receipt.transaction,
      });
      if (!checked.ok) return checked;
      if (checked.revision !== receipt.proposedRevision)
        throw new Error(
          "PREVIEW_INVALID: proposed revision differs from the reviewed result.",
        );
      if(receipt.resources){const decode=(r:Record<string,string>)=>Object.fromEntries(Object.entries(r).map(([id,b])=>[id,new Uint8Array(Buffer.from(b,'base64'))]));const assets=decode(receipt.resources.assets??{}),fonts=decode(receipt.resources.fonts??{});const candidate=session.preview(receipt.transaction);if(!candidate.ok||!candidate.document)return candidate;buildCheckpointBytes(candidate.document,{assetBytes:{...resources.assetBytes,...assets},fontBytes:{...resources.fontBytes,...fonts}});workspace.persistResources?.(assets,fonts)}
      const result = scopedAgent.execute("commit_transaction", {
        transaction: receipt.transaction,
        confirmed: flags.confirmed === true,
      });
      if (!result.ok) return result;
      const saved = session.checkpoint(absolute);
      return saved.ok
        ? result
        : { ...saved, committed: true, revision: session.getRevision() };
    }
    if (command === "undo" || command === "redo") {
      if (required(flags, "expect-revision") !== session.getRevision())
        throw new Error("REVISION_CONFLICT: document changed.");
      const result = command === "undo" ? session.undo() : session.redo();
      if (!result.ok) return result;
      const saved = session.checkpoint(absolute);
      return saved.ok ? result : saved;
    }
    if (command === "deliver")
      return deliverPresentation(session, absolute, {
        replaceExisting: flags["replace-existing"] === true,
        confirmed: flags.confirmed === true,
      });
    if (command === "export") {
      const format = required(flags, "format");
      const output = required(flags, "out");
      const doc = session.getDocument();
      const result =
        format === "pdf"
          ? exportPdf(doc, resources)
          : format === "png"
            ? exportPng(doc, {
                ...resources,
                slideId:
                  typeof flags.slide === "string" ? flags.slide : undefined,
              })
            : format === "pptx"
              ? exportSemanticPptx(doc, resources)
              : format === "pptx-image"
                ? exportImagePptx(doc, resources)
                : undefined;
      if (!result)
        throw new Error(
          "FORMAT_UNSUPPORTED: use pdf, png, pptx, or pptx-image.",
        );
      if (result.ok) freshOutput(output, result.bytes);
      const { bytes, ...report } = result;
      return { ...report, path: result.ok ? resolve(output) : undefined };
    }
    throw new Error(`COMMAND_UNKNOWN: ${command}. Run ppte --help.`);
  };
  return mutation ? withProjectLock(path, run) : run(resolve(path));
}
const entry = process.argv[1];
if (entry && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  try {
    const result = runCli(process.argv.slice(2));
    if (result.help) process.stdout.write(result.help);
    else {
      process.stdout.write(JSON.stringify(result) + "\n");
      if (result.ok === false) process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(
      JSON.stringify({
        ok: false,
        issues: [{ code: message.split(":")[0], message, severity: "error" }],
      }) + "\n",
    );
    process.exitCode = 1;
  }
}
