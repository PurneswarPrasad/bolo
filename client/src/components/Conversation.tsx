import { CartSummary } from "./CartSummary";
import { OrderSummary } from "./OrderSummary";

export interface DisplayMessage {
  id: string;
  role: "user" | "bolo" | "tool";
  text: string;
  cart?: unknown;
  order?: unknown;
}

interface ConversationProps {
  messages: DisplayMessage[];
}

export function Conversation({ messages }: ConversationProps) {
  if (messages.length === 0) {
    return (
      <div className="conversation">
        <p style={{ color: "#999", textAlign: "center", marginTop: "2rem" }}>
          Tap the mic and say something like:
          <br />
          <em>&quot;Add two chicken biryanis from Behrouz&quot;</em>
        </p>
      </div>
    );
  }

  return (
    <div className="conversation">
      {messages.map((msg) => {
        if (msg.role === "tool") {
          return (
            <div key={msg.id} className="tool-status">
              {msg.text}
            </div>
          );
        }

        return (
          <div key={msg.id} className="message-block">
            <span className="message-label">{msg.role === "user" ? "You" : "Bolo"}</span>
            <div className={`message-bubble ${msg.role}`}>{msg.text}</div>
            {msg.cart ? <CartSummary cart={msg.cart} /> : null}
            {msg.order ? <OrderSummary order={msg.order} /> : null}
          </div>
        );
      })}
    </div>
  );
}
