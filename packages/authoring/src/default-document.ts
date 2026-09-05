import { plainTextToRichText } from "../../richtext-adapter/src/index.js";
import type {
  PpteDocument,
  TextElement,
  ThemeDefinition,
} from "../../schema/src/index.js";
const now = () => new Date().toISOString();
/** The smallest valid semantic document used by the New action. */
export function createEmptyDocument(
  presentationTitle = "Untitled presentation",
): PpteDocument {
  const theme: ThemeDefinition = {
    id: "host-theme",
    name: "PPTe Host Theme",
    tokens: {
      colors: {
        "color.background": "#F8FAFC",
        "color.text.primary": "#172033",
        "color.text.muted": "#475569",
        "color.surface": "#FFFFFF",
        "color.accent": "#2563EB",
      },
      fontFamilies: { "font.heading": "sans-serif", "font.body": "sans-serif" },
      fontSizes: { "fontSize.title": 64, "fontSize.body": 28 },
      spacing: {},
      radii: {},
      shadows: {},
    },
    presets: {
      text: {
        "text.title": {
          fontFamily: { kind: "token", token: "font.heading" },
          fontSize: 64,
          fontWeight: 700,
          color: { kind: "token", token: "color.text.primary" },
          lineHeight: 1.15,
        },
        "text.body": {
          fontFamily: { kind: "token", token: "font.body" },
          fontSize: 28,
          fontWeight: 400,
          color: { kind: "token", token: "color.text.muted" },
          lineHeight: 1.35,
        },
      },
      shape: {
        "shape.surface": {
          fill: {
            kind: "solid",
            color: { kind: "token", token: "color.surface" },
          },
          stroke: {
            color: { kind: "token", token: "color.accent" },
            width: 2,
            opacity: 0.4,
          },
          radius: 24,
        },
      },
      image: {
        "image.hero": {
          border: {
            color: { kind: "token", token: "color.accent" },
            width: 2,
            opacity: 0.6,
          },
          radius: 16,
        },
      },
      chart: {
        "chart.default": {
          palette: [
            { kind: "value", value: "#2563EB" },
            { kind: "value", value: "#14B8A6" },
          ],
          axisColor: { kind: "value", value: "#64748B" },
          labelColor: { kind: "value", value: "#334155" },
          gridColor: { kind: "value", value: "#CBD5E1" },
          lineWidth: 2,
          cornerRadius: 3,
        },
      },
    },
  };
  const titleElement: TextElement = {
    id: "text_title",
    type: "text",
    semanticKey: "title.main",
    role: "title",
    frame: { x: 160, y: 120, width: 1500, height: 130 },
    content: plainTextToRichText(presentationTitle, "host-title"),
    style: { styleRef: "text.title" },
    overflowPolicy: "warn",
  };
  const body: TextElement = {
    id: "text_body",
    type: "text",
    semanticKey: "body.summary",
    role: "body",
    frame: { x: 160, y: 330, width: 1260, height: 260 },
    content: plainTextToRichText(
      "双击文字开始编辑。所有编辑都会回写为 PPTe 语义操作。",
      "host-body",
    ),
    style: { styleRef: "text.body" },
    overflowPolicy: "warn",
  };
  const slideId = "slide_1";
  return {
    schemaVersion: "2.0.0",
    documentId: `ppte_${crypto.randomUUID()}`,
    locale: "zh-CN",
    metadata: { title: presentationTitle, source: "native", createdAt: now() },
    canvas: {
      width: 1920,
      height: 1080,
      unit: "du",
      aspectRatio: "16:9",
      defaultBackground: {
        kind: "solid",
        color: { kind: "value", value: "#F8FAFC" },
      },
    },
    theme,
    slideOrder: [slideId],
    slides: {
      [slideId]: {
        id: slideId,
        name: "Slide 1",
        rootOrder: [titleElement.id, body.id],
        readingOrder: [titleElement.id, body.id],
        elements: { [titleElement.id]: titleElement, [body.id]: body },
        groups: {},
      },
    },
    assets: {},
    fonts: {
      "system-sans": {
        id: "system-sans",
        family: "sans-serif",
        source: "system",
        weight: 400,
        style: "normal",
        editableSafe: true,
      },
    },
  };
}
