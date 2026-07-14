import { z } from "zod";
import { ApiError } from "../errors/api-error.js";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().default(""),
  token_type: z.string().default("Bearer"),
});
const providerUnavailable = (cause: unknown) =>
  new ApiError(
    "PROVIDER_UNAVAILABLE",
    "The Linear API could not be reached",
    502,
    true,
    { cause }
  );
export type LinearTokenResponse = z.infer<typeof tokenResponseSchema>;

export interface LinearOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export class LinearApi {
  private readonly fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }
  exchangeCode(
    config: LinearOAuthConfig,
    input: { code: string; codeVerifier: string; redirectUri: string },
    signal: AbortSignal
  ) {
    return this.token(
      config,
      {
        code: input.code,
        code_verifier: input.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
      },
      signal
    );
  }
  refreshToken(
    config: LinearOAuthConfig,
    refreshToken: string,
    signal: AbortSignal
  ) {
    return this.token(
      config,
      { grant_type: "refresh_token", refresh_token: refreshToken },
      signal
    );
  }
  async revoke(token: string, signal: AbortSignal): Promise<void> {
    const response = await this.request("https://api.linear.app/oauth/revoke", {
      body: new URLSearchParams({ token }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal,
    });
    if (!response.ok && response.status !== 401) {
      throw providerHttpError(
        response.status,
        "Unable to revoke the Linear credential"
      );
    }
  }
  private async token(
    config: LinearOAuthConfig,
    parameters: Record<string, string>,
    signal: AbortSignal
  ): Promise<LinearTokenResponse> {
    const response = await this.request("https://api.linear.app/oauth/token", {
      body: new URLSearchParams({
        ...parameters,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal,
    });
    if (!response.ok) {
      throw new ApiError(
        "OAUTH_EXCHANGE_FAILED",
        "Linear rejected the OAuth token request",
        502,
        response.status >= 500
      );
    }
    return tokenResponseSchema.parse(await response.json());
  }
  private async request(input: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(input, init);
    } catch (error) {
      if (init.signal?.aborted) {
        throw error;
      }
      throw providerUnavailable(error);
    }
  }
}

function providerHttpError(status: number, message: string): ApiError {
  if (status === 401 || status === 403) {
    return new ApiError(
      "INTEGRATION_AUTH_EXPIRED",
      "The Linear connection has expired",
      401,
      false
    );
  }
  if (status === 429) {
    return new ApiError(
      "PROVIDER_RATE_LIMITED",
      "Linear rate limited the request",
      429,
      true
    );
  }
  return new ApiError("PROVIDER_UNAVAILABLE", message, 502, status >= 500);
}
