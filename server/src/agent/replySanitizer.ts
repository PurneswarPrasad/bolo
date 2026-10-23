const ORDER_PLACED_PATTERNS = [
  /\border (?:has been |was |is )?(?:successfully )?placed\b/i,
  /\bsuccessfully placed\b/i,
  /\bplaced with cash on delivery\b/i,
  /\bplaced with cod\b/i,
  /\byour order for\b/i,
  /\border summary:\s*/i,
  /\*\*order summary:\*\*/i,
  /\border id(?:\s+is)?:\s*\S+/i,
  /\btotal to pay.*cash on delivery\b/i,
];

export function replyClaimsOrderPlaced(text: string): boolean {
  return ORDER_PLACED_PATTERNS.some((pattern) => pattern.test(text));
}

export function stripFalseOrderClaims(text: string): string {
  if (!replyClaimsOrderPlaced(text)) return text.trim();

  const paragraphs = text.split(/\n{2,}/);
  const kept = paragraphs.filter((p) => !ORDER_PLACED_PATTERNS.some((pattern) => pattern.test(p)));

  const cleaned = kept.join("\n\n").trim();
  if (cleaned) return cleaned;

  return "I've updated your cart.";
}

export function appendNotPlacedNotice(text: string): string {
  const base = stripFalseOrderClaims(text);
  return `${base}\n\nYour order has **not** been placed yet. Say "place order" or "yes, place with cash on delivery" when you're ready.`;
}
