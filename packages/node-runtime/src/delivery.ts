import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { canonicalRevision } from "../../canonical-json/src/index.js";
import type { PpteSession } from "../../core/src/index.js";
import { readStoredZip } from "../../archive/src/index.js";
import {
  assessDeliveryArtifact,
  auditPortableBundle,
  buildPortable,
  resolveDeliveryPolicy,
  STANDARD_DELIVERY_PROFILE,
  STANDARD_EDITABLE_SUFFIX,
  type DeliveryArtifactRole,
  type DeliveryMetrics,
  type EditableDeliveryProfile,
} from "../../portable-runtime/src/index.js";
import { withErrorSemantics } from "../../schema/src/errors.js";
import type {
  PpteDocument,
  Revision,
  ValidationIssue,
} from "../../schema/src/index.js";

export interface DeliveryRequest {
  profile?: EditableDeliveryProfile;
  replaceExisting?: boolean;
  allowLargePortable?: boolean;
  confirmed?: boolean;
}

/** Internal-only test hooks; MCP schemas never expose these fields. */
export type DeliveryFaultPoint = "build" | "audit" | "before-rename";

export interface DeliveryAdapterOptions {
  fault?: DeliveryFaultPoint;
  build?: typeof buildPortable;
  audit?: typeof auditPortableBundle;
}

export interface CheckpointResources {
  assetBytes: Record<string, Uint8Array>;
  fontBytes: Record<string, Uint8Array>;
}

export interface DeliveryArtifact {
  role: DeliveryArtifactRole;
  primary: boolean;
  path: string;
  mediaType: string;
  openWith: "browser" | "PPTe Host";
  profile: EditableDeliveryProfile | null;
  sourceRevision: Revision | null;
  bytes: number;
  runtimeGzipBytes?: number;
  resourceBytes?: number;
}

export interface DeliveryResult {
  tool: "deliver_presentation";
  ok: boolean;
  revision: Revision;
  requestedProfile: EditableDeliveryProfile | null;
  effectiveProfile: EditableDeliveryProfile;
  sourceRevision: Revision | null;
  artifacts: DeliveryArtifact[];
  metrics?: DeliveryMetrics;
  warnings: string[];
  userMessage: string;
  issues: ValidationIssue[];
}

/**
 * Read all declared resource bytes from the exact checkpoint just written by
 * the Session. This keeps delivery from pairing a live document with bytes
 * from an older or unrelated project file.
 */
export function readCheckpointResources(
  target: string,
  document: PpteDocument,
  resolveBlob?: (hash:string)=>Uint8Array|undefined,
): CheckpointResources {
  const archive = readStoredZip(new Uint8Array(readFileSync(target)));
  const assetBytes: Record<string, Uint8Array> = {};
  for (const asset of Object.values(document.assets)) {
    const data = resolveBlob?.(asset.hash) ?? archive.get(asset.path);
    if (!data)
      throw new Error(`ASSET_MISSING: checkpoint does not contain ${asset.id}`);
    assetBytes[asset.id] = new Uint8Array(data);
  }
  const fontBytes: Record<string, Uint8Array> = {};
  for (const font of Object.values(document.fonts)) {
    if (font.source !== "embedded") continue;
    const data = (font.hash ? resolveBlob?.(font.hash) : undefined) ?? archive.get(font.path ?? `fonts/${font.id}.woff2`);
    if (!data)
      throw new Error(`FONT_MISSING: checkpoint does not contain ${font.id}`);
    fontBytes[font.id] = new Uint8Array(data);
  }
  return { assetBytes, fontBytes };
}

/** Derive the only legal delivery target from the source checkpoint name. */
export function editableSiblingPath(checkpointPath: string): string {
  const sourcePath = resolve(checkpointPath);
  const sourceName = basename(sourcePath);
  if (!sourceName.endsWith(".ppte"))
    throw new Error(
      "DELIVERY_SOURCE_INVALID: delivery requires a .ppte checkpoint.",
    );
  const stem = sourceName.slice(0, -".ppte".length);
  if (!stem || stem === "." || stem === "..")
    throw new Error(
      "DELIVERY_SOURCE_INVALID: checkpoint basename cannot produce a delivery sibling.",
    );
  const target = join(
    dirname(sourcePath),
    `${stem}${STANDARD_EDITABLE_SUFFIX}`,
  );
  if (dirname(target) !== dirname(sourcePath) || target === sourcePath)
    throw new Error(
      "DELIVERY_TARGET_INVALID: delivery target must be a sibling of the checkpoint.",
    );
  return target;
}

export function deliverPresentation(
  session: PpteSession,
  checkpointPath: string,
  request: DeliveryRequest = {},
  internal: DeliveryAdapterOptions = {},
): DeliveryResult {
  const revision = session.getRevision();
  const requestedProfile = request.profile ?? null;
  let policy;
  try {
    policy = resolveDeliveryPolicy(request.profile);
  } catch (cause) {
    return failure(
      revision,
      requestedProfile,
      "DELIVERY_PROFILE_UNSUPPORTED",
      cause instanceof Error ? cause.message : String(cause),
      [],
      undefined,
      "交付失败：只允许可编辑 Portable profile。",
    );
  }
  if (request.replaceExisting === true && request.confirmed !== true) {
    return failure(
      revision,
      requestedProfile,
      "DELIVERY_CONFIRMATION_REQUIRED",
      "replaceExisting requires confirmed:true.",
      [],
      policy.profile,
      "交付失败：覆盖已有可编辑副本必须显式确认。",
    );
  }

  let target: string;
  try {
    target = editableSiblingPath(checkpointPath);
  } catch (cause) {
    return failure(
      revision,
      requestedProfile,
      "DELIVERY_TARGET_INVALID",
      cause instanceof Error ? cause.message : String(cause),
      [],
      policy.profile,
      "交付失败：输出路径只能是当前 .ppte 源项目的同目录 sibling。",
    );
  }

  const sourcePath = resolve(checkpointPath);
  const checkpoint = session.checkpoint(sourcePath);
  if (!checkpoint.ok || !checkpoint.revision) {
    const source = sourceArtifact(sourcePath, readRevision(sourcePath));
    return failure(
      session.getRevision(),
      requestedProfile,
      "DELIVERY_CHECKPOINT_FAILED",
      "The source .ppte checkpoint could not be written.",
      checkpoint.issues,
      policy.profile,
      "交付失败：仅保留可用的 .ppte 源项目；请修复保存错误后重试。",
      source ? [source] : [],
    );
  }

  const sourceRevision = checkpoint.revision;
  const document = session.getDocument();
  if (canonicalRevision(document) !== sourceRevision) {
    const source = sourceArtifact(sourcePath, sourceRevision);
    return failure(
      session.getRevision(),
      requestedProfile,
      "DELIVERY_REVISION_MISMATCH",
      "Checkpoint revision does not match the Session snapshot.",
      [
        issue(
          "DELIVERY_REVISION_MISMATCH",
          "Delivery requires one checkpoint revision for both source and editable artifacts.",
        ),
      ],
      policy.profile,
      "交付失败：源项目已保存，但没有生成不同 revision 的 HTML。",
      source ? [source] : [],
    );
  }

  let resources: CheckpointResources;
  try {
    resources = readCheckpointResources(sourcePath, document);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const source = sourceArtifact(sourcePath, sourceRevision);
    return failure(
      session.getRevision(),
      requestedProfile,
      "DELIVERY_RESOURCE_READ_FAILED",
      message,
      [issue("DELIVERY_RESOURCE_READ_FAILED", message)],
      policy.profile,
      "交付失败：仅保留 .ppte 源项目；无法从同一 checkpoint 读取资源。",
      source ? [source] : [],
    );
  }

  try {
    hitFault(internal, "build");
    const build = (internal.build ?? buildPortable)(document, {
      profile: policy.profile,
      sourceRevision,
      assetBytes: resources.assetBytes,
      fontBytes: resources.fontBytes,
    });
    const metrics = buildMetrics(build, policy.runtimeBudgetBytes);
    if (!build.ok) {
      const source = sourceArtifact(sourcePath, sourceRevision);
      return failure(
        session.getRevision(),
        requestedProfile,
        firstIssueCode(build.issues, "PORTABLE_BUILD_FAILED"),
        "Portable build failed.",
        build.issues,
        policy.profile,
        "交付失败：仅保留 .ppte 源项目；可编辑副本未生成。",
        source ? [source] : [],
        metrics,
      );
    }

    const assessment = assessDeliveryArtifact(
      metrics,
      policy,
      request.allowLargePortable === true,
    );
    if (!assessment.ok) {
      const largeMessage =
        assessment.warning ?? "Portable artifact exceeds the delivery budget.";
      const source = sourceArtifact(sourcePath, sourceRevision);
      const code = assessment.code ?? "DELIVERY_ARTIFACT_LARGE";
      return failure(
        session.getRevision(),
        requestedProfile,
        code,
        largeMessage,
        [
          issue(
            code,
            `${largeMessage} bytes=${metrics.bytes}; runtimeGzipBytes=${metrics.runtimeGzipBytes}; resourceBytes=${metrics.resourceBytes}; budgetBytes=${policy.artifactTargetBytes}.`,
            undefined,
            "Compress or reduce resources, or explicitly retry with allowLargePortable:true.",
          ),
        ],
        policy.profile,
        `交付失败：图片/字体资源使可编辑副本超过标准体积目标；${largeMessage} 请压缩资源或显式确认 allowLargePortable:true。`,
        source ? [source] : [],
        metrics,
      );
    }

    hitFault(internal, "audit");
    const audit = (internal.audit ?? auditPortableBundle)(build.html);
    const auditIssues = [...audit.issues];
    if (audit.origin?.sourceRevision !== sourceRevision)
      auditIssues.push(
        issue(
          "DELIVERY_REVISION_MISMATCH",
          "Editable copy origin does not match the checkpoint revision.",
        ),
      );
    if (audit.origin?.profile !== policy.profile)
      auditIssues.push(
        issue(
          "DELIVERY_PROFILE_MISMATCH",
          "Editable copy origin does not match the requested delivery profile.",
        ),
      );
    if (
      !build.html.includes('data-ppte-deliverable="true"') ||
      !build.html.includes('data-ppte-deliverable-role="editable-browser-copy"')
    )
      auditIssues.push(
        issue(
          "DELIVERY_METADATA_MISSING",
          "Editable delivery must identify itself as an editable browser copy.",
        ),
      );
    if (!audit.ok || auditIssues.some((item) => item.severity === "error")) {
      const source = sourceArtifact(sourcePath, sourceRevision);
      return failure(
        session.getRevision(),
        requestedProfile,
        firstIssueCode(auditIssues, "PORTABLE_INVALID"),
        "Portable audit failed.",
        auditIssues,
        policy.profile,
        "交付失败：Portable 审计未通过；仅保留 .ppte 源项目。",
        source ? [source] : [],
        metrics,
      );
    }

    const htmlBytes = new TextEncoder().encode(build.html);
    const source = sourceArtifact(sourcePath, sourceRevision);
    const existing = readExisting(target);
    if (existing) {
      const existingAudit = (internal.audit ?? auditPortableBundle)(
        existing.text,
      );
      const sameRevision =
        existingAudit.ok &&
        existingAudit.origin?.sourceRevision === sourceRevision &&
        existingAudit.origin?.profile === policy.profile;
      if (sameRevision) {
        const existingMetrics = { ...metrics, bytes: existing.bytes.length };
        return success(
          session.getRevision(),
          requestedProfile,
          policy.profile,
          sourceRevision,
          [
            editableArtifact(
              target,
              policy.profile,
              sourceRevision,
              existingMetrics,
            ),
            ...(source ? [source] : []),
          ],
          existingMetrics,
          assessment.warning ? [assessment.warning] : [],
        );
      }
      if (request.replaceExisting !== true) {
        return failure(
          session.getRevision(),
          requestedProfile,
          "DELIVERY_TARGET_EXISTS",
          `Delivery target already exists: ${target}`,
          [
            issue(
              "DELIVERY_TARGET_EXISTS",
              `The editable sibling already exists and belongs to another revision: ${target}`,
              undefined,
              "Use replaceExisting:true with confirmed:true to replace it.",
            ),
          ],
          policy.profile,
          "交付失败：已有不同 revision 的可编辑副本未被覆盖；源项目仍可用。",
          source ? [source] : [],
          metrics,
        );
      }
    }

    hitFault(internal, "before-rename");
    writeAtomic(target, htmlBytes, request.replaceExisting === true);
    const warnings = assessment.warning ? [assessment.warning] : [];
    return success(
      session.getRevision(),
      requestedProfile,
      policy.profile,
      sourceRevision,
      [
        editableArtifact(target, policy.profile, sourceRevision, metrics),
        ...(source ? [source] : []),
      ],
      metrics,
      warnings,
    );
  } catch (cause) {
    const source = sourceArtifact(sourcePath, sourceRevision);
    const message = cause instanceof Error ? cause.message : String(cause);
    const code = message.startsWith("DELIVERY_TARGET_EXISTS")
      ? "DELIVERY_TARGET_EXISTS"
      : message.startsWith("DELIVERY_FAULT_INJECTED")
        ? "DELIVERY_FAULT_INJECTED"
        : "DELIVERY_WRITE_FAILED";
    return failure(
      session.getRevision(),
      requestedProfile,
      code,
      message,
      [issue(code, message)],
      policy.profile,
      "交付失败：没有发布半成品 HTML；.ppte 源项目仍可用。",
      source ? [source] : [],
    );
  }
}

function success(
  revision: Revision,
  requestedProfile: EditableDeliveryProfile | null,
  profile: EditableDeliveryProfile,
  sourceRevision: Revision,
  artifacts: DeliveryArtifact[],
  metrics: DeliveryMetrics,
  warnings: string[],
): DeliveryResult {
  const editable = artifacts.find(
    (artifact) => artifact.role === "editable-browser-copy",
  );
  const source = artifacts.find(
    (artifact) => artifact.role === "source-project",
  );
  return {
    tool: "deliver_presentation",
    ok: true,
    revision,
    requestedProfile,
    effectiveProfile: profile,
    sourceRevision,
    artifacts,
    metrics,
    warnings,
    userMessage: `打开并修改：${editable?.path ?? "(missing editable copy)"}（浏览器打开，可改字、保存新副本、继续演示/传递）。源项目：${source?.path ?? "(missing source project)"}（需 PPTe Host 打开）。`,
    issues: [],
  };
}

function failure(
  revision: Revision,
  requestedProfile: EditableDeliveryProfile | null,
  code: string,
  message: string,
  issues: ValidationIssue[],
  profile: EditableDeliveryProfile | undefined,
  userMessage: string,
  artifacts: DeliveryArtifact[] = [],
  metrics?: DeliveryMetrics,
): DeliveryResult {
  return {
    tool: "deliver_presentation",
    ok: false,
    revision,
    requestedProfile,
    effectiveProfile: profile ?? STANDARD_DELIVERY_PROFILE,
    sourceRevision:
      artifacts.find((artifact) => artifact.role === "source-project")
        ?.sourceRevision ?? null,
    artifacts,
    ...(metrics ? { metrics } : {}),
    warnings: [],
    userMessage,
    issues: issues.length ? issues : [issue(code, message)],
  };
}

function editableArtifact(
  path: string,
  profile: EditableDeliveryProfile,
  sourceRevision: Revision,
  metrics: DeliveryMetrics,
): DeliveryArtifact {
  return {
    role: "editable-browser-copy",
    primary: true,
    path,
    mediaType: "text/html",
    openWith: "browser",
    profile,
    sourceRevision,
    bytes: metrics.bytes,
    runtimeGzipBytes: metrics.runtimeGzipBytes,
    resourceBytes: metrics.resourceBytes,
  };
}

function sourceArtifact(
  path: string,
  sourceRevision: Revision | null | undefined,
): DeliveryArtifact | undefined {
  if (!existsSync(path)) return undefined;
  let bytes = 0;
  try {
    bytes = statSync(path).size;
  } catch {
    return undefined;
  }
  return {
    role: "source-project",
    primary: false,
    path,
    mediaType: "application/vnd.ppte+zip",
    openWith: "PPTe Host",
    profile: null,
    sourceRevision: sourceRevision ?? null,
    bytes,
  };
}

function readRevision(path: string): Revision | undefined {
  try {
    const archive = readStoredZip(new Uint8Array(readFileSync(path)));
    const manifest = JSON.parse(
      new TextDecoder().decode(
        archive.get("manifest.json") ?? new Uint8Array(),
      ),
    ) as { contentRevision?: Revision };
    return manifest.contentRevision;
  } catch {
    return undefined;
  }
}

function readExisting(
  path: string,
): { bytes: Uint8Array; text: string } | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const bytes = new Uint8Array(readFileSync(path));
    return { bytes, text: new TextDecoder().decode(bytes) };
  } catch {
    return undefined;
  }
}

function writeAtomic(
  target: string,
  data: Uint8Array,
  replaceExisting: boolean,
): void {
  const directory = dirname(target);
  mkdirSync(directory, { recursive: true });
  const temporary = join(
    directory,
    `.${basename(target)}.${process.pid}.${Date.now()}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, data);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (replaceExisting) renameSync(temporary, target);
    else {
      try {
        // A hard-link create is the no-clobber operation: a concurrent writer
        // gets EEXIST and the old target remains byte-for-byte untouched.
        linkSync(temporary, target);
        unlinkSync(temporary);
      } catch (cause) {
        if (isAlreadyExists(cause))
          throw new Error(`DELIVERY_TARGET_EXISTS: ${target}`);
        throw cause;
      }
    }
    fsyncDirectory(directory);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function fsyncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(directory, "r");
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function hitFault(
  options: DeliveryAdapterOptions,
  point: DeliveryFaultPoint,
): void {
  if (options.fault === point)
    throw new Error(`DELIVERY_FAULT_INJECTED: ${point}`);
}

function isAlreadyExists(cause: unknown): boolean {
  return Boolean(
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    (cause as { code?: unknown }).code === "EEXIST",
  );
}

function buildMetrics(
  build: {
    bytes: number;
    runtimeGzipBytes?: number;
    resourceBytes?: number;
    budgetBytes?: number;
  },
  fallbackBudget: number,
): DeliveryMetrics {
  return {
    bytes: build.bytes,
    runtimeGzipBytes: build.runtimeGzipBytes ?? 0,
    resourceBytes: build.resourceBytes ?? 0,
    budgetBytes: build.budgetBytes ?? fallbackBudget,
  };
}

function firstIssueCode(issues: ValidationIssue[], fallback: string): string {
  return issues.find((item) => item.severity === "error")?.code ?? fallback;
}

function issue(
  code: string,
  message: string,
  elementId?: string,
  recovery?: string,
): ValidationIssue {
  return withErrorSemantics({
    code,
    severity: "error",
    message,
    ...(elementId ? { elementId } : {}),
    ...(recovery ? { recovery } : {}),
  });
}
