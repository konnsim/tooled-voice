import type { z } from 'zod';
import type { Database } from '../database/client.js';
export interface AuthenticatedUser { id: string; permissions: ReadonlySet<string> }
export interface Logger { info(data: Record<string, unknown>, message: string): void; error(data: Record<string, unknown>, message: string): void }
export interface ToolExecutionContext { user: AuthenticatedUser; requestId: string; database: Database; integrations: Record<string, unknown>; logger: Logger; signal: AbortSignal }
export interface ToolDefinition<I extends z.ZodType, O extends z.ZodType | undefined = undefined> { name: string; description: string; input: I; output?: O; permissions: readonly string[]; retry: { enabled: boolean }; execute(input: z.output<I>, context: ToolExecutionContext): Promise<unknown> }
export const defineTool = <I extends z.ZodType, O extends z.ZodType | undefined = undefined>(tool: ToolDefinition<I,O>) => tool;
