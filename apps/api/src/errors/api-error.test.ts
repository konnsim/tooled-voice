import { describe, expect, it } from "vitest";
import { normalizeError } from "./api-error.js";

describe("normalizeError", () => {
  it("normalizes database failures without leaking SQL details", () => {
    const error = Object.assign(new Error("relation secret_table failed"), {
      code: "08006",
      name: "PostgresError",
    });

    expect(normalizeError(error)).toMatchObject({
      code: "DATABASE_ERROR",
      message: "The database request failed",
      retryable: true,
      status: 503,
    });
  });
});
