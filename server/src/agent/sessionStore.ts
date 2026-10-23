export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

export interface SavedAddress {
  id: string;
  addressLine?: string;
  addressTag?: string;
  addressCategory?: string;
}

export interface AgentSession {
  sessionId: string;
  messages: ChatMessage[];
  addressId?: string;
  addressLabel?: string;
  addressesById?: Record<string, SavedAddress>;
  restaurantId?: string;
  restaurantName?: string;
  lastCartSnapshot?: unknown;
  lastOrderSnapshot?: unknown;
  pendingPlaceOrder?: boolean;
}

const sessions = new Map<string, AgentSession>();

export function getOrCreateSession(sessionId: string): AgentSession {
  let session = sessions.get(sessionId);
  if (!session) {
    session = { sessionId, messages: [] };
    sessions.set(sessionId, session);
  }
  return session;
}

export function appendMessage(sessionId: string, message: ChatMessage): void {
  const session = getOrCreateSession(sessionId);
  session.messages.push(message);
}

export function updateSessionContext(
  sessionId: string,
  patch: Partial<
    Pick<
      AgentSession,
      | "addressId"
      | "addressLabel"
      | "addressesById"
      | "restaurantId"
      | "restaurantName"
      | "lastCartSnapshot"
      | "lastOrderSnapshot"
      | "pendingPlaceOrder"
    >
  >
): void {
  const session = getOrCreateSession(sessionId);
  Object.assign(session, patch);
}

export function getRecentHistory(sessionId: string, limit = 20): ChatMessage[] {
  const session = getOrCreateSession(sessionId);
  return session.messages.slice(-limit);
}
