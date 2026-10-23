import type { SwiggyMcpClient } from "./mcpClient.js";
import { parseMcpToolResult } from "./toolResult.js";

export interface CheckoutToolEvent {
  tool: string;
  status: "started" | "completed" | "failed";
  summary?: string;
}

export interface CheckoutOrder {
  orderId: string | null;
  status: string;
  totalAmount?: number | string | null;
  restaurantName?: string | null;
  estimatedDelivery?: string | null;
  deliveryAddress?: string | null;
  recoveredFromHistory?: boolean;
}

export interface CheckoutResult {
  ok: boolean;
  ambiguous?: boolean;
  couponApplied?: string;
  couponDiscount?: number;
  cart?: unknown;
  order?: CheckoutOrder;
  error?: string;
}

interface CouponCandidate {
  code: string;
  estimatedDiscount: number;
  title?: string;
}

interface OrderRecoveryHints {
  restaurantName?: string;
  totalAmount?: number | string | null;
}

function unwrapData(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== "object") return {};
  const root = parsed as Record<string, unknown>;
  if (root.success === true && root.data && typeof root.data === "object") {
    return root.data as Record<string, unknown>;
  }
  if (root.data && typeof root.data === "object") {
    return root.data as Record<string, unknown>;
  }
  return root;
}

function coalesceOrderId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return null;
}

function extractOrderIdFromText(text: string): string | null {
  const patterns = [
    /order\s*id[:\s#-]*([A-Za-z0-9-]{6,})/i,
    /order\s*#\s*([A-Za-z0-9-]{6,})/i,
    /"orderId"\s*:\s*"([^"]+)"/i,
    /"order_id"\s*:\s*"([^"]+)"/i,
    /orderId[:\s]+([A-Za-z0-9-]{6,})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function findOrderPayload(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 5 || node == null) return null;

  if (typeof node === "string") {
    const orderId = extractOrderIdFromText(node);
    return orderId ? { orderId, status: "CONFIRMED" } : null;
  }

  if (typeof node !== "object") return null;

  const record = node as Record<string, unknown>;

  if (coalesceOrderId(record.orderId) || coalesceOrderId(record.order_id)) {
    return record;
  }

  if (typeof record.raw === "string") {
    const fromRaw = findOrderPayload(record.raw, depth + 1);
    if (fromRaw) return fromRaw;
  }

  for (const key of ["data", "structuredContent", "result", "message"]) {
    const nested = findOrderPayload(record[key], depth + 1);
    if (nested) return nested;
  }

  return null;
}

function logPlaceOrderResponse(parsed: ReturnType<typeof parseMcpToolResult>): void {
  const preview = parsed.text.slice(0, 2000);
  console.info("[bolo] place_food_order response", {
    ok: parsed.ok,
    preview,
    dataKeys:
      parsed.data && typeof parsed.data === "object"
        ? Object.keys(parsed.data as Record<string, unknown>)
        : [],
  });
}

function parseRupeeAmount(text: string): number {
  const matches = text.match(/₹\s*(\d+(?:\.\d+)?)/g);
  if (!matches?.length) return 0;
  return Math.max(
    ...matches.map((m) => {
      const num = m.match(/(\d+(?:\.\d+)?)/);
      return num ? Number(num[1]) : 0;
    })
  );
}

function isApplicableCoupon(coupon: Record<string, unknown>): boolean {
  if (coupon.applicabilityStatus === "APPLICABLE") return true;
  if (coupon.applicabilityStatus === "NOT_APPLICABLE") return false;
  return coupon.applicable === true;
}

function extractCouponCode(coupon: Record<string, unknown>): string | null {
  const id = coupon.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  const title = typeof coupon.title === "string" ? coupon.title : "";
  const codeMatch = title.match(/\b([A-Z0-9]{4,20})\b/);
  return codeMatch?.[1] ?? null;
}

export function pickBestCodCoupon(couponsData: unknown): CouponCandidate | null {
  const data = unwrapData(couponsData);
  const sections = (data.coupon_sections ?? []) as Array<Record<string, unknown>>;

  const candidates: CouponCandidate[] = [];

  for (const section of sections) {
    const sectionType = String(section.type ?? "").toLowerCase();
    const sectionTitle = String(section.title ?? "").toLowerCase();
    const isOnlineOnly =
      sectionType.includes("online") ||
      sectionTitle.includes("online payment") ||
      sectionTitle.includes("card only");

    if (isOnlineOnly) continue;

    const coupons = (section.coupons ?? []) as Array<Record<string, unknown>>;
    for (const coupon of coupons) {
      if (!isApplicableCoupon(coupon)) continue;
      const code = extractCouponCode(coupon);
      if (!code) continue;

      const text = [coupon.title, coupon.subtitle, coupon.description]
        .filter((v) => typeof v === "string")
        .join(" ");

      candidates.push({
        code,
        estimatedDiscount: parseRupeeAmount(text),
        title: typeof coupon.title === "string" ? coupon.title : undefined,
      });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.estimatedDiscount - a.estimatedDiscount);
  return candidates[0];
}

function extractCouponDiscount(applyData: unknown): {
  code?: string;
  discount: number;
} {
  const data = unwrapData(applyData);
  const inner = (data.data ?? data) as Record<string, unknown>;
  const offers = (inner.offers ?? data.offers) as Record<string, unknown> | undefined;
  const pricing = (inner.pricing ?? data.pricing) as Record<string, unknown> | undefined;

  const discount =
    Number(offers?.coupon_discount ?? pricing?.coupon_discount ?? 0) || 0;
  const code =
    typeof offers?.coupon_applied === "string" ? offers.coupon_applied : undefined;

  return { code, discount };
}

export function extractOrder(placedData: unknown, rawText = ""): CheckoutOrder | null {
  const payload =
    findOrderPayload(placedData) ??
    (rawText ? findOrderPayload(rawText) : null);

  if (!payload) return null;

  const orderId =
    coalesceOrderId(payload.orderId) ?? coalesceOrderId(payload.order_id);
  if (!orderId) return null;

  const status =
    typeof payload.status === "string"
      ? payload.status
      : typeof payload.orderStatus === "string"
        ? payload.orderStatus
        : typeof payload.normalizedStatus === "string" &&
            payload.normalizedStatus === "success"
          ? "CONFIRMED"
          : "CONFIRMED";

  return {
    orderId,
    status,
    totalAmount:
      (payload.totalAmount as number | string | null | undefined) ??
      (payload.total_amount as number | string | null | undefined) ??
      (payload.orderTotal as number | string | null | undefined),
    restaurantName:
      (payload.restaurantName as string | null | undefined) ??
      (payload.restaurant_name as string | null | undefined),
    estimatedDelivery:
      (payload.estimatedDelivery as string | null | undefined) ??
      (payload.estimated_delivery as string | null | undefined),
    deliveryAddress:
      (payload.deliveryAddress as string | null | undefined) ??
      (payload.delivery_address as string | null | undefined),
  };
}

function normalizeAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function orderMatchesHints(
  order: Record<string, unknown>,
  hints: OrderRecoveryHints
): boolean {
  if (hints.restaurantName) {
    const name = String(order.restaurantName ?? "").toLowerCase();
    if (!name.includes(hints.restaurantName.toLowerCase())) return false;
  }

  const hintTotal = normalizeAmount(hints.totalAmount);
  const orderTotal = normalizeAmount(order.orderTotal ?? order.totalAmount);
  if (hintTotal != null && orderTotal != null) {
    return Math.abs(hintTotal - orderTotal) <= 2;
  }

  return true;
}

async function recoverOrderFromHistory(
  mcpClient: SwiggyMcpClient,
  addressId: string,
  hints: OrderRecoveryHints,
  toolEvents: CheckoutToolEvent[]
): Promise<CheckoutOrder | null> {
  pushEvent(toolEvents, "get_food_orders", "started", "Checking recent orders...");
  try {
    const result = await mcpClient.callCheckoutTool("get_food_orders", {
      addressId,
      activeOnly: true,
    });
    const parsed = parseMcpToolResult(result);

    if (!parsed.ok) {
      pushEvent(
        toolEvents,
        "get_food_orders",
        "failed",
        parsed.error ?? "Could not fetch recent orders"
      );
      return null;
    }

    const data = unwrapData(parsed.data);
    const orders = (data.orders ?? []) as Array<Record<string, unknown>>;
    const candidate =
      orders.find((o) => orderMatchesHints(o, hints) && coalesceOrderId(o.orderId)) ??
      orders.find((o) => coalesceOrderId(o.orderId));

    if (!candidate) {
      pushEvent(toolEvents, "get_food_orders", "completed", "No matching active order found");
      return null;
    }

    const orderId = coalesceOrderId(candidate.orderId)!;
    pushEvent(
      toolEvents,
      "get_food_orders",
      "completed",
      `Recovered active order ${orderId}`
    );

    return {
      orderId,
      status:
        typeof candidate.orderStatus === "string" ? candidate.orderStatus : "CONFIRMED",
      totalAmount: candidate.orderTotal as string | number | null | undefined,
      restaurantName: candidate.restaurantName as string | null | undefined,
      deliveryAddress: candidate.restaurantAreaName as string | null | undefined,
      recoveredFromHistory: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushEvent(toolEvents, "get_food_orders", "failed", message);
    return null;
  }
}

async function refreshCartAfterOrder(
  mcpClient: SwiggyMcpClient,
  addressId: string,
  toolEvents: CheckoutToolEvent[]
): Promise<unknown | undefined> {
  pushEvent(toolEvents, "get_food_cart", "started", "Refreshing cart after order...");
  try {
    const result = await mcpClient.callCheckoutTool("get_food_cart", { addressId });
    const parsed = parseMcpToolResult(result);
    pushEvent(
      toolEvents,
      "get_food_cart",
      parsed.ok ? "completed" : "failed",
      parsed.ok ? "Cart refreshed after order" : parsed.error ?? "Failed to refresh cart"
    );
    return parsed.ok ? parsed.data : undefined;
  } catch {
    pushEvent(toolEvents, "get_food_cart", "failed", "Failed to refresh cart after order");
    return undefined;
  }
}

function pushEvent(
  events: CheckoutToolEvent[],
  tool: string,
  status: CheckoutToolEvent["status"],
  summary: string
): void {
  events.push({ tool, status, summary });
}

async function finalizePlacedOrder(
  mcpClient: SwiggyMcpClient,
  addressId: string,
  order: CheckoutOrder,
  toolEvents: CheckoutToolEvent[],
  cartFallback: unknown,
  couponApplied?: string,
  couponDiscount?: number
): Promise<CheckoutResult> {
  pushEvent(
    toolEvents,
    "place_food_order",
    "completed",
    order.recoveredFromHistory
      ? `Order confirmed — ID ${order.orderId} (recovered from order history)`
      : `Order placed — ID ${order.orderId}`
  );

  const postCart = await refreshCartAfterOrder(mcpClient, addressId, toolEvents);

  return {
    ok: true,
    couponApplied,
    couponDiscount,
    cart: postCart ?? cartFallback,
    order,
  };
}

async function resolveOrderAfterPlacement(
  mcpClient: SwiggyMcpClient,
  addressId: string,
  orderParsed: ReturnType<typeof parseMcpToolResult>,
  hints: OrderRecoveryHints,
  toolEvents: CheckoutToolEvent[],
  cartFallback: unknown,
  couponApplied?: string,
  couponDiscount?: number
): Promise<CheckoutResult> {
  logPlaceOrderResponse(orderParsed);

  let order = extractOrder(orderParsed.data, orderParsed.text);

  if (!order) {
    order = await recoverOrderFromHistory(mcpClient, addressId, hints, toolEvents);
  }

  if (order?.orderId) {
    return finalizePlacedOrder(
      mcpClient,
      addressId,
      order,
      toolEvents,
      cartFallback,
      couponApplied,
      couponDiscount
    );
  }

  pushEvent(
    toolEvents,
    "place_food_order",
    "failed",
    "Could not confirm order ID from placement response"
  );

  return {
    ok: false,
    ambiguous: orderParsed.ok,
    error: orderParsed.ok
      ? "Swiggy accepted the request but did not return a confirmable order ID"
      : orderParsed.error ?? "Order placement failed",
    cart: cartFallback,
    couponApplied,
    couponDiscount,
  };
}

export async function runCodCheckout(
  mcpClient: SwiggyMcpClient,
  opts: { addressId: string; restaurantId: string; restaurantName?: string },
  toolEvents: CheckoutToolEvent[]
): Promise<CheckoutResult> {
  const { addressId, restaurantId, restaurantName } = opts;

  pushEvent(toolEvents, "fetch_food_coupons", "started", "Finding available coupons...");
  const couponsResult = await mcpClient.callCheckoutTool("fetch_food_coupons", {
    restaurantId,
    addressId,
  });
  const couponsParsed = parseMcpToolResult(couponsResult);
  pushEvent(
    toolEvents,
    "fetch_food_coupons",
    couponsParsed.ok ? "completed" : "failed",
    couponsParsed.ok
      ? "Fetched available coupons"
      : couponsParsed.error ?? "Failed to fetch coupons"
  );

  let couponApplied: string | undefined;
  let couponDiscount: number | undefined;

  if (couponsParsed.ok) {
    const best = pickBestCodCoupon(couponsParsed.data);
    if (best) {
      pushEvent(
        toolEvents,
        "apply_food_coupon",
        "started",
        `Applying coupon ${best.code}...`
      );
      const applyResult = await mcpClient.callCheckoutTool("apply_food_coupon", {
        couponCode: best.code,
        addressId,
      });
      const applyParsed = parseMcpToolResult(applyResult);
      const applied = extractCouponDiscount(applyParsed.data);

      if (applyParsed.ok && applied.discount > 0) {
        couponApplied = applied.code ?? best.code;
        couponDiscount = applied.discount;
        pushEvent(
          toolEvents,
          "apply_food_coupon",
          "completed",
          `Applied ${couponApplied} — saved ₹${couponDiscount}`
        );
      } else {
        pushEvent(
          toolEvents,
          "apply_food_coupon",
          "failed",
          applyParsed.error ?? `Coupon ${best.code} could not be applied`
        );
      }
    }
  }

  pushEvent(toolEvents, "get_food_cart", "started", "Refreshing cart before checkout...");
  const cartResult = await mcpClient.callCheckoutTool("get_food_cart", { addressId });
  const cartParsed = parseMcpToolResult(cartResult);
  pushEvent(
    toolEvents,
    "get_food_cart",
    cartParsed.ok ? "completed" : "failed",
    cartParsed.ok ? "Cart refreshed" : cartParsed.error ?? "Failed to refresh cart"
  );

  if (!cartParsed.ok) {
    return { ok: false, error: cartParsed.error ?? "Could not refresh cart", couponApplied, couponDiscount };
  }

  const cartData = unwrapData(cartParsed.data);
  const inner = (cartData.data ?? cartData) as Record<string, unknown>;
  const pricing = inner.pricing as Record<string, unknown> | undefined;
  const recoveryHints: OrderRecoveryHints = {
    restaurantName,
    totalAmount:
      (pricing?.to_pay as number | string | undefined) ??
      (inner.total as number | string | undefined),
  };

  pushEvent(toolEvents, "get_payment_options", "started", "Checking Cash on Delivery...");
  const payResult = await mcpClient.callCheckoutTool("get_payment_options", { addressId });
  const payParsed = parseMcpToolResult(payResult);
  const payData = unwrapData(payParsed.data);
  const cod = payData.cod as { available?: boolean } | undefined;

  if (!payParsed.ok || cod?.available === false) {
    pushEvent(
      toolEvents,
      "get_payment_options",
      "failed",
      payParsed.error ?? "Cash on Delivery is not available for this cart"
    );
    return {
      ok: false,
      error: "Cash on Delivery is not available for this cart",
      cart: cartParsed.data,
      couponApplied,
      couponDiscount,
    };
  }

  pushEvent(toolEvents, "get_payment_options", "completed", "Cash on Delivery available");

  pushEvent(toolEvents, "place_food_order", "started", "Placing your COD order...");
  const orderResult = await mcpClient.callCheckoutTool("place_food_order", {
    addressId,
    paymentMethod: "Cash",
  });
  const orderParsed = parseMcpToolResult(orderResult);

  if (!orderParsed.ok) {
    const recovered = await recoverOrderFromHistory(
      mcpClient,
      addressId,
      recoveryHints,
      toolEvents
    );
    if (recovered?.orderId) {
      return finalizePlacedOrder(
        mcpClient,
        addressId,
        recovered,
        toolEvents,
        cartParsed.data,
        couponApplied,
        couponDiscount
      );
    }

    pushEvent(
      toolEvents,
      "place_food_order",
      "failed",
      orderParsed.error ?? "Order placement failed"
    );
    return {
      ok: false,
      error: orderParsed.error ?? "Order placement failed",
      cart: cartParsed.data,
      couponApplied,
      couponDiscount,
    };
  }

  return resolveOrderAfterPlacement(
    mcpClient,
    addressId,
    orderParsed,
    recoveryHints,
    toolEvents,
    cartParsed.data,
    couponApplied,
    couponDiscount
  );
}

export function formatCheckoutReply(
  checkout: CheckoutResult,
  opts?: { addressLabel?: string; restaurantName?: string }
): string {
  if (checkout.ambiguous) {
    return [
      "I couldn't confirm the order ID from Swiggy's response.",
      "Your order **may already be placed** — please check the Swiggy app under **Orders** before trying again.",
      checkout.error ? `Details: ${checkout.error}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (!checkout.ok) {
    const err = checkout.error ?? "Checkout failed";
    return [
      `Could not confirm your order: ${err}`,
      "Check the Swiggy app **Orders** tab before retrying — the order may already exist.",
    ].join("\n");
  }

  const order = checkout.order!;
  if (!order.orderId) {
    return "Order placement could not be confirmed — Swiggy did not return an order ID. Check the Swiggy app Orders tab.";
  }

  const lines = [
    order.recoveredFromHistory
      ? `Swiggy order confirmed (Cash on Delivery) — recovered from your active orders.`
      : `Swiggy order placed successfully (Cash on Delivery).`,
    `Order ID: ${order.orderId}`,
  ];

  const restaurant = order.restaurantName ?? opts?.restaurantName;
  if (restaurant) lines.push(`Restaurant: ${restaurant}`);
  if (order.totalAmount != null) lines.push(`Total: ₹${order.totalAmount}`);
  if (checkout.couponApplied && checkout.couponDiscount) {
    lines.push(`Coupon ${checkout.couponApplied} applied — saved ₹${checkout.couponDiscount}`);
  }
  if (order.estimatedDelivery) lines.push(`Estimated delivery: ${order.estimatedDelivery}`);

  const delivery = order.deliveryAddress ?? opts?.addressLabel;
  if (delivery) lines.push(`Delivering to: ${delivery}`);

  lines.push(`Track this order in the Swiggy app under Orders.`);

  return lines.join("\n");
}
