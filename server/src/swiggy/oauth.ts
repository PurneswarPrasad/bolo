import crypto from "node:crypto";

const SWIGGY_BASE = "https://mcp.swiggy.com";

export interface OAuthTokens {
  accessToken: string;
  expiresAt: number;
  scope?: string;
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

export function generatePkce(): PkcePair {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const state = crypto.randomBytes(16).toString("base64url");
  return { codeVerifier, codeChallenge, state };
}

export async function registerClient(redirectUri: string): Promise<string> {
  const response = await fetch(`${SWIGGY_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "bolo-mvp",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DCR failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { client_id: string };
  return data.client_id;
}

export function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  pkce: PkcePair
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: "S256",
    state: pkce.state,
    scope: "mcp:tools",
  });
  return `${SWIGGY_BASE}/auth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<OAuthTokens> {
  const response = await fetch(`${SWIGGY_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
  };

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
}

export function isTokenExpired(tokens: OAuthTokens | undefined): boolean {
  if (!tokens) return true;
  return Date.now() >= tokens.expiresAt - 60_000;
}

export async function getOrRegisterClientId(
  redirectUri: string,
  envClientId?: string
): Promise<string> {
  if (envClientId) return envClientId;
  return registerClient(redirectUri);
}
