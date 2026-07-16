import { z } from "zod";

export const toolCallRequestSchema = z.object({
  arguments: z.unknown(),
  callId: z.string().min(1).max(200),
  conversationId: z.uuid().optional(),
  tool: z.string().min(1).max(100),
});

export type ToolCallRequest = z.infer<typeof toolCallRequestSchema>;

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const toolResponseSchema = z.discriminatedUnion("ok", [
  z.object({ callId: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ callId: z.string(), error: apiErrorSchema, ok: z.literal(false) }),
]);

export type ToolResponse = z.infer<typeof toolResponseSchema>;

export const conversationItemInputSchema = z.object({
  callId: z.string().max(200).optional(),
  completed: z.boolean().default(true),
  kind: z.enum(["transcript", "tool_call", "tool_result"]),
  payload: z.unknown().optional(),
  role: z.enum(["user", "assistant", "tool"]),
  transcript: z.string().max(20_000).optional(),
});

export type ConversationItemInput = z.infer<typeof conversationItemInputSchema>;

export const conversationStatusInputSchema = z.object({
  status: z.enum(["completed", "failed"]),
});

export const connectionStates = [
  "idle",
  "authenticating",
  "connecting",
  "connected",
  "listening",
  "thinking",
  "speaking",
  "reconnecting",
  "error",
  "disconnected",
] as const;

export type ConnectionState = (typeof connectionStates)[number];
