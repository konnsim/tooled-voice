import type { z } from "zod";
import type { Database } from "../database/client.js";

export interface AuthenticatedUser {
  id: string;
  permissions: ReadonlySet<string>;
}

export interface Logger {
  error: (data: Record<string, unknown>, message: string) => void;
  info: (data: Record<string, unknown>, message: string) => void;
}

export interface ToolExecutionContext {
  database: Database;
  logger: Logger;
  requestId: string;
  signal: AbortSignal;
  user: AuthenticatedUser;
}

export interface ToolDefinition<
  I extends z.ZodType,
  O extends z.ZodType | undefined = undefined,
> {
  description: string;
  execute: (
    input: z.output<I>,
    context: ToolExecutionContext
  ) => Promise<unknown>;
  input: I;
  name: string;
  output?: O;
  permissions: readonly string[];
  retry: { enabled: boolean };
}

export interface RegisteredToolDefinition {
  description: string;
  execute: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
  input: z.ZodType;
  name: string;
  output?: z.ZodType;
  permissions: readonly string[];
  retry: { enabled: boolean };
}

export const defineTool = <
  I extends z.ZodType,
  O extends z.ZodType | undefined = undefined,
>(
  tool: ToolDefinition<I, O>
) => tool;
