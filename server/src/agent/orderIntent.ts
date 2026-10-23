import type { ChatMessage } from "./sessionStore.js";

const ORDER_KEYWORDS =
  /\b(order|buy|purchase|checkout|deliver(?:y|ed)?|place(?:\s+the|\s+an?\s+order|\s+order\s+now)?|finalize|get\s+me)\b/i;

const NEGATIVE_OVERRIDES =
  /\b(cart\s+only|don't\s+place|do\s+not\s+place|just\s+add|what'?s?\s+in\s+my\s+cart|show\s+(?:my\s+)?cart|make\s+that|remove|clear|delete|flush|change\s+this|change\s+to)\b/i;

const CONFIRM_ONLY =
  /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|confirm|proceed|go\s+ahead|do\s+it|please|place\s+it)\.?!?$/i;

const MODEL_PLACE_PROMPT =
  /\b(?:would you like (?:me )?to place|shall i place|want me to place|ready to place|place (?:the )?order now|finalize (?:and )?place|place this order|place with cash on delivery)\b/i;

export function hasOrderIntent(
  message: string,
  history: ChatMessage[] = [],
  pendingPlaceOrder = false
): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (NEGATIVE_OVERRIDES.test(trimmed)) return false;

  if (ORDER_KEYWORDS.test(trimmed)) return true;

  if (
    CONFIRM_ONLY.test(trimmed) &&
    (pendingPlaceOrder || modelRecentlyAskedToPlace(history))
  ) {
    return true;
  }

  return false;
}

function modelRecentlyAskedToPlace(history: ChatMessage[]): boolean {
  const recent = history.slice(-6);
  for (let i = recent.length - 1; i >= 0; i--) {
    const msg = recent[i];
    if (msg.role === "user") continue;
    if (msg.role === "model") {
      return MODEL_PLACE_PROMPT.test(msg.text);
    }
  }
  return false;
}

export function modelOfferedToPlace(text: string): boolean {
  return MODEL_PLACE_PROMPT.test(text);
}
