import { Router, type Request, type Response } from "express";
import { runAgentChat } from "../agent/gemini.js";
import { SwiggyMcpClient, SwiggyMcpError } from "../swiggy/mcpClient.js";
import { getSessionTokens } from "./auth.js";

export function createChatRouter(config: { geminiApiKey: string }): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const { sessionId, message } = req.body as {
      sessionId?: string;
      message?: string;
    };

    if (!sessionId || !message?.trim()) {
      res.status(400).json({ error: "sessionId and message are required" });
      return;
    }

    if (!config.geminiApiKey) {
      res.status(503).json({ error: "GEMINI_API_KEY is not configured" });
      return;
    }

    const tokens = getSessionTokens(req);
    if (!tokens?.accessToken) {
      res.status(401).json({ error: "Connect Swiggy first", code: "AUTH_REQUIRED" });
      return;
    }

    const mcpClient = new SwiggyMcpClient(
      process.env.SWIGGY_MCP_URL ?? "https://mcp.swiggy.com/food",
      () => getSessionTokens(req),
      () => {
        delete req.session.swiggyTokens;
      }
    );

    try {
      const result = await runAgentChat(
        sessionId,
        message.trim(),
        mcpClient,
        config.geminiApiKey
      );
      res.json(result);
    } catch (err) {
      if (err instanceof SwiggyMcpError && err.status === 401) {
        res.status(401).json({ error: err.message, code: "AUTH_REQUIRED" });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    } finally {
      await mcpClient.disconnect();
    }
  });

  return router;
}
