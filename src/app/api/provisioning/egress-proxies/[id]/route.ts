import { NextResponse } from "next/server";

import { egressProxyScope, getAccessContext } from "@/lib/access";
import { addAuditEvent, deleteEgressProxy, listEgressProxies } from "@/lib/account-store";

export const dynamic = "force-dynamic";

/** Delete an egress proxy. Owner may delete their own; superadmin may delete any. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const target = (await listEgressProxies()).find((proxy) => proxy.id === id);
  if (!target) return NextResponse.json({ error: "proxy_not_found" }, { status: 404 });

  const scope = egressProxyScope(context);
  if (!scope.all && target.ownerId !== scope.ownerId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const removed = await deleteEgressProxy(id);
  if (!removed) return NextResponse.json({ error: "proxy_not_found" }, { status: 404 });

  await addAuditEvent({
    actorId: context.session.userId,
    actorName: context.session.displayName,
    actorRole: context.role,
    action: "egress_proxy.delete",
    targetId: removed.id,
    details: `${removed.protocol}://${removed.host}:${removed.port}`,
  });

  return NextResponse.json({ ok: true });
}
