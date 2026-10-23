import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import { createAuthRoutes } from "./routes/auth.js";
import { createTranscribeRouter } from "./routes/transcribe.js";
import { createChatRouter } from "./routes/chat.js";

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const OAUTH_REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI ?? `http://localhost:${PORT}/oauth/callback`;

const app = express();

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET ?? "bolo-dev-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(
  createAuthRoutes({
    redirectUri: OAUTH_REDIRECT_URI,
    envClientId: process.env.SWIGGY_CLIENT_ID,
    clientOrigin: CLIENT_ORIGIN,
  })
);

app.use("/api/transcribe", createTranscribeRouter(process.env.SARVAM_API_KEY ?? ""));
app.use("/api/chat", createChatRouter({ geminiApiKey: process.env.GEMINI_API_KEY ?? "" }));

app.listen(PORT, () => {
  console.log(`Bolo server listening on http://localhost:${PORT}`);
});
