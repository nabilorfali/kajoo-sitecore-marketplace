export interface FieldDef {
  name: string;
  type:
    | "Single-Line Text"
    | "Multi-Line Text"
    | "Rich Text"
    | "Image"
    | "General Link"
    | "Checkbox"
    | "Integer"
    | "Number"
    | "Date"
    | "DateTime"
    | string;
  defaultValue?: string;
}

export interface DeployManifest {
  componentName: string;
  helixLayer: "Feature" | "Foundation" | "Project";
  module: string;
  fields: FieldDef[];
  placeholder: string;
  /** Sitecore item ID of the rendering (if the rendering already exists) */
  renderingId?: string;
}

const MANIFEST_RE = /<deploy-manifest>([\s\S]*?)<\/deploy-manifest>/;

/**
 * Scan agent response text for a <deploy-manifest> JSON block.
 * Returns null if none is found or if the JSON is malformed.
 */
export function parseManifest(text: string): DeployManifest | null {
  const match = text.match(MANIFEST_RE);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim()) as DeployManifest;
  } catch {
    return null;
  }
}

/**
 * Strip the <deploy-manifest>…</deploy-manifest> block from display text
 * so it doesn't clutter the chat bubble.
 */
export function stripManifest(text: string): string {
  return text.replace(MANIFEST_RE, "").trim();
}
