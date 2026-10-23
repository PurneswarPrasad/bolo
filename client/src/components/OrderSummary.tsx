interface OrderSummaryProps {
  order: unknown;
}

interface OrderData {
  orderId?: string | null;
  status?: string;
  totalAmount?: number | string | null;
  restaurantName?: string | null;
  estimatedDelivery?: string | null;
  deliveryAddress?: string | null;
}

function extractOrderData(order: unknown): OrderData {
  if (!order || typeof order !== "object") return {};
  const root = order as Record<string, unknown>;
  if (root.success === true && root.data && typeof root.data === "object") {
    return root.data as OrderData;
  }
  return root as OrderData;
}

function formatAmount(amount: number | string | null | undefined): string {
  if (amount == null || amount === "") return "";
  return `₹${Math.round(Number(amount))}`;
}

export function OrderSummary({ order }: OrderSummaryProps) {
  const data = extractOrderData(order);
  if (!data.orderId && data.status !== "CONFIRMED") return null;

  return (
    <div className="order-summary">
      <div>Order Placed — Cash on Delivery</div>
      <div>{"─".repeat(24)}</div>
      {data.orderId ? <div>Order ID: {data.orderId}</div> : null}
      {data.restaurantName ? <div>{data.restaurantName}</div> : null}
      {data.totalAmount != null ? <div>Total: {formatAmount(data.totalAmount)}</div> : null}
      {data.estimatedDelivery ? (
        <div>ETA: {data.estimatedDelivery}</div>
      ) : null}
      {data.deliveryAddress ? <div>Deliver to: {data.deliveryAddress}</div> : null}
    </div>
  );
}
