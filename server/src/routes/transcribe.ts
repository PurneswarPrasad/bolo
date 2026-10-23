import { Router, type Request, type Response } from "express";
import multer from "multer";
import { transcribeAudio } from "../stt/sarvam.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export function createTranscribeRouter(apiKey: string): Router {
  const router = Router();

  router.post("/", upload.single("audio"), async (req: Request, res: Response) => {
    if (!apiKey) {
      res.status(503).json({ error: "SARVAM_API_KEY is not configured" });
      return;
    }

    const file = req.file;
    if (!file || file.size === 0) {
      res.status(400).json({ error: "No audio file provided" });
      return;
    }

    try {
      const result = await transcribeAudio(apiKey, file.buffer, file.mimetype);
      if (!result.transcript.trim()) {
        res.status(422).json({ error: "Could not transcribe audio — try speaking again" });
        return;
      }
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("403") ? 403 : 500;
      res.status(status).json({
        error:
          status === 403
            ? "Sarvam API key invalid or missing permissions"
            : `Transcription failed: ${message}`,
      });
    }
  });

  return router;
}
