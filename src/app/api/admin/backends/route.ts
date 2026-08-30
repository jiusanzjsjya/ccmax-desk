import { NextResponse } from "next/server";
import { z } from "zod";

import { getAccessContext } from "@/lib/access";
import {
  addAuditEvent,
  getBackendConfigStore,
  isBackendRefConfigured,
  updateBackendSettings,
  type BackendConfigPatch,
} from "@/lib/account-store";
import { ccgatewayRef, customRef } from "@/lib/backends/kinds";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  defaultBackend: z.string().trim().max(80).optional(),
  enabled: z.array(z.string().trim().max(80)).max(40).optional(),
  sub2api: z
    .object({
      baseUrl: z.string().trim().max(300).optional(),
      adminToken: z.string().max(4000).optional(),
      proxyId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    })
    .optional(),
  newapi: z
    .object({
      baseUrl: z.string().trim().max(300).optional(),
      adminToken: z.string().max(4000).optional(),
      userId: z.string().trim().max(60).optional(),
      channelType: z.coerce.number().int().optional(),
      models: z.string().trim().max(2000).optional(),
      apiKey: z.string().max(4000).optional(),
    })
    .optional(),
  oneapi: z
    .object({
      baseUrl: z.string().trim().max(300).optional(),
      adminToken: z.string().max(4000).optional(),
      channelType: z.coerce.number().int().optional(),
      models: z.string().trim().max(2000).optional(),
      apiKey: z.string().max(4000).optional(),
    })
    .optional(),
  customs: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64).optional(),
        name: z.string().trim().max(80).optional(),
        url: z.string().trim().max(300).optional(),
        token: z.string().max(4000).optional(),
        listUrl: z.string().trim().max(300).optional(),
      }),
    )
    .max(20)
    .optional(),
  ccgateways: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64).optional(),
        name: z.string().trim().max(80).optional(),
        baseUrl: z.string().trim().max(300).optional(),
        vendorEmail: z.string().trim().max(200).optional(),
        vendorPassword: z.string().max(400).optional(),
        groupId: z.string().trim().max(80).optional(),
      }),
    )
    .max(20)
    .optional(),
});

export async function GET() {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (context.role !== "superadmin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const backends = await getBackendConfigStore();
  return NextResponse.json({
    defaultBackend: backends.defaultBackend,
    enabled: backends.enabled,
    // Whether each singleton platform is usable; gateways carry their own flag.
    configured: {
      sub2api: isBackendRefConfigured("sub2api", backends),
      newapi: isBackendRefConfigured("newapi", backends),
      oneapi: isBackendRefConfigured("oneapi", backends),
    },
    // Tokens are never returned; only whether they are set.
    sub2api: { baseUrl: backends.sub2api.baseUrl, hasAdminToken: Boolean(backends.sub2api.adminToken), proxyId: backends.sub2api.proxyId },
    newapi: {
      baseUrl: backends.newapi.baseUrl,
      hasAdminToken: Boolean(backends.newapi.adminToken),
      userId: backends.newapi.userId,
      channelType: backends.newapi.channelType,
      models: backends.newapi.models,
      hasApiKey: Boolean(backends.newapi.apiKey),
    },
    oneapi: {
      baseUrl: backends.oneapi.baseUrl,
      hasAdminToken: Boolean(backends.oneapi.adminToken),
      channelType: backends.oneapi.channelType,
      models: backends.oneapi.models,
      hasApiKey: Boolean(backends.oneapi.apiKey),
    },
    customs: backends.customs.map((gateway) => ({
      id: gateway.id,
      ref: customRef(gateway.id),
      name: gateway.name,
      url: gateway.url,
      hasToken: Boolean(gateway.token),
      listUrl: gateway.listUrl,
      configured: isBackendRefConfigured(customRef(gateway.id), backends),
    })),
    // Vendor passwords are never returned; only whether one is set.
    ccgateways: backends.ccgateways.map((gateway) => ({
      id: gateway.id,
      ref: ccgatewayRef(gateway.id),
      name: gateway.name,
      baseUrl: gateway.baseUrl,
      vendorEmail: gateway.vendorEmail,
      hasPassword: Boolean(gateway.vendorPassword),
      groupId: gateway.groupId,
      configured: isBackendRefConfigured(ccgatewayRef(gateway.id), backends),
    })),
  });
}

export async function PATCH(request: Request) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (context.role !== "superadmin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  // Empty secret fields mean "unchanged" so a blank input never wipes a token.
  const patch = stripBlankSecrets(parsed.data);
  await updateBackendSettings(patch);

  const backends = await getBackendConfigStore();
  await addAuditEvent({
    actorId: context.session.userId,
    actorName: context.session.displayName,
    actorRole: context.role,
    action: "backends.update",
    details: JSON.stringify({
      keys: Object.keys(parsed.data),
      defaultBackend: backends.defaultBackend,
      enabled: backends.enabled,
      gateways: backends.customs.length,
    }),
  });

  return NextResponse.json({ ok: true, defaultBackend: backends.defaultBackend, enabled: backends.enabled });
}

function stripBlankSecrets(input: z.infer<typeof patchSchema>): BackendConfigPatch {
  const patch: BackendConfigPatch = {};
  if (input.defaultBackend) patch.defaultBackend = input.defaultBackend;
  if (input.enabled) patch.enabled = input.enabled;

  if (input.sub2api) {
    patch.sub2api = { ...input.sub2api };
    if (!input.sub2api.adminToken) delete patch.sub2api.adminToken;
  }
  if (input.newapi) {
    patch.newapi = { ...input.newapi };
    if (!input.newapi.adminToken) delete patch.newapi.adminToken;
    if (!input.newapi.apiKey) delete patch.newapi.apiKey;
  }
  if (input.oneapi) {
    patch.oneapi = { ...input.oneapi };
    if (!input.oneapi.adminToken) delete patch.oneapi.adminToken;
    if (!input.oneapi.apiKey) delete patch.oneapi.apiKey;
  }
  // Per-gateway blank tokens are treated as "unchanged" by the store merge.
  if (input.customs) patch.customs = input.customs;
  // Blank vendorPassword is likewise kept by the store merge (see mergeCcGateways).
  if (input.ccgateways) patch.ccgateways = input.ccgateways;
  return patch;
}
