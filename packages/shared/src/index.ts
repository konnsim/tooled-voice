import { z } from 'zod';

export const toolCallRequestSchema = z.object({
  callId: z.string().min(1).max(200),
  tool: z.string().min(1).max(100),
  arguments: z.unknown(),
  conversationId: z.uuid().optional(),
});
export type ToolCallRequest = z.infer<typeof toolCallRequestSchema>;

export const apiErrorSchema = z.object({
  code: z.string(), message: z.string(), retryable: z.boolean(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const toolResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), callId: z.string(), result: z.unknown() }),
  z.object({ ok: z.literal(false), callId: z.string(), error: apiErrorSchema }),
]);
export type ToolResponse = z.infer<typeof toolResponseSchema>;

export const conversationItemInputSchema=z.object({
  role:z.enum(['user','assistant','tool']), kind:z.enum(['transcript','tool_call','tool_result']),
  transcript:z.string().max(20_000).optional(), callId:z.string().max(200).optional(), payload:z.unknown().optional(), completed:z.boolean().default(true),
});
export type ConversationItemInput=z.infer<typeof conversationItemInputSchema>;
export const conversationStatusInputSchema=z.object({status:z.enum(['completed','failed'])});

export const connectionStates = ['idle','authenticating','connecting','connected','listening','thinking','speaking','reconnecting','error','disconnected'] as const;
export type ConnectionState = (typeof connectionStates)[number];
