import { useCallback, useEffect, useState } from "react";
import "./App.css";
import {
  getAuthStatus,
  getOrCreateSessionId,
  sendChat,
  type ToolEvent,
} from "./api/client";
import { ConnectSwiggy } from "./components/ConnectSwiggy";
import { Conversation, type DisplayMessage } from "./components/Conversation";
import { MicButton } from "./components/MicButton";

function toolEventToDisplay(event: ToolEvent): string {
  const icon =
    event.status === "failed" ? "✗" : event.status === "completed" ? "✓" : "🔍";
  return `${icon} ${event.summary ?? event.tool}`;
}

export default function App() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [micState, setMicState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  const sessionId = getOrCreateSessionId();

  const refreshAuth = useCallback(async () => {
    try {
      const status = await getAuthStatus();
      setConnected(status.connected);
      setExpiresAt(status.expiresAt);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
    const params = new URLSearchParams(window.location.search);
    if (params.has("auth")) {
      window.history.replaceState({}, "", window.location.pathname);
      refreshAuth();
    }
  }, [refreshAuth]);

  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  };

  const appendMessage = (msg: Omit<DisplayMessage, "id">) => {
    setMessages((prev) => [...prev, { ...msg, id: crypto.randomUUID() }]);
  };

  const runChat = async (message: string) => {
    setThinking(true);
    try {
      const result = await sendChat(sessionId, message);

      for (const event of result.toolEvents) {
        if (event.status === "started" || event.status === "failed") {
          appendMessage({ role: "tool", text: toolEventToDisplay(event) });
        }
      }

      appendMessage({
        role: "bolo",
        text: result.reply,
        cart: result.cart,
        order: result.order,
      });
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "AUTH_REQUIRED") {
        setConnected(false);
        showError("Swiggy session expired — please reconnect");
      } else {
        showError(e.message);
      }
    } finally {
      setThinking(false);
    }
  };

  const handleTranscript = async (text: string) => {
    appendMessage({ role: "user", text: `"${text}"` });
    await runChat(text);
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = textInput.trim();
    if (!text || thinking) return;
    setTextInput("");
    appendMessage({ role: "user", text: `"${text}"` });
    await runChat(text);
  };

  const micDisabled = thinking || micState === "transcribing";

  if (connected === null) {
    return (
      <div className="app">
        <header className="header">
          <h1>BOLO</h1>
        </header>
        <div className="connect-gate">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="app">
        <header className="header">
          <h1>BOLO</h1>
        </header>
        <ConnectSwiggy onConnected={refreshAuth} />
        {error && <div className="error-toast">{error}</div>}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>BOLO</h1>
        <div className="header-status connected">
          Swiggy connected
          {expiresAt && (
            <> · expires {new Date(expiresAt).toLocaleDateString()}</>
          )}
        </div>
      </header>

      <Conversation messages={messages} />

      <footer className="footer">
        <form className="text-input-row" onSubmit={handleTextSubmit}>
          <input
            type="text"
            placeholder="Or type a message..."
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            disabled={thinking}
          />
          <button type="submit" disabled={thinking || !textInput.trim()}>
            Send
          </button>
        </form>

        <MicButton
          disabled={micDisabled}
          onTranscript={handleTranscript}
          onError={showError}
          onStateChange={setMicState}
        />
      </footer>

      {error && <div className="error-toast">{error}</div>}
    </div>
  );
}
