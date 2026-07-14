import { createHmac } from "node:crypto";
import { Composio } from "@composio/core";
import { ApiError } from "../errors/api-error.js";

const toolkitSlugPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/;
export const composioToolkits = [
  "linear",
  "github",
  "gmail",
  "slack",
  "notion",
] as const;
export type ComposioToolkit = string;
export interface ComposioConnection {
  connected: boolean;
  description?: string;
  logo?: string;
  name: string;
  slug: string;
  toolsCount?: number;
}
export interface ToolSetting {
  approvalPolicy?: "ask" | "automatic";
  connectedAccountIds?: string[];
  disabledTools?: string[];
  enabled?: boolean;
}
export type ToolSettings = Record<string, ToolSetting>;

export class ComposioService {
  private readonly client: Composio | undefined;
  constructor(private readonly apiKey = process.env.COMPOSIO_API_KEY) {
    this.client = apiKey ? new Composio({ apiKey }) : undefined;
  }
  get configured() {
    return Boolean(this.client);
  }
  async connections(
    userId: string,
    signal: AbortSignal
  ): Promise<ComposioConnection[]> {
    if (!this.client)
      return composioToolkits.map((slug) => ({
        connected: false,
        name: toolkitName(slug),
        slug,
      }));
    signal.throwIfAborted();
    const session = await this.client.sessions.create(userId, {
      toolkits: [...composioToolkits],
    });
    const result = await session.toolkits({ toolkits: [...composioToolkits] });
    return composioToolkits.map((slug) => {
      const item = result.items.find(
        (candidate) => candidate.slug.toLowerCase() === slug
      );
      return {
        connected: item?.connection?.isActive === true,
        name: item?.name ?? toolkitName(slug),
        slug,
        ...(item?.logo ? { logo: item.logo } : {}),
      };
    });
  }
  async catalog(
    userId: string,
    search: string | undefined,
    cursor: string | undefined,
    signal: AbortSignal
  ) {
    if (!this.client)
      return {
        cursor: undefined,
        items: await this.connections(userId, signal),
      };
    signal.throwIfAborted();
    const session = await this.client.sessions.create(userId, {});
    const result = await session.toolkits({
      limit: 30,
      ...(search ? { search } : {}),
      ...(cursor ? { cursor } : {}),
    });
    return {
      cursor: result.cursor,
      items: result.items.map((item) => ({
        connected: item.connection?.isActive === true,
        name: item.name,
        slug: item.slug,
        ...(item.logo ? { logo: item.logo } : {}),
      })),
    };
  }
  async accounts(userId: string, signal: AbortSignal) {
    if (!this.client) return [];
    const result = await this.client.connectedAccounts.list(
      { limit: 100, orderBy: "updated_at", userIds: [userId] },
      { signal }
    );
    return result.items.map((account) => ({
      active: account.status === "ACTIVE" && !account.isDisabled,
      alias: account.alias ?? undefined,
      createdAt: account.createdAt,
      id: account.id,
      status: account.status,
      toolkit: account.toolkit.slug,
      updatedAt: account.updatedAt,
    }));
  }
  async tools(userId: string, toolkit: string, signal: AbortSignal) {
    const client = this.required();
    signal.throwIfAborted();
    const items = (await client.tools.get(userId, {
      limit: 100,
      toolkits: [toolkit],
    })) as unknown as Array<{
      function?: { name?: string; description?: string };
    }>;
    return items.flatMap((item) =>
      item.function?.name
        ? [
            {
              description: item.function.description ?? "",
              slug: item.function.name,
            },
          ]
        : []
    );
  }
  async connect(
    userId: string,
    toolkit: ComposioToolkit,
    callbackUrl: string,
    signal: AbortSignal
  ): Promise<{ authorizationUrl: string; connectionId: string }> {
    signal.throwIfAborted();
    const client = this.required();
    const session = await client.sessions.create(userId, {
      toolkits: [toolkit],
    });
    const connection = await session.authorize(toolkit, {
      alias: `${toolkit}-${Date.now()}`,
      callbackUrl,
    });
    if (!connection.redirectUrl)
      throw new ApiError(
        "INTEGRATION_UNAVAILABLE",
        `${toolkitName(toolkit)} did not return a connection link`,
        502,
        false
      );
    return {
      authorizationUrl: connection.redirectUrl,
      connectionId: connection.id,
    };
  }
  async disconnect(
    userId: string,
    toolkit: ComposioToolkit,
    signal: AbortSignal
  ): Promise<void> {
    signal.throwIfAborted();
    const client = this.required();
    const session = await client.sessions.create(userId, {
      toolkits: [toolkit],
    });
    const result = await session.toolkits({ toolkits: [toolkit] });
    const id = result.items[0]?.connection?.connectedAccount?.id;
    if (!id) return;
    await client.connectedAccounts.disable(id);
  }
  async setAccountState(
    userId: string,
    accountId: string,
    action: "enable" | "disable" | "refresh",
    signal: AbortSignal
  ) {
    const client = this.required();
    const owned = await client.connectedAccounts.list(
      { limit: 100, userIds: [userId] },
      { signal }
    );
    if (!owned.items.some((account) => account.id === accountId))
      throw new ApiError(
        "PERMISSION_DENIED",
        "That connection does not belong to this user",
        403,
        false
      );
    if (action === "enable") await client.connectedAccounts.enable(accountId);
    else if (action === "refresh")
      await client.connectedAccounts.refresh(accountId);
    else await client.connectedAccounts.disable(accountId);
  }
  async mcp(
    userId: string,
    signal: AbortSignal,
    settings: ToolSettings = {}
  ): Promise<{ url: string; authorization: string } | null> {
    if (!(this.client && this.apiKey)) return null;
    signal.throwIfAborted();
    const configured = Object.entries(settings).filter(
      ([, value]) => value.enabled !== false
    );
    const toolkits = configured.length
      ? configured.map(([slug]) => slug)
      : [...composioToolkits];
    const tools = Object.fromEntries(
      configured
        .filter(([, value]) => value.disabledTools?.length)
        .map(([slug, value]) => [slug, { disable: value.disabledTools! }])
    );
    const connectedAccounts = Object.fromEntries(
      configured
        .filter(([, value]) => value.connectedAccountIds?.length)
        .map(([slug, value]) => [slug, value.connectedAccountIds!])
    );
    const session = await this.client.sessions.create(userId, {
      connectedAccounts,
      manageConnections: true,
      mcp: true,
      toolkits,
      tools,
    });
    const target = session.mcp.url;
    const signature = signComposioTarget(target, this.apiKey);
    const base =
      process.env.PUBLIC_API_URL ?? "https://tooled-voice-api.vercel.app";
    const url = new URL("/api/mcp/composio", base);
    url.searchParams.set("target", target);
    url.searchParams.set("signature", signature);
    return { authorization: this.apiKey, url: url.toString() };
  }
  private required() {
    if (!this.client)
      throw new ApiError(
        "INTEGRATION_UNAVAILABLE",
        "Composio is not configured",
        503,
        false
      );
    return this.client;
  }
}
function toolkitName(slug: ComposioToolkit) {
  return slug[0]!.toUpperCase() + slug.slice(1);
}
export function parseComposioToolkit(value: string): ComposioToolkit | null {
  return toolkitSlugPattern.test(value) ? value : null;
}
export function signComposioTarget(target: string, key: string) {
  return createHmac("sha256", key).update(target).digest("base64url");
}
