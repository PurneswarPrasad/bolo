const API_BASE = "";

export interface AuthStatus {
  connected: boolean;
  expiresAt: number | null;
}

export interface ToolEvent {
  tool: string;
  status: "started" | "completed" | "failed";
  summary?: string;
}

export interface ChatResponse {
  reply: string;
  toolEvents: ToolEvent[];
  cart?: unknown;
  order?: unknown;
}

export interface TranscribeResponse {
  transcript: string;
  language_code: string | null;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = (data as { error?: string }).error ?? res.statusText;
    const code = (data as { code?: string }).code;
    const err = new Error(message) as Error & { code?: string; status?: number };
    err.code = code;
    err.status = res.status;
    throw err;
  }

  return data as T;
}

export function getAuthStatus(): Promise<AuthStatus> {
  return apiFetch<AuthStatus>("/auth/status");
}

export function sendChat(sessionId: string, message: string): Promise<ChatResponse> {
  return apiFetch<ChatResponse>("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });
}

export function transcribeAudio(blob: Blob): Promise<TranscribeResponse> {
  const form = new FormData();
  form.append("audio", blob, "recording.webm");
  return apiFetch<TranscribeResponse>("/api/transcribe", {
    method: "POST",
    body: form,
  });
}

export function getSwiggyLoginUrl(): string {
  return `${API_BASE}/auth/swiggy/login`;
}

export function getOrCreateSessionId(): string {
  const key = "bolo_session_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}
