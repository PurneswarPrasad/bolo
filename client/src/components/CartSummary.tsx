interface CartSummaryProps {
  cart: unknown;
}

interface CartItem {
  name?: string;
  quantity?: number;
  price?: number;
  itemPrice?: number;
  totalPrice?: number;
}

function extractCartData(cart: unknown): {
  items: CartItem[];
  total?: number;
  restaurant?: string;
} {
  if (!cart || typeof cart !== "object") return { items: [] };

  const root = cart as Record<string, unknown>;

  if (typeof root.raw === "string") {
    return parseRawCartText(root.raw);
  }

  const successData = root.success === true ? (root.data as Record<string, unknown>) : root;
  const data = (successData.data ?? successData) as Record<string, unknown>;
  const cartObj = (data.cart ?? data) as Record<string, unknown>;
  const inner = (data.data ?? cartObj) as Record<string, unknown>;

  const billDetails = data.billDetails as Record<string, unknown> | undefined;
  const pricing = (inner.pricing ?? cartObj.pricing ?? data.pricing) as
    | Record<string, unknown>
    | undefined;
  const itemsRaw =
    (cartObj.items as CartItem[]) ??
    (cartObj.cartItems as CartItem[]) ??
    (data.items as CartItem[]) ??
    (data.lineItems as CartItem[]) ??
    [];

  const total =
    (billDetails?.total as number) ??
    (pricing?.to_pay as number) ??
    (cartObj.total as number) ??
    (cartObj.cartTotal as number) ??
    (data.total as number) ??
    (data.cartTotal as number) ??
    (data.paymentAmount as number);

  return { items: itemsRaw, total };
}

function parseRawCartText(text: string): {
  items: CartItem[];
  total?: number;
  restaurant?: string;
} {
  const items: CartItem[] = [];
  let total: number | undefined;
  let restaurant: string | undefined;

  const restaurantMatch = text.match(/^Restaurant:\s*(.+)$/m);
  if (restaurantMatch) restaurant = restaurantMatch[1].trim();

  const itemLines = text.match(/^\s*-\s*(.+?) — ₹(\d+)/gm);
  if (itemLines) {
    for (const line of itemLines) {
      const match = line.match(/^\s*-\s*(.+?) — ₹(\d+)/);
      if (match) {
        items.push({ name: match[1].trim(), price: Number(match[2]), quantity: 1 });
      }
    }
  }

  const payMatch = text.match(/TO PAY:\s*₹(\d+(?:\.\d+)?)/i);
  if (payMatch) total = Number(payMatch[1]);

  return { items, total, restaurant };
}

function formatPrice(amount: number | undefined): string {
  if (amount == null) return "";
  return `₹${Math.round(amount)}`;
}

export function CartSummary({ cart }: CartSummaryProps) {
  const { items, total, restaurant } = extractCartData(cart);
  if (items.length === 0) return null;

  return (
    <div className="cart-summary">
      <div>Your Cart{restaurant ? ` — ${restaurant}` : ""}</div>
      <div>{"─".repeat(24)}</div>
      {items.map((item, i) => {
        const qty = item.quantity ?? 1;
        const name = item.name ?? "Item";
        const price = item.totalPrice ?? item.price ?? item.itemPrice;
        return (
          <div key={i}>
            {qty} × {name}
            {" ".repeat(Math.max(1, 20 - name.length))}
            {formatPrice(price)}
          </div>
        );
      })}
      {total != null && (
        <>
          <div>{"─".repeat(24)}</div>
          <div>
            Total
            {" ".repeat(14)}
            {formatPrice(total)}
          </div>
        </>
      )}
    </div>
  );
}
