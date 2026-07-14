import type { Logger } from "../tools/define-tool.js";

const sensitive = /authorization|token|secret|credential/i;
function sanitize(value: unknown, key = ""): unknown {
  if (sensitive.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitize(nestedValue, nestedKey),
      ])
    );
  }
  return value;
}
export const logger: Logger = {
  error(data, message) {
    console.error(
      JSON.stringify({
        level: "error",
        message,
        ...(sanitize(data) as Record<string, unknown>),
      })
    );
  },
  info(data, message) {
    console.info(
      JSON.stringify({
        level: "info",
        message,
        ...(sanitize(data) as Record<string, unknown>),
      })
    );
  },
};
