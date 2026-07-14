import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  conversationItemInputSchema,
  conversationStatusInputSchema,
  toolCallRequestSchema,
} from "@tooled-voice/shared";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { verifyAccessToken } from "../auth/verify-access-token.js";
import { createDatabase, type Database } from "../database/client.js";
import {
  conversationItems,
  conversations,
  userProfiles,
} from "../database/schema.js";
import { ApiError, normalizeError } from "../errors/api-error.js";
import type { ToolSettings } from "../integrations/composio-service.js";
import {
  ComposioService,
  parseComposioToolkit,
  signComposioTarget,
} from "../integrations/composio-service.js";
import {
  LinearService,
  linearMobileRedirectUri,
} from "../integrations/linear-service.js";
import { logger } from "../logging/logger.js";
import {
  createRealtimeSession,
  type RealtimeMcpConnection,
} from "../realtime/create-session.js";
import { dispatchTool } from "../tools/dispatch.js";

const bearerPrefixPattern = /^Bearer\s+/i;
interface Variables {
  requestId: string;
  user: Awaited<ReturnType<typeof verifyAccessToken>>;
}
type AppContext = Context<{ Variables: Variables }>;
function composioProxyInput(
  c: AppContext
): { apiKey: string; url: URL } | Response {
  const authorization = c.req.header("authorization");
  const apiKey = authorization?.replace(bearerPrefixPattern, "");
  const target = c.req.query("target");
  const signature = c.req.query("signature");
  if (!(apiKey && target && signature)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return c.json({ error: "Invalid target" }, 400);
  }
  if (url.protocol !== "https:" || url.hostname !== "backend.composio.dev") {
    return c.json({ error: "Invalid target" }, 400);
  }
  const expected = signComposioTarget(target, apiKey);
  const supplied = Buffer.from(signature);
  const valid =
    supplied.length === Buffer.byteLength(expected) &&
    timingSafeEqual(supplied, Buffer.from(expected));
  return valid ? { apiKey, url } : c.json({ error: "Unauthorized" }, 401);
}
async function proxyComposio(c: AppContext): Promise<Response> {
  const input = composioProxyInput(c);
  if (input instanceof Response) {
    return input;
  }
  const headers = new Headers({
    Accept: c.req.header("accept") ?? "application/json, text/event-stream",
    "Content-Type": c.req.header("content-type") ?? "application/json",
    "x-api-key": input.apiKey,
  });
  for (const name of ["mcp-session-id", "last-event-id"]) {
    const value = c.req.header(name);
    if (value) {
      headers.set(name, value);
    }
  }
  const hasBody = !["GET", "HEAD"].includes(c.req.method);
  const response = await fetch(input.url, {
    headers,
    method: c.req.method,
    ...(hasBody ? { body: Buffer.from(await c.req.arrayBuffer()) } : {}),
    redirect: "error",
    signal: c.req.raw.signal,
  });
  const outgoing = new Headers();
  for (const name of ["content-type", "mcp-session-id", "retry-after"]) {
    const value = response.headers.get(name);
    if (value) {
      outgoing.set(name, value);
    }
  }
  return new Response(response.body, {
    headers: outgoing,
    status: response.status,
  });
}
async function realtimeMcpConnection(
  composio: ComposioService,
  linear: LinearService,
  userId: string,
  signal: AbortSignal,
  toolSettings: ToolSettings,
  approvalPolicy: "ask" | "automatic"
): Promise<{
  connection: RealtimeMcpConnection | undefined;
  provider: "composio" | "linear" | undefined;
}> {
  const composioMcp = await composio.mcp(userId, signal, toolSettings);
  if (composioMcp) {
    return {
      connection: {
        approvalPolicy,
        authorization: composioMcp.authorization,
        label: "composio",
        url: composioMcp.url,
      },
      provider: "composio",
    };
  }
  const linearConnection = await linear.sessionConnection(userId, signal);
  return linearConnection
    ? {
        connection: {
          approvalPolicy,
          authorization: linearConnection.accessToken,
          label: "linear",
          url: "https://mcp.linear.app/mcp",
        },
        provider: "linear",
      }
    : { connection: undefined, provider: undefined };
}
async function realtimeConversation(
  database: Database,
  userId: string,
  requestedId: unknown,
  realtimeSessionId: string | undefined
): Promise<string> {
  if (typeof requestedId === "string") {
    const [owned] = await database
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, requestedId),
          eq(conversations.userId, userId),
          eq(conversations.status, "active")
        )
      )
      .limit(1);
    if (owned) {
      await database
        .update(conversations)
        .set({ realtimeSessionId, updatedAt: new Date() })
        .where(eq(conversations.id, owned.id));
      return owned.id;
    }
  }
  const [created] = await database
    .insert(conversations)
    .values({ realtimeSessionId, userId })
    .returning({ id: conversations.id });
  if (!created) {
    throw new ApiError(
      "INTERNAL_ERROR",
      "Failed to create the conversation",
      500
    );
  }
  return created.id;
}
export function createApp(database = createDatabase()) {
  const app = new Hono<{ Variables: Variables }>();
  const linear = new LinearService(database);
  const composio = new ComposioService();
  app.get("/auth/confirmed", (c) =>
    c.html(
      '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.png"><title>Account confirmed</title><body style="background:#11130e;color:#f0f1e8;font:16px system-ui;margin:0;display:grid;min-height:100vh;place-items:center"><main style="padding:32px;max-width:520px"><img src="/icon.png" width="96" height="96" alt="Tooled Voice" style="border-radius:22px"><p style="color:#e8ff58;font-weight:800;letter-spacing:.16em">TOOLED / VOICE</p><h1>Account confirmed.</h1><p>You can return to the Tooled Voice app and sign in.</p></main></body></html>'
    )
  );
  app.get("/oauth/linear/callback", async (c) => {
    const redirect = new URL(linearMobileRedirectUri());
    const providerError = c.req.query("error");
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (providerError || !code || !state) {
      redirect.searchParams.set("status", "error");
      redirect.searchParams.set(
        "code",
        providerError ?? "OAUTH_INVALID_CALLBACK"
      );
      return c.redirect(redirect.toString());
    }
    try {
      await linear.completeAuthorization(code, state, c.req.raw.signal);
      redirect.searchParams.set("status", "connected");
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error(
        { errorCode: normalized.code, provider: "linear" },
        "OAuth callback failed"
      );
      redirect.searchParams.set("status", "error");
      redirect.searchParams.set("code", normalized.code);
    }
    return c.redirect(redirect.toString());
  });
  app.get("/api/health", async (c) => {
    try {
      await database.execute(sql`select 1`);
      return c.json({ database: "connected", ok: true });
    } catch {
      return c.json({ database: "unavailable", ok: false }, 503);
    }
  });
  app.all("/api/mcp/composio", proxyComposio);
  app.use("/api/*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    try {
      c.set("user", await verifyAccessToken(c.req.header("authorization")));
      await next();
    } catch (error) {
      const normalized = normalizeError(error);
      return c.json(
        {
          error: {
            code: normalized.code,
            message: normalized.message,
            retryable: normalized.retryable,
          },
          ok: false,
        },
        normalized.status as 401
      );
    }
  });
  app.post("/api/realtime/session", async (c) => {
    const started = Date.now();
    try {
      const userId = c.var.user.id;
      const body = (await c.req.json().catch(() => ({}))) as {
        conversationId?: unknown;
      };
      await database
        .insert(userProfiles)
        .values({ id: userId })
        .onConflictDoNothing();
      const [profile] = await database
        .select({
          toolApprovalPolicy: userProfiles.toolApprovalPolicy,
          toolSettings: userProfiles.toolSettings,
        })
        .from(userProfiles)
        .where(eq(userProfiles.id, userId))
        .limit(1);
      const approvalPolicy =
        profile?.toolApprovalPolicy === "automatic"
          ? ("automatic" as const)
          : ("ask" as const);
      const toolSettings = (profile?.toolSettings ?? {}) as ToolSettings;
      const mcp = await realtimeMcpConnection(
        composio,
        linear,
        userId,
        c.req.raw.signal,
        toolSettings,
        approvalPolicy
      );
      const session = await createRealtimeSession(
        userId,
        c.req.raw.signal,
        mcp.connection
      );
      const conversationId = await realtimeConversation(
        database,
        userId,
        body.conversationId,
        session.sessionId
      );
      logger.info(
        {
          conversationId,
          durationMs: Date.now() - started,
          mcpProvider: mcp.provider,
          realtimeSessionId: session.sessionId,
          requestId: c.var.requestId,
          status: "succeeded",
          toolApprovalPolicy: approvalPolicy,
          userId,
        },
        "Realtime session created"
      );
      return c.json({
        ...session,
        conversationId,
        toolApprovalPolicies: Object.fromEntries(
          Object.entries(toolSettings).map(([slug, setting]) => [
            slug,
            setting.approvalPolicy ?? approvalPolicy,
          ])
        ),
      });
    } catch (error) {
      const e = normalizeError(error);
      logger.error(
        {
          durationMs: Date.now() - started,
          errorCode: e.code,
          requestId: c.var.requestId,
          status: "failed",
          userId: c.var.user.id,
        },
        "Realtime session failed"
      );
      return c.json(
        {
          error: { code: e.code, message: e.message, retryable: e.retryable },
          ok: false,
        },
        e.status as 500
      );
    }
  });
  app.get("/api/integrations", async (c) => {
    const userId = c.var.user.id;
    await database
      .insert(userProfiles)
      .values({ id: userId })
      .onConflictDoNothing();
    const [profile, connections, legacyLinear, accounts] = await Promise.all([
      database
        .select({
          toolApprovalPolicy: userProfiles.toolApprovalPolicy,
          toolSettings: userProfiles.toolSettings,
        })
        .from(userProfiles)
        .where(eq(userProfiles.id, userId))
        .limit(1),
      composio.connections(userId, c.req.raw.signal),
      composio.configured ? Promise.resolve(null) : linear.status(userId),
      composio.accounts(userId, c.req.raw.signal),
    ]);
    if (legacyLinear?.connected) {
      const item = connections.find(
        (connection) => connection.slug === "linear"
      );
      if (item) {
        item.connected = true;
      }
    }
    return c.json({
      accounts,
      approvalPolicy:
        profile[0]?.toolApprovalPolicy === "automatic" ? "automatic" : "ask",
      configured: composio.configured,
      connections,
      settings: profile[0]?.toolSettings ?? {},
    });
  });
  app.get("/api/integrations/catalog", async (c) =>
    c.json(
      await composio.catalog(
        c.var.user.id,
        c.req.query("search") || undefined,
        c.req.query("cursor") || undefined,
        c.req.raw.signal
      )
    )
  );
  app.get("/api/integrations/:toolkit/tools", async (c) => {
    const toolkit = parseComposioToolkit(c.req.param("toolkit"));
    if (!toolkit) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Unknown integration",
            retryable: false,
          },
          ok: false,
        },
        400
      );
    }
    return c.json({
      tools: await composio.tools(c.var.user.id, toolkit, c.req.raw.signal),
    });
  });
  app.put("/api/integrations/:toolkit/preferences", async (c) => {
    const toolkit = parseComposioToolkit(c.req.param("toolkit"));
    const body = (await c.req.json().catch(() => null)) as {
      enabled?: unknown;
      approvalPolicy?: unknown;
      connectedAccountIds?: unknown;
      disabledTools?: unknown;
    } | null;
    if (
      !(toolkit && body) ||
      typeof body.enabled !== "boolean" ||
      (body.approvalPolicy !== "ask" && body.approvalPolicy !== "automatic") ||
      !Array.isArray(body.connectedAccountIds) ||
      !body.connectedAccountIds.every((value) => typeof value === "string") ||
      !Array.isArray(body.disabledTools) ||
      !body.disabledTools.every((value) => typeof value === "string")
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid tool preferences",
            retryable: false,
          },
          ok: false,
        },
        400
      );
    }
    const [profile] = await database
      .select({ toolSettings: userProfiles.toolSettings })
      .from(userProfiles)
      .where(eq(userProfiles.id, c.var.user.id))
      .limit(1);
    const settings = {
      ...((profile?.toolSettings ?? {}) as ToolSettings),
      [toolkit]: body,
    };
    await database
      .insert(userProfiles)
      .values({ id: c.var.user.id, toolSettings: settings })
      .onConflictDoUpdate({
        set: { toolSettings: settings, updatedAt: new Date() },
        target: userProfiles.id,
      });
    return c.json({ settings });
  });
  app.post("/api/integrations/accounts/:id/:action", async (c) => {
    const action = c.req.param("action");
    if (action !== "enable" && action !== "disable" && action !== "refresh") {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid account action",
            retryable: false,
          },
          ok: false,
        },
        400
      );
    }
    await composio.setAccountState(
      c.var.user.id,
      c.req.param("id"),
      action,
      c.req.raw.signal
    );
    return c.json({ ok: true });
  });
  app.post("/api/integrations/:toolkit/connect", async (c) => {
    const toolkit = parseComposioToolkit(c.req.param("toolkit"));
    if (!toolkit) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Unknown integration",
            retryable: false,
          },
          ok: false,
        },
        400
      );
    }
    if (!composio.configured && toolkit === "linear") {
      return c.json(await linear.createAuthorization(c.var.user.id));
    }
    return c.json(
      await composio.connect(
        c.var.user.id,
        toolkit,
        "tooledvoice://integrations/composio",
        c.req.raw.signal
      )
    );
  });
  app.delete("/api/integrations/:toolkit", async (c) => {
    const toolkit = parseComposioToolkit(c.req.param("toolkit"));
    if (!toolkit) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Unknown integration",
            retryable: false,
          },
          ok: false,
        },
        400
      );
    }
    if (!composio.configured && toolkit === "linear") {
      await linear.disconnect(c.var.user.id, c.req.raw.signal);
    } else {
      await composio.disconnect(c.var.user.id, toolkit, c.req.raw.signal);
    }
    return c.body(null, 204);
  });
  app.put("/api/integrations/approval-policy", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      approvalPolicy?: unknown;
    } | null;
    if (
      body?.approvalPolicy !== "ask" &&
      body?.approvalPolicy !== "automatic"
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid tool permission level",
            retryable: false,
          },
          ok: false,
        },
        400
      );
    }
    await database
      .insert(userProfiles)
      .values({ id: c.var.user.id, toolApprovalPolicy: body.approvalPolicy })
      .onConflictDoUpdate({
        set: { toolApprovalPolicy: body.approvalPolicy, updatedAt: new Date() },
        target: userProfiles.id,
      });
    return c.json({ approvalPolicy: body.approvalPolicy });
  });
  app.post("/api/integrations/linear/connect", async (c) =>
    c.json(await linear.createAuthorization(c.var.user.id))
  );
  app.get("/api/integrations/linear/status", async (c) =>
    c.json(await linear.status(c.var.user.id))
  );
  app.put("/api/integrations/linear/approval-policy", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      approvalPolicy?: unknown;
    } | null;
    if (
      body?.approvalPolicy !== "ask" &&
      body?.approvalPolicy !== "automatic"
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid Linear permission level",
            retryable: false,
          },
          ok: false,
        },
        400
      );
    }
    await linear.setApprovalPolicy(c.var.user.id, body.approvalPolicy);
    return c.json(await linear.status(c.var.user.id));
  });
  app.delete("/api/integrations/linear", async (c) => {
    await linear.disconnect(c.var.user.id, c.req.raw.signal);
    return c.body(null, 204);
  });
  app.get("/api/conversations", async (c) => {
    const rows = await database
      .select({
        createdAt: conversations.createdAt,
        id: conversations.id,
        status: conversations.status,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(eq(conversations.userId, c.var.user.id))
      .orderBy(desc(conversations.updatedAt))
      .limit(20);
    return c.json({ conversations: rows });
  });
  app.get("/api/conversations/:id/items", async (c) => {
    const rows = await database
      .select()
      .from(conversationItems)
      .innerJoin(
        conversations,
        eq(conversationItems.conversationId, conversations.id)
      )
      .where(
        and(
          eq(conversations.id, c.req.param("id")),
          eq(conversations.userId, c.var.user.id)
        )
      )
      .orderBy(asc(conversationItems.sequence));
    return c.json({ items: rows.map((row) => row.conversation_items) });
  });
  app.post("/api/conversations/:id/status", async (c) => {
    const parsed = conversationStatusInputSchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid conversation status",
            retryable: false,
          },
          ok: false,
        },
        400
      );
    }
    const [updated] = await database
      .update(conversations)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(
        and(
          eq(conversations.id, c.req.param("id")),
          eq(conversations.userId, c.var.user.id)
        )
      )
      .returning({ id: conversations.id });
    if (!updated) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Conversation not found",
            retryable: false,
          },
          ok: false,
        },
        404
      );
    }
    return c.json({ ok: true });
  });
  app.post("/api/conversations/:id/items", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid JSON",
            retryable: false,
          },
          ok: false,
        },
        400
      );
    }
    const parsed = conversationItemInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid conversation item",
            retryable: false,
          },
          ok: false,
        },
        400
      );
    }
    const id = c.req.param("id");
    const owned = await database
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(eq(conversations.id, id), eq(conversations.userId, c.var.user.id))
      )
      .limit(1);
    if (!owned[0]) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Conversation not found",
            retryable: false,
          },
          ok: false,
        },
        404
      );
    }
    const item = await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${id}, 0))`
      );
      const [created] = await transaction
        .insert(conversationItems)
        .values({
          conversationId: id,
          sequence: sql`(select coalesce(max(${conversationItems.sequence}), 0) + 1 from ${conversationItems} where ${conversationItems.conversationId} = ${id})`,
          ...parsed.data,
        })
        .returning();
      await transaction
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, id));
      return created;
    });
    return c.json({ item }, 201);
  });
  app.post("/api/tools", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          callId: "unknown",
          error: {
            code: "INVALID_REQUEST",
            message: "The request body was not valid JSON",
            retryable: false,
          },
          ok: false,
        },
        400
      );
    }
    const parsed = toolCallRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          callId:
            typeof body === "object" &&
            body &&
            "callId" in body &&
            typeof body.callId === "string"
              ? body.callId
              : "unknown",
          error: {
            code: "INVALID_REQUEST",
            message: "The tool request was invalid",
            retryable: false,
          },
          ok: false,
        },
        400
      );
    }
    const result = await dispatchTool(parsed.data, {
      database,
      logger,
      requestId: c.var.requestId,
      signal: c.req.raw.signal,
      user: c.var.user,
    });
    return c.json(result, result.ok ? 200 : toolHttpStatus(result.error.code));
  });
  app.onError((error, c) => {
    const e = normalizeError(error);
    logger.error(
      { errorCode: e.code, requestId: c.get("requestId") },
      "Request failed"
    );
    return c.json(
      {
        error: { code: e.code, message: e.message, retryable: e.retryable },
        ok: false,
      },
      e.status as 500
    );
  });
  return app;
}
function toolHttpStatus(
  code: string
): 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 504 {
  if (code === "UNKNOWN_TOOL") {
    return 404;
  }
  if (code === "PERMISSION_DENIED") {
    return 403;
  }
  if (code === "INTEGRATION_UNAVAILABLE" || code === "TOOL_IN_PROGRESS") {
    return 409;
  }
  if (code === "INTEGRATION_AUTH_EXPIRED") {
    return 401;
  }
  if (code === "PROVIDER_RATE_LIMITED") {
    return 429;
  }
  if (code === "PROVIDER_UNAVAILABLE") {
    return 502;
  }
  if (code === "TOOL_TIMEOUT") {
    return 504;
  }
  if (code === "TOOL_EXECUTION_FAILED" || code === "INTERNAL_ERROR") {
    return 500;
  }
  return 400;
}
