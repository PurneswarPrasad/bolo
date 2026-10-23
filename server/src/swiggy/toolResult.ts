export interface ParsedToolResult {
  ok: boolean;
  data: unknown;
  text: string;
  error?: string;
}

function extractText(result: unknown): string {
  if (!result || typeof result !== "object") return JSON.stringify(result);
  const r = result as { content?: Array<{ type?: string; text?: string }> };
  if (Array.isArray(r.content)) {
    return r.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");
  }
  return JSON.stringify(result);
}

export function parseMcpToolResult(result: unknown): ParsedToolResult {
  if (!result || typeof result !== "object") {
    return { ok: false, data: null, text: "", error: "Empty tool result" };
  }

  const r = result as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content?: Array<{ type?: string; text?: string }>;
  };

  const text = extractText(result);

  if (r.isError) {
    return { ok: false, data: { raw: text }, text, error: text || "Tool returned an error" };
  }

  if (r.structuredContent && typeof r.structuredContent === "object") {
    const sc = r.structuredContent;
    if (sc.success === false) {
      const err =
        (sc.error as { message?: string } | undefined)?.message ?? "Swiggy tool failed";
      return { ok: false, data: sc, text, error: err };
    }
    return { ok: true, data: sc, text };
  }

  if (text) {
    try {
      const parsed = JSON.parse(text) as {
        success?: boolean;
        error?: { message?: string };
      };
      if (parsed.success === false) {
        return {
          ok: false,
          data: parsed,
          text,
          error: parsed.error?.message ?? "Swiggy tool failed",
        };
      }
      return { ok: true, data: parsed, text };
    } catch {
      return { ok: true, data: { raw: text }, text };
    }
  }

  return { ok: true, data: result, text };
}
