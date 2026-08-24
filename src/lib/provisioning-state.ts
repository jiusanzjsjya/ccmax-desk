import { randomUUID } from "node:crypto";

import { env } from "@/lib/env";

type ProvisioningFlow = {
  flowId: string;
  ownerSessionId: string;
  sub2SessionId: string;
  authUrl: string;
  createdAt: number;
  expiresAt: number;
  busy: boolean;
};

const flows = new Map<string, ProvisioningFlow>();

export function createProvisioningFlow(input: { ownerSessionId: string; sub2SessionId: string; authUrl: string }) {
  removeExpiredFlows();

  const now = Date.now();
  const flow: ProvisioningFlow = {
    flowId: randomUUID(),
    ownerSessionId: input.ownerSessionId,
    sub2SessionId: input.sub2SessionId,
    authUrl: input.authUrl,
    createdAt: now,
    expiresAt: now + env.PROVISIONING_SESSION_TTL_SECONDS * 1000,
    busy: false,
  };

  flows.set(flow.flowId, flow);
  return flow;
}

export function acquireProvisioningFlow(flowId: string, ownerSessionId: string) {
  removeExpiredFlows();
  const flow = flows.get(flowId);

  if (!flow || flow.ownerSessionId !== ownerSessionId || flow.expiresAt < Date.now()) {
    return null;
  }

  if (flow.busy) {
    throw new Error("该授权流程正在处理中");
  }

  flow.busy = true;
  return flow;
}

export function releaseProvisioningFlow(flowId: string) {
  const flow = flows.get(flowId);
  if (flow) {
    flow.busy = false;
  }
}

export function deleteProvisioningFlow(flowId: string) {
  flows.delete(flowId);
}

function removeExpiredFlows() {
  const now = Date.now();

  for (const [flowId, flow] of flows) {
    if (flow.expiresAt < now) {
      flows.delete(flowId);
    }
  }
}
