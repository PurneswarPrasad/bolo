import { Router, type Request, type Response } from "express";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  generatePkce,
  getOrRegisterClientId,
  type OAuthTokens,
} from "../swiggy/oauth.js";

declare module "express-session" {
  interface SessionData {
    pkce?: { codeVerifier: string; state: string };
    swiggyTokens?: OAuthTokens;
    swiggyClientId?: string;
  }
}

export function createAuthRoutes(config: {
  redirectUri: string;
  envClientId?: string;
  clientOrigin: string;
}): Router {
  const router = Router();

  router.get("/auth/swiggy/login", async (req: Request, res: Response) => {
    try {
      const clientId = await getOrRegisterClientId(
        config.redirectUri,
        config.envClientId ?? req.session.swiggyClientId
      );
      req.session.swiggyClientId = clientId;

      const pkce = generatePkce();
      req.session.pkce = {
        codeVerifier: pkce.codeVerifier,
        state: pkce.state,
      };

      const url = buildAuthorizeUrl(clientId, config.redirectUri, pkce);
      res.redirect(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.get("/oauth/callback", async (req: Request, res: Response) => {
    const { code, state, error } = req.query;

    if (error) {
      res.redirect(`${config.clientOrigin}?auth=error&reason=${encodeURIComponent(String(error))}`);
      return;
    }

    if (!code || typeof code !== "string") {
      res.status(400).send("Missing authorization code");
      return;
    }

    if (!req.session.pkce || state !== req.session.pkce.state) {
      res.status(400).send("Invalid OAuth state");
      return;
    }

    try {
      const tokens = await exchangeCodeForToken(
        code,
        req.session.pkce.codeVerifier,
        config.redirectUri
      );
      req.session.swiggyTokens = tokens;
      delete req.session.pkce;
      res.redirect(`${config.clientOrigin}?auth=success`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.redirect(`${config.clientOrigin}?auth=error&reason=${encodeURIComponent(message)}`);
    }
  });

  router.get("/auth/status", (req: Request, res: Response) => {
    const tokens = req.session.swiggyTokens;
    res.json({
      connected: Boolean(tokens?.accessToken),
      expiresAt: tokens?.expiresAt ?? null,
    });
  });

  router.post("/auth/logout", (req: Request, res: Response) => {
    delete req.session.swiggyTokens;
    res.json({ connected: false });
  });

  return router;
}

export function getSessionTokens(req: Request): OAuthTokens | undefined {
  return req.session.swiggyTokens;
}
