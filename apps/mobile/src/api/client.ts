import { type ToolCallRequest, toolResponseSchema } from "@tooled-voice/shared";
import { supabase } from "../auth/supabase";
import { config } from "../config";
export class ApiClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}
async function token() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error("AUTH_REQUIRED");
  }
  return data.session.access_token;
}
export async function apiFetch(path: string, init: RequestInit = {}) {
  const accessToken = await token();
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  const data = response.status === 204 ? undefined : await response.json();
  if (!response.ok) {
    const error = data?.error;
    throw new ApiClientError(
      typeof error?.code === "string" ? error.code : `HTTP_${response.status}`,
      typeof error?.message === "string" ? error.message : "The request failed",
      error?.retryable === true
    );
  }
  return data;
}
export const createRealtimeCredential = (conversationId?: string) =>
  apiFetch("/api/realtime/session", {
    body: JSON.stringify(conversationId ? { conversationId } : {}),
    method: "POST",
  }) as Promise<{
    clientSecret: string;
    expiresAt?: number;
    sessionId?: string;
    model: string;
    conversationId: string;
    toolApprovalPolicies: Record<string, "ask" | "automatic">;
  }>;
export async function executeTool(request: ToolCallRequest) {
  return toolResponseSchema.parse(
    await apiFetch("/api/tools", {
      body: JSON.stringify(request),
      method: "POST",
    })
  );
}
export async function persistConversationItem(
  conversationId: string,
  item: {
    role: "user" | "assistant" | "tool";
    kind: "transcript" | "tool_call" | "tool_result";
    transcript?: string;
    callId?: string;
    payload?: unknown;
    completed?: boolean;
  }
) {
  await apiFetch(`/api/conversations/${conversationId}/items`, {
    body: JSON.stringify(item),
    method: "POST",
  });
}
export async function getLatestConversation() {
  const data = (await apiFetch("/api/conversations")) as {
    conversations: Array<{
      id: string;
      status: "active" | "completed" | "failed";
      updatedAt: string;
    }>;
  };
  const [latest] = data.conversations;
  if (!latest) {
    return null;
  }
  const history = (await apiFetch(`/api/conversations/${latest.id}/items`)) as {
    items: Array<{
      id: string;
      role: "user" | "assistant" | "tool";
      kind: string;
      transcript: string | null;
    }>;
  };
  return { id: latest.id, items: history.items, status: latest.status };
}
export const finishConversation = (
  conversationId: string,
  status: "completed" | "failed"
) =>
  apiFetch(`/api/conversations/${conversationId}/status`, {
    body: JSON.stringify({ status }),
    method: "POST",
  }) as Promise<{ ok: true }>;
export interface LinearStatus {
  approvalPolicy: "ask" | "automatic";
  connected: boolean;
  expiresAt?: string;
  scopes: string[];
}
export const getLinearStatus = () =>
  apiFetch("/api/integrations/linear/status") as Promise<LinearStatus>;
export const setLinearApprovalPolicy = (approvalPolicy: "ask" | "automatic") =>
  apiFetch("/api/integrations/linear/approval-policy", {
    body: JSON.stringify({ approvalPolicy }),
    method: "PUT",
  }) as Promise<LinearStatus>;
export const beginLinearConnection = () =>
  apiFetch("/api/integrations/linear/connect", { method: "POST" }) as Promise<{
    authorizationUrl: string;
  }>;
export const disconnectLinear = () =>
  apiFetch("/api/integrations/linear", { method: "DELETE" }) as Promise<void>;
export type ToolApprovalPolicy = "ask" | "automatic";
export interface ToolConnection {
  connected: boolean;
  logo?: string;
  name: string;
  slug: string;
}
export interface ToolAccount {
  active: boolean;
  alias?: string;
  createdAt: string;
  id: string;
  status: string;
  toolkit: string;
  updatedAt: string;
}
export interface ToolSetting {
  approvalPolicy?: ToolApprovalPolicy;
  connectedAccountIds?: string[];
  disabledTools?: string[];
  enabled?: boolean;
}
export type ToolSettings = Record<string, ToolSetting>;
export const getToolConnections = () =>
  apiFetch("/api/integrations") as Promise<{
    configured: boolean;
    approvalPolicy: ToolApprovalPolicy;
    settings: ToolSettings;
    connections: ToolConnection[];
    accounts: ToolAccount[];
  }>;
export const searchToolCatalog = (search: string) =>
  apiFetch(
    `/api/integrations/catalog${search ? `?search=${encodeURIComponent(search)}` : ""}`
  ) as Promise<{ items: ToolConnection[]; cursor?: string }>;
export const getToolkitTools = (toolkit: string) =>
  apiFetch(`/api/integrations/${toolkit}/tools`) as Promise<{
    tools: Array<{ slug: string; description: string }>;
  }>;
export const beginToolConnection = (toolkit: string) =>
  apiFetch(`/api/integrations/${toolkit}/connect`, {
    method: "POST",
  }) as Promise<{ authorizationUrl: string; connectionId?: string }>;
export const disconnectTool = (toolkit: string) =>
  apiFetch(`/api/integrations/${toolkit}`, {
    method: "DELETE",
  }) as Promise<void>;
export const setToolkitPreferences = (
  toolkit: string,
  setting: Required<ToolSetting>
) =>
  apiFetch(`/api/integrations/${toolkit}/preferences`, {
    body: JSON.stringify(setting),
    method: "PUT",
  }) as Promise<{ settings: ToolSettings }>;
export const updateToolAccount = (
  accountId: string,
  action: "enable" | "disable" | "refresh"
) =>
  apiFetch(`/api/integrations/accounts/${accountId}/${action}`, {
    method: "POST",
  }) as Promise<{ ok: true }>;
export const setToolApprovalPolicy = (approvalPolicy: ToolApprovalPolicy) =>
  apiFetch("/api/integrations/approval-policy", {
    body: JSON.stringify({ approvalPolicy }),
    method: "PUT",
  }) as Promise<{ approvalPolicy: ToolApprovalPolicy }>;
