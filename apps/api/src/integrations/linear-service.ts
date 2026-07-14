import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../database/client.js";
import {
  integrationAccounts,
  integrationOauthStates,
  userProfiles,
} from "../database/schema.js";
import { ApiError } from "../errors/api-error.js";
import {
  IntegrationStore,
  type LinearCredentials,
} from "./integration-store.js";
import {
  LinearApi,
  type LinearOAuthConfig,
  type LinearTokenResponse,
} from "./linear-api.js";

const provider = "linear";
const stateLifetimeMs = 10 * 60 * 1000;
const refreshLeewayMs = 2 * 60 * 1000;
const scopeSeparatorPattern = /[ ,]+/;
const refreshes = new Map<string, Promise<LinearCredentials>>();
export type LinearApprovalPolicy = "ask" | "automatic";

export class LinearService {
  private readonly api: LinearApi;
  private readonly database: Database;
  private readonly store: IntegrationStore;
  constructor(
    database: Database,
    api = new LinearApi(),
    store?: IntegrationStore
  ) {
    this.api = api;
    this.database = database;
    this.store = store ?? new IntegrationStore(database);
  }
  async createAuthorization(
    userId: string
  ): Promise<{ authorizationUrl: string }> {
    const config = oauthConfig();
    const redirectUri = linearRedirectUri();
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    await this.database
      .insert(userProfiles)
      .values({ id: userId })
      .onConflictDoNothing();
    await this.database
      .delete(integrationOauthStates)
      .where(
        and(
          eq(integrationOauthStates.userId, userId),
          eq(integrationOauthStates.provider, provider)
        )
      );
    await this.database.insert(integrationOauthStates).values({
      codeVerifier,
      expiresAt: new Date(Date.now() + stateLifetimeMs),
      provider,
      redirectUri,
      stateHash: hashState(state),
      userId,
    });
    const url = new URL("https://linear.app/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "read,write",
      state,
    }).toString();
    return { authorizationUrl: url.toString() };
  }
  async completeAuthorization(
    code: string,
    state: string,
    signal: AbortSignal
  ): Promise<void> {
    const [oauthState] = await this.database
      .update(integrationOauthStates)
      .set({ consumedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(integrationOauthStates.provider, provider),
          eq(integrationOauthStates.stateHash, hashState(state)),
          isNull(integrationOauthStates.consumedAt),
          gt(integrationOauthStates.expiresAt, new Date())
        )
      )
      .returning({
        codeVerifier: integrationOauthStates.codeVerifier,
        redirectUri: integrationOauthStates.redirectUri,
        userId: integrationOauthStates.userId,
      });
    if (!oauthState) {
      throw new ApiError(
        "OAUTH_INVALID_STATE",
        "The Linear authorization request is invalid or expired",
        400,
        false
      );
    }
    const token = await this.api.exchangeCode(
      oauthConfig(),
      {
        code,
        codeVerifier: oauthState.codeVerifier,
        redirectUri: oauthState.redirectUri,
      },
      signal
    );
    await this.store.saveLinear(oauthState.userId, toCredentials(token));
  }
  async status(userId: string): Promise<{
    connected: boolean;
    expiresAt?: string;
    scopes: string[];
    approvalPolicy: LinearApprovalPolicy;
  }> {
    const [row] = await this.database
      .select({
        approvalPolicy: integrationAccounts.approvalPolicy,
        expiresAt: integrationAccounts.expiresAt,
        scopes: integrationAccounts.scopes,
      })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.provider, provider)
        )
      )
      .limit(1);
    return row
      ? {
          connected: true,
          ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
          approvalPolicy:
            row.approvalPolicy === "automatic" ? "automatic" : "ask",
          scopes: row.scopes ?? [],
        }
      : { approvalPolicy: "ask", connected: false, scopes: [] };
  }
  async setApprovalPolicy(
    userId: string,
    approvalPolicy: LinearApprovalPolicy
  ): Promise<void> {
    const [updated] = await this.database
      .update(integrationAccounts)
      .set({ approvalPolicy, updatedAt: new Date() })
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.provider, provider)
        )
      )
      .returning({ id: integrationAccounts.id });
    if (!updated) {
      throw new ApiError(
        "INTEGRATION_UNAVAILABLE",
        "Connect Linear before changing permissions",
        409,
        false
      );
    }
  }
  async disconnect(userId: string, signal: AbortSignal): Promise<void> {
    const credentials = await this.store.getLinear(userId);
    if (credentials) {
      await this.api
        .revoke(credentials.accessToken, signal)
        .catch(() => undefined);
    }
    await this.store.deleteLinear(userId);
  }
  async accessToken(
    userId: string,
    signal: AbortSignal
  ): Promise<string | null> {
    const credentials = await this.store.getLinear(userId);
    if (!credentials) {
      return null;
    }
    return (await this.validCredentials(userId, signal, credentials))
      .accessToken;
  }
  async sessionConnection(
    userId: string,
    signal: AbortSignal
  ): Promise<{
    accessToken: string;
    approvalPolicy: LinearApprovalPolicy;
  } | null> {
    const accessToken = await this.accessToken(userId, signal);
    if (!accessToken) {
      return null;
    }
    const status = await this.status(userId);
    return { accessToken, approvalPolicy: status.approvalPolicy };
  }
  private validCredentials(
    userId: string,
    signal: AbortSignal,
    credentials: LinearCredentials
  ): Promise<LinearCredentials> {
    if (
      !credentials.expiresAt ||
      new Date(credentials.expiresAt).getTime() - Date.now() > refreshLeewayMs
    ) {
      return Promise.resolve(credentials);
    }
    if (!credentials.refreshToken) {
      throw new ApiError(
        "INTEGRATION_AUTH_EXPIRED",
        "Reconnect Linear to continue",
        401,
        false
      );
    }
    const active = refreshes.get(userId);
    if (active) {
      return active;
    }
    const refresh = this.api
      .refreshToken(oauthConfig(), credentials.refreshToken, signal)
      .then((token) => {
        const next = toCredentials(token, credentials.refreshToken);
        return this.store.saveLinear(userId, next).then(() => next);
      })
      .finally(() => refreshes.delete(userId));
    refreshes.set(userId, refresh);
    return refresh;
  }
}

export const linearMobileRedirectUri = () =>
  process.env.LINEAR_MOBILE_REDIRECT_URI ?? "tooledvoice://integrations/linear";

function oauthConfig(): LinearOAuthConfig {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;
  if (!(clientId && clientSecret)) {
    throw new ApiError(
      "INTEGRATION_UNAVAILABLE",
      "Linear OAuth is not configured",
      503,
      false
    );
  }
  return { clientId, clientSecret };
}
function linearRedirectUri(): string {
  const value = process.env.LINEAR_REDIRECT_URI;
  if (!value) {
    throw new ApiError(
      "INTEGRATION_UNAVAILABLE",
      "LINEAR_REDIRECT_URI is not configured",
      503,
      false
    );
  }
  return value;
}
function hashState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}
function toCredentials(
  token: LinearTokenResponse,
  fallbackRefreshToken?: string
): LinearCredentials {
  return {
    accessToken: token.access_token,
    ...(token.refresh_token || fallbackRefreshToken
      ? { refreshToken: token.refresh_token ?? fallbackRefreshToken }
      : {}),
    scope: token.scope.split(scopeSeparatorPattern).filter(Boolean),
    tokenType: token.token_type,
    ...(token.expires_in
      ? {
          expiresAt: new Date(
            Date.now() + token.expires_in * 1000
          ).toISOString(),
        }
      : {}),
  };
}
