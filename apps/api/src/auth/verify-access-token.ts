import { createRemoteJWKSet, jwtVerify } from "jose";
import { ApiError } from "../errors/api-error.js";
import type { AuthenticatedUser } from "../tools/define-tool.js";

const trailingSlashPattern = /\/$/;

const invalidAccessToken = (cause: unknown) =>
  new ApiError(
    "AUTH_INVALID",
    "The access token is invalid or expired",
    401,
    false,
    { cause }
  );

let cached:
  | { url: string; jwks: ReturnType<typeof createRemoteJWKSet> }
  | undefined;

function issuer() {
  const value = process.env.SUPABASE_URL;

  if (!value) {
    throw new Error("SUPABASE_URL is required");
  }

  return `${value.replace(trailingSlashPattern, "")}/auth/v1`;
}

export async function verifyAccessToken(
  header: string | undefined
): Promise<AuthenticatedUser> {
  if (!header?.startsWith("Bearer ")) {
    throw new ApiError("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const token = header.slice(7);
  const expectedIssuer = issuer();
  const jwksUrl = `${expectedIssuer}/.well-known/jwks.json`;

  cached ??= { jwks: createRemoteJWKSet(new URL(jwksUrl)), url: jwksUrl };

  if (cached.url !== jwksUrl) {
    cached = { jwks: createRemoteJWKSet(new URL(jwksUrl)), url: jwksUrl };
  }

  try {
    const { payload } = await jwtVerify(token, cached.jwks, {
      audience: "authenticated",
      issuer: expectedIssuer,
    });

    if (!payload.sub) {
      throw new Error("Missing subject");
    }

    const metadata = payload.app_metadata as
      | Record<string, unknown>
      | undefined;

    const raw = metadata?.permissions;

    const permissions = new Set(
      Array.isArray(raw)
        ? raw.filter((v): v is string => typeof v === "string")
        : ["tools:read", "tools:write"]
    );

    return { id: payload.sub, permissions };
  } catch (cause) {
    throw invalidAccessToken(cause);
  }
}
