import { SarvamAIClient } from "sarvamai";
import { Readable } from "node:stream";

export interface TranscribeResult {
  transcript: string;
  language_code: string | null;
}

export async function transcribeAudio(
  apiKey: string,
  buffer: Buffer,
  mimeType: string
): Promise<TranscribeResult> {
  const client = new SarvamAIClient({ apiSubscriptionKey: apiKey });
  const stream = Readable.from(buffer);

  const response = await client.speechToText.transcribe({
    file: stream,
    model: "saaras:v3",
    mode: "transcribe",
  });

  return {
    transcript: response.transcript ?? "",
    language_code: response.language_code ?? null,
  };
}
