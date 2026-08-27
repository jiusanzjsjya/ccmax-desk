// Leaf module (no imports) so both server config and client UI can share these
// without creating import cycles.

export type BackendKind = "sub2api" | "newapi" | "oneapi" | "custom";

export const BACKEND_KINDS: BackendKind[] = ["sub2api", "newapi", "oneapi", "custom"];

export function backendLabel(kind: BackendKind) {
  switch (kind) {
    case "sub2api":
      return "Sub2API";
    case "newapi":
      return "new-api";
    case "oneapi":
      return "one-api";
    case "custom":
      return "自建网关";
    default:
      return kind;
  }
}

export function isBackendKind(value: unknown): value is BackendKind {
  return typeof value === "string" && (BACKEND_KINDS as string[]).includes(value);
}
