import { NextResponse } from "next/server";

import { getAccessContext } from "@/lib/access";
import { resolveOpenAIConfig } from "@/lib/backends/registry";
import { listGroups, mapSub2ApiError, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

/**
 * Groups (id + name) on a given Sub2API-family backend, for the OpenAI 上key
 * group picker. Superadmin only. `ref` must be an OpenAI-capable target
 * ("sub2api" or "sub2gw:<id>"); resolving logs into the instance as needed.
 */
export async function GET(request: Request) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (context.role !== "superadmin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ref = (new URL(request.url).searchParams.get("ref") || "").slice(0, 80);
  if (!ref) return NextResponse.json({ error: "missing_ref" }, { status: 400 });

  try {
    const config = await resolveOpenAIConfig(ref);
    const items = await listGroups(config);
    return NextResponse.json({ items });
  } catch (error) {
    const failure = mapSub2ApiError(error, "读取分组失败");
    if (!(error instanceof Sub2ApiError)) {
      console.error("[admin.backends.groups] failed", error instanceof Error ? error.message : error);
    }
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
