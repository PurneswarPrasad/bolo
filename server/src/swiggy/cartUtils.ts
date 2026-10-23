export function unwrapSwiggyData(parsed: unknown): Record<string, unknown> {
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

export function cartHasItems(cart: unknown): boolean {
  if (!cart || typeof cart !== "object") return false;
  const root = cart as Record<string, unknown>;
  if (typeof root.raw === "string") {
    return /Items\s*\(\d+\)/i.test(root.raw) && !/Items\s*\(0\)/i.test(root.raw);
  }

  const data = unwrapSwiggyData(cart);
  const inner = (data.data ?? data) as Record<string, unknown>;
  const items =
    (inner.items as unknown[]) ??
    (inner.cartItems as unknown[]) ??
    (data.items as unknown[]) ??
    [];
  return Array.isArray(items) && items.length > 0;
}

export function extractRestaurantFromCart(cart: unknown): {
  restaurantId?: string;
  restaurantName?: string;
} {
  const data = unwrapSwiggyData(cart);
  const inner = (data.data ?? data) as Record<string, unknown>;
  const restaurant = (inner.restaurant ?? data.restaurant) as
    | Record<string, unknown>
    | undefined;

  if (!restaurant) return {};

  const restaurantId =
    (typeof restaurant.id === "string" ? restaurant.id : undefined) ??
    (typeof restaurant.restaurantId === "string" ? restaurant.restaurantId : undefined);

  const restaurantName =
    typeof restaurant.name === "string" ? restaurant.name : undefined;

  return { restaurantId, restaurantName };
}

export function extractAddressIdFromCart(cart: unknown): string | undefined {
  if (!cart || typeof cart !== "object") return undefined;
  const root = cart as Record<string, unknown>;
  if (typeof root.addressId === "string") return root.addressId;
  const data = unwrapSwiggyData(cart);
  if (typeof data.addressId === "string") return data.addressId;
  return undefined;
}
