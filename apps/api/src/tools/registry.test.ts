import { toolCallRequestSchema } from "@tooled-voice/shared";
import { describe, expect, it } from "vitest";
import { getCurrentTime } from "./get-current-time.js";
import { realtimeTools, toolRegistry } from "./registry.js";

describe("tool registry", () => {
  it("registers local tools without a switch and exposes JSON schema", () => {
    expect(toolRegistry.get("getCurrentTime")).toBe(getCurrentTime);
    expect(realtimeTools).toHaveLength(1);
    expect(realtimeTools[0]?.parameters).toMatchObject({ type: "object" });
  });
  it("validates request envelopes and tool arguments", () => {
    expect(
      toolCallRequestSchema.safeParse({
        arguments: { timezone: "Australia/Sydney" },
        callId: "c1",
        tool: "getCurrentTime",
      }).success
    ).toBe(true);
    expect(
      getCurrentTime.input.safeParse({ timezone: "Not/AZone" }).success
    ).toBe(false);
  });
  it("executes the real timezone tool", async () => {
    const { output } = getCurrentTime;
    if (!output) throw new Error("Expected the timezone tool output schema");
    const result = output.parse(
      await getCurrentTime.execute(
        { timezone: "Australia/Sydney" },
        {} as never
      )
    );
    expect(result).toMatchObject({ timezone: "Australia/Sydney" });
    expect(Date.parse(result.iso)).not.toBeNaN();
  });
});
