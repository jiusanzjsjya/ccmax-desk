// Leaf module (no imports) so both server config and client UI can share these
// without creating import cycles.

export type BackendKind = "sub2api" | "newapi" | "oneapi" | "custom" | "ccgateway" | "sub2gw";

export const BACKEND_KINDS: BackendKind[] = ["sub2api", "newapi", "oneapi", "custom", "ccgateway", "sub2gw"];

/**
 * A concrete target platform the operator can pick. Singletons use their kind
 * verbatim ("sub2api" | "newapi" | "oneapi"); each self-built gateway gets its
 * own ref "custom:<id>" so multiple gateways stay distinguishable.
 */
export type BackendRef = string;

const CUSTOM_PREFIX = "custom:";
const CCGATEWAY_PREFIX = "ccgateway:";
const SUB2GW_PREFIX = "sub2gw:";

/** Build the ref for a self-built gateway id. */
export function customRef(id: string): BackendRef {
  return `${CUSTOM_PREFIX}${id}`;
}

/** Extract the gateway id from a "custom:<id>" ref, or null for singleton refs. */
export function customIdFromRef(ref: BackendRef): string | null {
  return ref.startsWith(CUSTOM_PREFIX) ? ref.slice(CUSTOM_PREFIX.length) || null : null;
}

/** Build the ref for a Claude Gateway (vendor) instance id. */
export function ccgatewayRef(id: string): BackendRef {
  return `${CCGATEWAY_PREFIX}${id}`;
}

/** Extract the instance id from a "ccgateway:<id>" ref, or null otherwise. */
export function ccgatewayIdFromRef(ref: BackendRef): string | null {
  return ref.startsWith(CCGATEWAY_PREFIX) ? ref.slice(CCGATEWAY_PREFIX.length) || null : null;
}

/** Build the ref for a password-auth Sub2API gateway instance id. */
export function sub2gwRef(id: string): BackendRef {
  return `${SUB2GW_PREFIX}${id}`;
}

/** Extract the instance id from a "sub2gw:<id>" ref, or null otherwise. */
export function sub2gwIdFromRef(ref: BackendRef): string | null {
  return ref.startsWith(SUB2GW_PREFIX) ? ref.slice(SUB2GW_PREFIX.length) || null : null;
}

/** The BackendKind a ref belongs to ("custom:<id>" -> "custom"). */
export function refKind(ref: BackendRef): BackendKind {
  if (ref.startsWith(CUSTOM_PREFIX)) return "custom";
  if (ref.startsWith(CCGATEWAY_PREFIX)) return "ccgateway";
  if (ref.startsWith(SUB2GW_PREFIX)) return "sub2gw";
  return isBackendKind(ref) ? ref : "custom";
}

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
    case "ccgateway":
      return "Claude Gateway";
    case "sub2gw":
      return "Sub2API 网关";
    default:
      return kind;
  }
}

export function isBackendKind(value: unknown): value is BackendKind {
  return typeof value === "string" && (BACKEND_KINDS as string[]).includes(value);
}
