import { NextResponse } from "next/server";
import { z } from "zod";

import { canUseCustomProxy, getAccessContext, provisioningAccess } from "@/lib/access";
import { isSub2ApiConfigured } from "@/lib/backend-config";
import { createProxy, listProxies, mapSub2ApiError, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

const createProxySchema = z.object({
  name: z.string().trim().max(80).optional(),
  // VERIFIED Sub2API enum — only these four protocols are accepted.
  protocol: z.enum(["http", "https", "socks5", "socks5h"]),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().max(200).optional(),
  password: z.string().max(200).optional(),
});

/** List Sub2API proxies for the wizard's proxy selector (admin / superadmin only). */
export async function GET() {
  const context = await getAccessContext();

  if (!context) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const access = provisioningAccess(context);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // Custom-proxy access: admin/superadmin always; a regular user only when the toggle is on.
  if (!canUseCustomProxy(context)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!(await isSub2ApiConfigured())) {
    return NextResponse.json({ error: "provisioning_not_configured" }, { status: 503 });
  }

  try {
    return NextResponse.json({ items: await listProxies() });
  } catch (error) {
    const failure = mapSub2ApiError(error, "读取 Sub2API 代理列表失败");
    if (!(error instanceof Sub2ApiError)) {
      console.error("[provisioning.proxies] failed", error instanceof Error ? error.message : error);
    }
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

/**
 * Create a custom egress proxy in Sub2API (admin / superadmin only). Sub2API has
 * no inline proxy on the OAuth endpoints, so a custom proxy is stored here first,
 * then selected by id in the wizard. Returns the created proxy (never its password).
 */
export async function POST(request: Request) {
  const context = await getAccessContext();

  if (!context) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const access = provisioningAccess(context);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (!canUseCustomProxy(context)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!(await isSub2ApiConfigured())) {
    return NextResponse.json({ error: "provisioning_not_configured" }, { status: 503 });
  }

  const parsed = createProxySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { name, protocol, host, port, username, password } = parsed.data;

  try {
    const proxy = await createProxy({
      name: name || `自定义-${host}:${port}`,
      protocol,
      host,
      port,
      username,
      password,
    });
    return NextResponse.json({ proxy });
  } catch (error) {
    const failure = mapSub2ApiError(error, "创建 Sub2API 代理失败");
    if (!(error instanceof Sub2ApiError)) {
      console.error("[provisioning.proxies.create] failed", error instanceof Error ? error.message : error);
    }
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
