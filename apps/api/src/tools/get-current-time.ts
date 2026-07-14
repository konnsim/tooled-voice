import { z } from "zod";
import { defineTool } from "./define-tool.js";
export const getCurrentTime = defineTool({
  description: "Get the current date and time in a specified IANA timezone.",
  execute({ timezone }) {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("sv-SE", {
      dateStyle: "short",
      hourCycle: "h23",
      timeStyle: "medium",
      timeZone: timezone,
    })
      .format(now)
      .replace(" ", "T");
    const offset =
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        timeZoneName: "longOffset",
      })
        .formatToParts(now)
        .find((p) => p.type === "timeZoneName")
        ?.value.replace("GMT", "") || "Z";
    return Promise.resolve({
      iso: `${parts}${offset === "Z" ? "Z" : offset}`,
      timezone,
    });
  },
  input: z.object({
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v }).resolvedOptions();
        return true;
      } catch {
        return false;
      }
    }, "Invalid IANA timezone"),
  }),
  name: "getCurrentTime",
  output: z.object({ iso: z.string(), timezone: z.string() }),
  permissions: ["tools:read"],
  retry: { enabled: false },
});
