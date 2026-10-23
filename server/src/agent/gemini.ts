import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type Schema,
  type Content,
  type Part,
} from "@google/generative-ai";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { hasOrderIntent, modelOfferedToPlace } from "./orderIntent.js";
import {
  appendMessage,
  getOrCreateSession,
  getRecentHistory,
  updateSessionContext,
  type SavedAddress,
} from "./sessionStore.js";
import type { SwiggyMcpClient } from "../swiggy/mcpClient.js";
import { parseMcpToolResult } from "../swiggy/toolResult.js";
import { formatCheckoutReply, runCodCheckout } from "../swiggy/checkout.js";
import {
  cartHasItems,
  extractAddressIdFromCart,
  extractRestaurantFromCart,
} from "../swiggy/cartUtils.js";
import {
  appendNotPlacedNotice,
  stripFalseOrderClaims,
} from "./replySanitizer.js";

const MVP_TOOL_NAMES = [
  "get_addresses",
  "search_restaurants",
  "search_menu",
  "get_restaurant_menu",
  "update_food_cart",
  "get_food_cart",
  "flush_food_cart",
] as const;

export interface ToolEvent {
  tool: string;
  status: "started" | "completed" | "failed";
  summary?: string;
}

export interface ChatResult {
  reply: string;
  toolEvents: ToolEvent[];
  cart?: unknown;
  order?: unknown;
}

type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  nullable?: boolean;
};

function resolveJsonSchemaType(schema: JsonSchema): string {
  if (Array.isArray(schema.type)) {
    return schema.type.find((t) => t !== "null") ?? "string";
  }
  return schema.type ?? "string";
}

function jsonSchemaToGeminiSchema(schema: JsonSchema): Schema {
  const type = resolveJsonSchemaType(schema);
  const base = {
    description: schema.description,
    nullable: schema.nullable,
  };

  switch (type) {
    case "integer":
      return { ...base, type: SchemaType.INTEGER };
    case "number":
      return { ...base, type: SchemaType.NUMBER };
    case "boolean":
      return { ...base, type: SchemaType.BOOLEAN };
    case "array": {
      const items: Schema = schema.items
        ? jsonSchemaToGeminiSchema(schema.items)
        : { type: SchemaType.STRING };
      return { ...base, type: SchemaType.ARRAY, items };
    }
    case "object": {
      const properties: Record<string, Schema> = {};
      for (const [key, val] of Object.entries(schema.properties ?? {})) {
        properties[key] = jsonSchemaToGeminiSchema(val);
      }
      return {
        ...base,
        type: SchemaType.OBJECT,
        properties,
        required: schema.required?.length ? schema.required : undefined,
      };
    }
    default:
      if (schema.enum?.length) {
        return {
          ...base,
          type: SchemaType.STRING,
          format: "enum",
          enum: schema.enum,
        };
      }
      return { ...base, type: SchemaType.STRING };
  }
}

function mcpToolToGeminiDeclaration(tool: {
  name: string;
  description?: string;
  inputSchema?: unknown;
}): FunctionDeclaration {
  const schema = (tool.inputSchema ?? {}) as JsonSchema;
  const properties = schema.properties ?? {};

  const geminiProperties: Record<string, Schema> = {};
  for (const [key, val] of Object.entries(properties)) {
    geminiProperties[key] = jsonSchemaToGeminiSchema(val);
  }

  return {
    name: tool.name,
    description: tool.description ?? `Call Swiggy tool ${tool.name}`,
    parameters: {
      type: SchemaType.OBJECT,
      properties: geminiProperties,
      required: schema.required?.length ? schema.required : undefined,
    },
  };
}

function normalizeToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  session: ReturnType<typeof getOrCreateSession>
): Record<string, unknown> {
  const normalized = { ...args };
  const needsAddress = [
    "get_food_cart",
    "update_food_cart",
    "flush_food_cart",
    "search_restaurants",
    "search_menu",
  ].includes(toolName);

  if (needsAddress && !normalized.addressId && session.addressId) {
    normalized.addressId = session.addressId;
  }

  return normalized;
}

async function prefetchCartState(
  sessionId: string,
  mcpClient: SwiggyMcpClient
): Promise<unknown | undefined> {
  const session = getOrCreateSession(sessionId);
  if (!session.addressId) return undefined;

  try {
    const result = await mcpClient.callTool("get_food_cart", {
      addressId: session.addressId,
    });
    const parsed = parseMcpToolResult(result);
    if (parsed.ok) {
      updateSessionContext(sessionId, { lastCartSnapshot: parsed.data });
      return parsed.data;
    }
  } catch {
    // Cart may be empty or unavailable — continue without prefetch
  }
  return undefined;
}

function toolEventSummary(
  tool: string,
  args: Record<string, unknown>,
  outcome?: { ok: boolean; error?: string }
): string {
  if (outcome && !outcome.ok) {
    return `${tool} failed: ${outcome.error ?? "unknown error"}`;
  }
  switch (tool) {
    case "search_restaurants":
      return `Searching for "${args.query ?? "restaurants"}"...`;
    case "search_menu":
      return `Searching menu for "${args.query ?? "items"}"...`;
    case "update_food_cart":
      return "Updating your cart...";
    case "get_food_cart":
      return "Fetching your cart...";
    case "get_addresses":
      return "Loading your delivery addresses...";
    case "flush_food_cart":
      return "Clearing your cart...";
    case "get_restaurant_menu":
      return "Browsing restaurant menu...";
    default:
      return `Running ${tool}...`;
  }
}

function formatAddressLabel(addr: SavedAddress): string {
  const tag = addr.addressTag ?? addr.addressCategory;
  const line = addr.addressLine ?? "";
  if (tag && line) return `${tag}: ${line}`;
  return tag ?? line ?? addr.id;
}

function syncSessionFromCart(sessionId: string, cart: unknown): void {
  const session = getOrCreateSession(sessionId);
  const fromCart = extractRestaurantFromCart(cart);
  const patch: Parameters<typeof updateSessionContext>[1] = {};

  if (fromCart.restaurantId) {
    patch.restaurantId = fromCart.restaurantId;
    if (fromCart.restaurantName) patch.restaurantName = fromCart.restaurantName;
  }

  const cartAddressId = extractAddressIdFromCart(cart);
  if (cartAddressId) {
    patch.addressId = cartAddressId;
    const saved = session.addressesById?.[cartAddressId];
    if (saved) patch.addressLabel = formatAddressLabel(saved);
  }

  if (Object.keys(patch).length > 0) {
    updateSessionContext(sessionId, patch);
  }
}

async function refreshCartForCheckout(
  sessionId: string,
  mcpClient: SwiggyMcpClient,
  addressId: string,
  toolEvents: ToolEvent[]
): Promise<unknown | undefined> {
  toolEvents.push({
    tool: "get_food_cart",
    status: "started",
    summary: "Verifying cart before checkout...",
  });

  try {
    const result = await mcpClient.callTool("get_food_cart", { addressId });
    const parsed = parseMcpToolResult(result);
    toolEvents.push({
      tool: "get_food_cart",
      status: parsed.ok ? "completed" : "failed",
      summary: parsed.ok
        ? "Cart verified for checkout"
        : parsed.error ?? "Failed to verify cart",
    });

    if (parsed.ok) {
      updateSessionContext(sessionId, { lastCartSnapshot: parsed.data });
      syncSessionFromCart(sessionId, parsed.data);
      return parsed.data;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toolEvents.push({
      tool: "get_food_cart",
      status: "failed",
      summary: message,
    });
  }

  return undefined;
}

function formatCartContextForPrompt(cart: unknown): string | null {
  if (!cart || typeof cart !== "object") return null;
  const root = cart as Record<string, unknown>;
  if (typeof root.raw === "string") return root.raw;
  return JSON.stringify(cart).slice(0, 2000);
}

function maybeUpdateSessionFromTool(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  parsed: unknown
): void {
  if (toolName === "get_addresses" && parsed && typeof parsed === "object") {
    const data = parsed as {
      addresses?: Array<{
        id?: string;
        addressId?: string;
        isDefault?: boolean;
        addressLine?: string;
        addressTag?: string;
        addressCategory?: string;
      }>;
      data?: {
        addresses?: Array<{
          id?: string;
          addressId?: string;
          isDefault?: boolean;
          addressLine?: string;
          addressTag?: string;
          addressCategory?: string;
        }>;
      };
    };
    const addresses = data.addresses ?? data.data?.addresses;
    if (addresses?.length) {
      const byId: Record<string, SavedAddress> = {};
      for (const addr of addresses) {
        const id = addr.addressId ?? addr.id;
        if (!id) continue;
        byId[id] = {
          id,
          addressLine: addr.addressLine,
          addressTag: addr.addressTag,
          addressCategory: addr.addressCategory,
        };
      }

      const session = getOrCreateSession(sessionId);
      const patch: Parameters<typeof updateSessionContext>[1] = { addressesById: byId };

      if (!session.addressId) {
        const defaultAddr = addresses.find((a) => a.isDefault) ?? addresses[0];
        const addressId = defaultAddr.addressId ?? defaultAddr.id;
        if (addressId && byId[addressId]) {
          patch.addressId = addressId;
          patch.addressLabel = formatAddressLabel(byId[addressId]);
        }
      } else if (byId[session.addressId]) {
        patch.addressLabel = formatAddressLabel(byId[session.addressId]);
      }

      updateSessionContext(sessionId, patch);
    }
  }

  if (toolName === "search_restaurants" && args.query && parsed && typeof parsed === "object") {
    const data = parsed as {
      restaurants?: Array<{ id: string; name: string }>;
      data?: { restaurants?: Array<{ id: string; name: string }> };
    };
    const restaurants = data.restaurants ?? data.data?.restaurants;
    if (restaurants?.length === 1) {
      updateSessionContext(sessionId, {
        restaurantId: restaurants[0].id,
        restaurantName: restaurants[0].name,
      });
    }
  }

  if (toolName === "update_food_cart" && args.restaurantId && typeof args.restaurantId === "string") {
    updateSessionContext(sessionId, {
      restaurantId: args.restaurantId,
      restaurantName:
        typeof args.restaurantName === "string" ? args.restaurantName : undefined,
    });
  }

  if (toolName === "get_food_cart") {
    updateSessionContext(sessionId, { lastCartSnapshot: parsed });
    syncSessionFromCart(sessionId, parsed);
  }
}

async function maybeRunCheckout(
  userMessage: string,
  sessionId: string,
  mcpClient: SwiggyMcpClient,
  toolEvents: ToolEvent[],
  reply: string,
  cart: unknown
): Promise<{ reply: string; cart: unknown; order?: unknown }> {
  const session = getOrCreateSession(sessionId);
  const priorHistory = getRecentHistory(sessionId, 20).slice(0, -1);
  const orderIntent = hasOrderIntent(
    userMessage,
    priorHistory,
    session.pendingPlaceOrder
  );

  if (!orderIntent) {
    return { reply: stripFalseOrderClaims(reply), cart };
  }

  if (!session.addressId) {
    return {
      reply: appendNotPlacedNotice(
        stripFalseOrderClaims(reply) +
          "\n\nNo delivery address selected — call get_addresses and pick an address first."
      ),
      cart,
    };
  }

  const freshCart =
    (await refreshCartForCheckout(
      sessionId,
      mcpClient,
      session.addressId,
      toolEvents
    )) ?? cart;

  if (!cartHasItems(freshCart)) {
    return {
      reply: appendNotPlacedNotice(stripFalseOrderClaims(reply)),
      cart: freshCart,
    };
  }

  const updatedSession = getOrCreateSession(sessionId);
  const restaurantId =
    updatedSession.restaurantId ?? extractRestaurantFromCart(freshCart).restaurantId;

  if (!restaurantId) {
    return {
      reply:
        stripFalseOrderClaims(reply) +
        "\n\nCould not place order: restaurant ID is missing. Try adding the item to cart again.",
      cart: freshCart,
    };
  }

  const checkout = await runCodCheckout(
    mcpClient,
    {
      addressId: updatedSession.addressId!,
      restaurantId,
      restaurantName: updatedSession.restaurantName,
    },
    toolEvents
  );

  const updatedCart = checkout.cart ?? freshCart;

  if (checkout.ok && checkout.order) {
    updateSessionContext(sessionId, {
      lastOrderSnapshot: checkout.order,
      pendingPlaceOrder: false,
    });
    return {
      reply: formatCheckoutReply(checkout, {
        addressLabel: updatedSession.addressLabel,
        restaurantName: updatedSession.restaurantName,
      }),
      cart: updatedCart,
      order: checkout.order,
    };
  }

  updateSessionContext(sessionId, { pendingPlaceOrder: false });

  return {
    reply: formatCheckoutReply(checkout, {
      addressLabel: updatedSession.addressLabel,
      restaurantName: updatedSession.restaurantName,
    }),
    cart: updatedCart,
  };
}

export async function runAgentChat(
  sessionId: string,
  userMessage: string,
  mcpClient: SwiggyMcpClient,
  apiKey: string
): Promise<ChatResult> {
  const toolEvents: ToolEvent[] = [];
  const session = getOrCreateSession(sessionId);
  appendMessage(sessionId, { role: "user", text: userMessage });

  const mcpTools = await mcpClient.listMvpTools();
  const declarations = mcpTools
    .filter((t) => MVP_TOOL_NAMES.includes(t.name as (typeof MVP_TOOL_NAMES)[number]))
    .map(mcpToolToGeminiDeclaration);

  let cart: unknown = session.lastCartSnapshot;
  const prefetchedCart = await prefetchCartState(sessionId, mcpClient);
  if (prefetchedCart) {
    cart = prefetchedCart;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash-lite",
    systemInstruction: buildContextualPrompt(session, prefetchedCart ?? session.lastCartSnapshot),
    tools: [{ functionDeclarations: declarations }],
  });

  const history = getRecentHistory(sessionId, 20);
  const contents: Content[] = history.slice(0, -1).map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.text }],
  }));
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  let cartFetchedThisTurn = Boolean(prefetchedCart);
  let cartUpdatedOk = false;
  let pendingCartVerify = false;

  for (let i = 0; i < 10; i++) {
    const response = await model.generateContent({ contents });
    const candidate = response.response.candidates?.[0];
    if (!candidate?.content?.parts?.length) {
      throw new Error("Empty response from Gemini");
    }

    const parts = candidate.content.parts;
    const functionCalls = parts.filter((p) => p.functionCall);

    if (functionCalls.length === 0) {
      let reply = parts.map((p) => p.text ?? "").join("").trim();

      if (modelOfferedToPlace(reply)) {
        updateSessionContext(sessionId, { pendingPlaceOrder: true });
      }

      appendMessage(sessionId, { role: "model", text: reply });

      const checkoutResult = await maybeRunCheckout(
        userMessage,
        sessionId,
        mcpClient,
        toolEvents,
        reply,
        cart
      );

      return {
        reply: checkoutResult.reply,
        toolEvents,
        cart: checkoutResult.cart,
        order: checkoutResult.order,
      };
    }

    const modelParts: Part[] = parts;
    contents.push({ role: "model", parts: modelParts });

    const functionResponseParts: Part[] = [];

    for (const part of functionCalls) {
      const call = part.functionCall!;
      const toolName = call.name;
      let args = normalizeToolArgs(
        toolName,
        (call.args ?? {}) as Record<string, unknown>,
        session
      );

      if (toolName === "update_food_cart" && !cartFetchedThisTurn && session.addressId) {
        toolEvents.push({
          tool: "get_food_cart",
          status: "started",
          summary: "Reading current cart before update...",
        });
        try {
          const preCart = await mcpClient.callTool("get_food_cart", {
            addressId: session.addressId,
          });
          const preParsed = parseMcpToolResult(preCart);
          cartFetchedThisTurn = true;
          if (preParsed.ok) {
            cart = preParsed.data;
            updateSessionContext(sessionId, { lastCartSnapshot: preParsed.data });
          }
          toolEvents.push({
            tool: "get_food_cart",
            status: preParsed.ok ? "completed" : "failed",
            summary: preParsed.ok
              ? "Read current cart before update"
              : preParsed.error ?? "Failed to read cart",
          });
          functionResponseParts.push({
            functionResponse: {
              name: "get_food_cart",
              response: preParsed.ok
                ? { result: preParsed.data, note: "Auto-fetched before cart update" }
                : { error: preParsed.error ?? "Failed to read cart" },
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toolEvents.push({
            tool: "get_food_cart",
            status: "failed",
            summary: message,
          });
          functionResponseParts.push({
            functionResponse: {
              name: "get_food_cart",
              response: { error: message },
            },
          });
        }
      }

      toolEvents.push({
        tool: toolName,
        status: "started",
        summary: toolEventSummary(toolName, args),
      });

      try {
        const result = await mcpClient.callTool(toolName, args);
        const parsed = parseMcpToolResult(result);

        if (toolName === "get_food_cart" && parsed.ok) {
          cartFetchedThisTurn = true;
          cart = parsed.data;
          syncSessionFromCart(sessionId, parsed.data);
          if (pendingCartVerify && cartHasItems(parsed.data)) {
            cartUpdatedOk = true;
            pendingCartVerify = false;
          }
        }

        if (toolName === "update_food_cart" && parsed.ok) {
          pendingCartVerify = true;
          cartUpdatedOk = false;
        }

        maybeUpdateSessionFromTool(sessionId, toolName, args, parsed.data);

        toolEvents.push({
          tool: toolName,
          status: parsed.ok ? "completed" : "failed",
          summary: toolEventSummary(toolName, args, parsed),
        });

        functionResponseParts.push({
          functionResponse: {
            name: toolName,
            response: parsed.ok
              ? { result: parsed.data }
              : { error: parsed.error ?? "Tool failed", result: parsed.data },
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolEvents.push({
          tool: toolName,
          status: "failed",
          summary: message,
        });
        functionResponseParts.push({
          functionResponse: {
            name: toolName,
            response: { error: message },
          },
        });
      }
    }

    contents.push({ role: "user", parts: functionResponseParts });
  }

  const fallback = "I ran into too many steps. Could you try a simpler request?";
  appendMessage(sessionId, { role: "model", text: fallback });
  return { reply: fallback, toolEvents, cart };
}

function buildContextualPrompt(
  session: ReturnType<typeof getOrCreateSession>,
  currentCart?: unknown
): string {
  const lines = [SYSTEM_PROMPT];
  if (session.addressId) {
    lines.push(`\nCached addressId: ${session.addressId}`);
    if (session.addressLabel) {
      lines.push(`Cached delivery address: ${session.addressLabel}`);
    }
  }
  if (session.addressesById && Object.keys(session.addressesById).length > 0) {
    const listing = Object.values(session.addressesById)
      .map((a) => `- ${a.id}: ${formatAddressLabel(a)}`)
      .join("\n");
    lines.push(`\nSaved addresses (use exact id):\n${listing}`);
  }
  if (session.restaurantId) {
    lines.push(
      `Cached restaurant: ${session.restaurantName ?? "unknown"} (${session.restaurantId})`
    );
  }
  const cartText = formatCartContextForPrompt(currentCart);
  if (cartText) {
    lines.push(`\nCurrent server-side cart (from get_food_cart):\n${cartText}`);
  }
  return lines.join("\n");
}
