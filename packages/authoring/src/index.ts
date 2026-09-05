import { canonicalRevision } from "../../canonical-json/src/index.js";
import {
  compilePresentation,
  materializeSlideDraft,
} from "../../design-compiler/src/index.js";
import type {
  PpteDocument,
  PresentationIR,
  Transaction,
  Operation,
  Source,
  Fact,
  Asset,
  FontAsset,
  ThemeDefinition,
} from "../../schema/src/index.js";
export { createEmptyDocument } from "./default-document.js";

/** Data produced by the user's existing Agent, never executable application code. */
export interface AuthoringProject {
  presentation: PresentationIR;
  sources?: Record<string, Source>;
  facts?: Record<string, Fact>;
  assets?: Record<string, Asset>;
  fonts?: Record<string, FontAsset>;
  assetBytes?: Record<string, string>;
  fontBytes?: Record<string, string>;
  theme?: ThemeDefinition;
}
export type AuthoringInput = PresentationIR | AuthoringProject;
export function authoringProject(input: AuthoringInput): AuthoringProject {
  if (!input || typeof input !== "object")
    throw new Error("AUTHORING_INVALID: expected Presentation IR JSON.");
  return "presentation" in input ? input : { presentation: input };
}
export function buildAuthoringTransaction(
  document: PpteDocument,
  input: AuthoringInput,
): Transaction {
  const project = authoringProject(input);
  const raw = project.presentation;
  if (!raw || !Array.isArray(raw.slides) || !raw.slides.length)
    throw new Error(
      "AUTHORING_INVALID: provide at least one semantic slide, not an empty or copied-page placeholder.",
    );
  const ir: PresentationIR = {
    ...raw,
    slides: raw.slides.map((slide) => ({
      ...slide,
      blocks: Array.isArray(slide.blocks)
        ? slide.blocks.map((block) => ({
            ...block,
            semanticKey: block.semanticKey ?? `${slide.slideKey}.${block.key}`,
          }))
        : slide.blocks,
    })),
  };
  const draft = compilePresentation(ir, {
    canvas: document.canvas,
    theme: project.theme ?? document.theme,
  });
  const errors = draft.validationIssues.filter((i) => i.severity === "error");
  if (errors.length)
    throw new Error(errors.map((i) => `${i.code}: ${i.message}`).join("\n"));
  const operations: Operation[] = [];
  const id = `author:${crypto.randomUUID()}`;
  for (const slideId of document.slideOrder)
    operations.push({
      opId: `${id}:delete:${slideId}`,
      kind: "slide.delete",
      slideId,
    });
  if (project.theme)
    operations.push({
      opId: `${id}:theme`,
      kind: "theme.replace",
      theme: project.theme,
    });
  for (const source of Object.values(project.sources ?? {}))
    operations.push({
      opId: `${id}:source:${source.id}`,
      kind: "source.upsert",
      source,
    });
  for (const fact of Object.values(project.facts ?? {}))
    operations.push({
      opId: `${id}:fact:${fact.id}`,
      kind: "fact.upsert",
      fact,
    });
  for (const asset of Object.values(project.assets ?? {}))
    operations.push({
      opId: `${id}:asset:${asset.id}`,
      kind: "asset.upsert",
      asset,
    });
  for (const font of Object.values(project.fonts ?? {}))
    operations.push({
      opId: `${id}:font:${font.id}`,
      kind: "font.upsert",
      font,
    });
  draft.slideDrafts.forEach((slide, index) =>
    operations.push({
      opId: `${id}:slide:${index}`,
      kind: "slide.insert",
      slide: materializeSlideDraft(
        slide,
        `slide_${index + 1}`,
        document.canvas,
      ),
      index,
    }),
  );
  operations.push({
    opId: `${id}:metadata`,
    kind: "document.updateMetadata",
    patch: {
      title: ir.title,
      source: "generated",
      subject: ir.audience,
      description: ir.objective,
    },
  });
  return {
    transactionId: id,
    baseRevision: canonicalRevision(document),
    actor: { type: "agent", id: "authoring" },
    scope: {
      kind: "document",
      permissions: [
        "content",
        "geometry",
        "style",
        "structure",
        "theme",
        "assets",
        "facts",
        "sources",
        "notes",
        "animation",
      ],
      allowInsert: true,
      allowDelete: true,
    },
    changeContract: {
      allowedOperationKinds: [...new Set(operations.map((o) => o.kind))],
      maxChangedSlides: document.slideOrder.length + ir.slides.length,
      maxChangedElements: Number.MAX_SAFE_INTEGER,
      maxInsertedElements: Number.MAX_SAFE_INTEGER,
      maxDeletedElements: Number.MAX_SAFE_INTEGER,
      maxReplacedAssets: Number.MAX_SAFE_INTEGER,
      maxChangedFacts: Number.MAX_SAFE_INTEGER,
      maxChangedSources: Number.MAX_SAFE_INTEGER,
      maxChangedThemeTokens: Number.MAX_SAFE_INTEGER,
      maxChangedStylePresets: Number.MAX_SAFE_INTEGER,
      userIntentSummary:
        "Compile Agent-authored Presentation IR into a complete semantic presentation.",
    },
    createdAt: new Date().toISOString(),
    operations,
  };
}
