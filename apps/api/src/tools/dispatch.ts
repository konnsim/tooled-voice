import type { ToolCallRequest, ToolResponse } from "@tooled-voice/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  conversations,
  toolExecutions,
  userProfiles,
} from "../database/schema.js";
import { ApiError, normalizeError } from "../errors/api-error.js";
import type { ToolExecutionContext } from "./define-tool.js";
import { toolRegistry } from "./registry.js";

async function replayedToolCall(
  request: ToolCallRequest,
  context: ToolExecutionContext,
  logContext: Record<string, unknown>
): Promise<ToolResponse | undefined> {
  const [previous] = await context.database
    .select()
    .from(toolExecutions)
    .where(
      and(
        eq(toolExecutions.userId, context.user.id),
        eq(toolExecutions.callId, request.callId)
      )
    )
    .limit(1);

  if (!previous) {
    return;
  }

  if (previous.status === "succeeded") {
    context.logger.info(
      { ...logContext, status: "cached" },
      "Tool call replayed"
    );

    return { callId: request.callId, ok: true, result: previous.result };
  }

  if (previous.status === "running") {
    context.logger.info(
      { ...logContext, status: "in_progress" },
      "Tool call rejected"
    );

    return failure(
      request.callId,
      new ApiError(
        "TOOL_IN_PROGRESS",
        "This tool call is already being processed",
        409,
        true
      )
    );
  }

  context.logger.info(
    {
      ...logContext,
      errorCode: previous.errorCode,
      status: "previously_failed",
    },
    "Tool call replayed"
  );

  return {
    callId: request.callId,
    error: {
      code: previous.errorCode ?? "TOOL_EXECUTION_FAILED",
      message: "This tool call previously failed",
      retryable: previous.retryable ?? false,
    },
    ok: false,
  };
}

async function validateConversation(
  conversationId: string | undefined,
  context: ToolExecutionContext,
  logContext: Record<string, unknown>,
  callId: string
): Promise<ToolResponse | undefined> {
  if (!conversationId) {
    return;
  }

  const [owned] = await context.database
    .select({
      id: conversations.id,
      realtimeSessionId: conversations.realtimeSessionId,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, context.user.id)
      )
    )
    .limit(1);

  if (!owned) {
    context.logger.info(
      { ...logContext, errorCode: "INVALID_REQUEST", status: "rejected" },
      "Tool call rejected"
    );

    return failure(
      callId,
      new ApiError(
        "INVALID_REQUEST",
        "The conversation was not found",
        400,
        false
      )
    );
  }

  if (owned.realtimeSessionId) {
    logContext.realtimeSessionId = owned.realtimeSessionId;
  }
}

export async function dispatchTool(
  request: ToolCallRequest,
  context: ToolExecutionContext
): Promise<ToolResponse> {
  const logContext: Record<string, unknown> = {
    callId: request.callId,
    requestId: context.requestId,
    toolName: request.tool,
    userId: context.user.id,
    ...(request.conversationId
      ? { conversationId: request.conversationId }
      : {}),
  };

  const argumentKeys =
    request.arguments &&
    typeof request.arguments === "object" &&
    !Array.isArray(request.arguments)
      ? Object.keys(request.arguments).sort()
      : [];

  context.logger.info({ ...logContext, argumentKeys }, "Tool call received");

  const replayed = await replayedToolCall(request, context, logContext);

  if (replayed) {
    return replayed;
  }

  const tool = toolRegistry.get(request.tool);

  if (!tool) {
    context.logger.info(
      { ...logContext, errorCode: "UNKNOWN_TOOL", status: "rejected" },
      "Tool call rejected"
    );

    return failure(
      request.callId,
      new ApiError("UNKNOWN_TOOL", "The requested tool does not exist", 404)
    );
  }

  const missingPermission = tool.permissions.find(
    (permission) => !context.user.permissions.has(permission)
  );

  if (missingPermission) {
    context.logger.info(
      { ...logContext, errorCode: "PERMISSION_DENIED", status: "rejected" },
      "Tool call rejected"
    );

    return failure(
      request.callId,
      new ApiError(
        "PERMISSION_DENIED",
        "You do not have permission to use this tool",
        403
      )
    );
  }

  const parsed = tool.input.safeParse(request.arguments);

  if (!parsed.success) {
    context.logger.info(
      {
        ...logContext,
        errorCode: "INVALID_TOOL_ARGUMENTS",
        status: "rejected",
      },
      "Tool call rejected"
    );

    return failure(
      request.callId,
      new ApiError(
        "INVALID_TOOL_ARGUMENTS",
        "The tool arguments were invalid",
        400
      )
    );
  }

  const invalidConversation = await validateConversation(
    request.conversationId,
    context,
    logContext,
    request.callId
  );

  if (invalidConversation) {
    return invalidConversation;
  }

  await context.database
    .insert(userProfiles)
    .values({ id: context.user.id })
    .onConflictDoNothing();

  const [audit] = await context.database
    .insert(toolExecutions)
    .values({
      arguments: parsed.data,
      callId: request.callId,
      conversationId: request.conversationId,
      requestId: context.requestId,
      toolName: request.tool,
      userId: context.user.id,
    })
    .onConflictDoNothing()
    .returning({ id: toolExecutions.id });

  if (!audit) {
    context.logger.info(
      { ...logContext, status: "in_progress" },
      "Tool call rejected"
    );

    return failure(
      request.callId,
      new ApiError(
        "TOOL_IN_PROGRESS",
        "This tool call is already being processed",
        409,
        true
      )
    );
  }

  const started = Date.now();
  const timeout = AbortSignal.timeout(15_000);
  const signal = AbortSignal.any([context.signal, timeout]);

  try {
    const result = await tool.execute(parsed.data, { ...context, signal });
    const validated = tool.output ? tool.output.parse(result) : result;

    await context.database
      .update(toolExecutions)
      .set({
        durationMs: Date.now() - started,
        result: validated,
        status: "succeeded",
        updatedAt: new Date(),
      })
      .where(eq(toolExecutions.id, audit.id));

    context.logger.info(
      { ...logContext, durationMs: Date.now() - started, status: "succeeded" },
      "Tool executed"
    );

    return { callId: request.callId, ok: true, result: validated };
  } catch (unknown) {
    let error: ApiError;

    if (timeout.aborted) {
      error = new ApiError(
        "TOOL_TIMEOUT",
        "The tool execution timed out",
        504,
        tool.retry.enabled
      );
    } else if (unknown instanceof z.ZodError) {
      error = new ApiError(
        "TOOL_EXECUTION_FAILED",
        "The tool returned an invalid result",
        500,
        false
      );
    } else {
      error = normalizeError(unknown);
    }

    await context.database
      .update(toolExecutions)
      .set({
        durationMs: Date.now() - started,
        errorCode: error.code,
        retryable: error.retryable,
        status: error.code === "TOOL_TIMEOUT" ? "timed_out" : "failed",
        updatedAt: new Date(),
      })
      .where(eq(toolExecutions.id, audit.id));

    context.logger.error(
      {
        ...logContext,
        durationMs: Date.now() - started,
        errorCode: error.code,
        status: "failed",
      },
      "Tool failed"
    );

    return failure(request.callId, error);
  }
}

const failure = (callId: string, error: ApiError): ToolResponse => ({
  callId,
  error: {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
  },
  ok: false,
});
