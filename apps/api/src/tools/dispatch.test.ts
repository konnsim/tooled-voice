import { describe, expect, it, vi } from "vitest";
import { toolExecutions, userProfiles } from "../database/schema.js";
import type { ToolExecutionContext } from "./define-tool.js";
import { dispatchTool } from "./dispatch.js";

function context(
  options: {
    permissions?: string[];
    existing?: Array<{ status: string; result?: unknown }>;
  } = {}
): ToolExecutionContext {
  const database = {
    insert: (table: unknown) => ({
      values: () =>
        table === userProfiles
          ? { onConflictDoNothing: async () => undefined }
          : {
              onConflictDoNothing: () => ({
                returning: async () => [{ id: "audit-1" }],
              }),
            },
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => options.existing ?? [] }),
      }),
    }),
    update: (table: unknown) => {
      if (table !== toolExecutions)
        throw new Error("Expected the tool executions table to be updated");
      return { set: () => ({ where: async () => undefined }) };
    },
  };
  return {
    database: database as never,
    logger: { error: vi.fn(), info: vi.fn() },
    requestId: "request-1",
    signal: AbortSignal.timeout(1000),
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      permissions: new Set(options.permissions ?? ["tools:read"]),
    },
  };
}

describe("dispatchTool", () => {
  const request = {
    arguments: { timezone: "Australia/Sydney" },
    callId: "call-1",
    tool: "getCurrentTime",
  } as const;
  it("executes a registered local tool", async () => {
    await expect(dispatchTool(request, context())).resolves.toMatchObject({
      ok: true,
      result: { timezone: "Australia/Sydney" },
    });
  });
  it("validates permissions and arguments", async () => {
    await expect(
      dispatchTool(request, context({ permissions: [] }))
    ).resolves.toMatchObject({
      error: { code: "PERMISSION_DENIED" },
      ok: false,
    });
    await expect(
      dispatchTool(
        { ...request, arguments: { timezone: "invalid" } },
        context()
      )
    ).resolves.toMatchObject({
      error: { code: "INVALID_TOOL_ARGUMENTS" },
      ok: false,
    });
  });
  it("rejects unknown tools", async () => {
    await expect(
      dispatchTool(
        { arguments: {}, callId: "unknown", tool: "doesNotExist" },
        context()
      )
    ).resolves.toMatchObject({ error: { code: "UNKNOWN_TOOL" }, ok: false });
  });
  it("returns a persisted result for duplicate delivery", async () => {
    await expect(
      dispatchTool(
        request,
        context({
          existing: [
            {
              result: { iso: "cached", timezone: "Australia/Sydney" },
              status: "succeeded",
            },
          ],
        })
      )
    ).resolves.toEqual({
      callId: "call-1",
      ok: true,
      result: { iso: "cached", timezone: "Australia/Sydney" },
    });
  });
});
