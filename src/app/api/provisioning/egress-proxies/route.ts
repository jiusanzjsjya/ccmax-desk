import { NextResponse } from "next/server";
import { z } from "zod";

import { egressProxyScope, getAccessContext } from "@/lib/access";
import { addAuditEvent, addEgressProxies, countAccountsByProxy, listEgressProxies } from "@/lib/account-store";

export const dynamic = "force-dynamic";

const proxyItemSchema = z.object({
  label: z.string().trim().max(80).optional(),
  // Mirrors the Sub2API proxy protocol enum.
  protocol: z.enum(["http", "https", "socks5", "socks5h"]),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().trim().max(200).optional(),
  password: z.string().max(200).optional(),
});

const createSchema = z.object({ items: z.array(proxyItemSchema).min(1).max(500) });

/** Egress proxies the caller may see: their own; superadmin sees all. Each carries a live account count. */
export async function GET() {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = egressProxyScope(context);
  const all = await listEgressProxies();
  const visible = scope.all ? all : all.filter((proxy) => proxy.ownerId === scope.ownerId);
  const counts = await countAccountsByProxy();

  return NextResponse.json({
    forcedProxyEnabled: context.store.settings.forcedProxyEnabled,
    items: visible.map((proxy) => ({
      id: proxy.id,
      ownerId: proxy.ownerId,
      ownerName: proxy.ownerName,
      label: proxy.label,
      protocol: proxy.protocol,
      host: proxy.host,
      port: proxy.port,
      username: proxy.username,
      hasPassword: Boolean(proxy.password),
      accountCount: counts[proxy.id] ?? 0,
      canDelete: scope.all || proxy.ownerId === scope.ownerId,
      createdAt: proxy.createdAt,
    })),
  });
}

/** Create one or many egress proxies (single form or bulk paste, parsed client-side into items). */
export async function POST(request: Request) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  const added = await addEgressProxies(context.session.userId, context.session.displayName, parsed.data.items);
  await addAuditEvent({
    actorId: context.session.userId,
    actorName: context.session.displayName,
    actorRole: context.role,
    action: "egress_proxy.create",
    details: `added ${added.length}/${parsed.data.items.length}`,
  });

  return NextResponse.json({ ok: true, added: added.length, skipped: parsed.data.items.length - added.length }, { status: 201 });
}
