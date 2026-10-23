import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthTokens } from "./oauth.js";
import { isTokenExpired } from "./oauth.js";

const MVP_TOOLS = new Set([
  "get_addresses",
  "search_restaurants",
  "search_menu",
  "get_restaurant_menu",
  "update_food_cart",
  "get_food_cart",
  "flush_food_cart",
]);

const CHECKOUT_TOOLS = new Set([
  "fetch_food_coupons",
  "apply_food_coupon",
  "get_payment_options",
  "place_food_order",
  "get_food_orders",
  ...MVP_TOOLS,
]);

const ALL_TOOLS = CHECKOUT_TOOLS;

export class SwiggyMcpError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = "SwiggyMcpError";
  }
}

export class SwiggyMcpClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;

  constructor(
    private mcpUrl: string,
    private getTokens: () => OAuthTokens | undefined,
    private onAuthRequired: () => void
  ) {}

  private async ensureConnected(): Promise<Client> {
    const tokens = this.getTokens();
    if (!tokens || isTokenExpired(tokens)) {
      this.onAuthRequired();
      throw new SwiggyMcpError("Swiggy authentication required", 401);
    }

    if (this.client) {
      return this.client;
    }

    this.transport = new StreamableHTTPClientTransport(new URL(this.mcpUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      },
    });

    this.client = new Client({ name: "bolo", version: "1.0.0" });
    await this.client.connect(this.transport);
    return this.client;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
  }

  async listMvpTools() {
    const client = await this.ensureConnected();
    const { tools } = await client.listTools();
    return tools.filter((t) => MVP_TOOLS.has(t.name));
  }

  async callTool(name: string, args: Record<string, unknown>) {
    if (!MVP_TOOLS.has(name)) {
      throw new Error(`Tool ${name} is not enabled in MVP`);
    }

    return this.callToolInternal(name, args);
  }

  async callCheckoutTool(name: string, args: Record<string, unknown>) {
    if (!CHECKOUT_TOOLS.has(name)) {
      throw new Error(`Tool ${name} is not enabled for checkout`);
    }

    return this.callToolInternal(name, args);
  }

  private async callToolInternal(name: string, args: Record<string, unknown>) {
    if (!ALL_TOOLS.has(name)) {
      throw new Error(`Tool ${name} is not enabled`);
    }

    return this.callWithReauth(async () => {
      const client = await this.ensureConnected();
      const result = await client.callTool({ name, arguments: args });
      return result;
    });
  }

  private async callWithReauth<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const status = extractStatus(err);
      if (status === 401 || status === 419) {
        await this.disconnect();
        this.onAuthRequired();
        throw new SwiggyMcpError("Swiggy session expired — please reconnect", status);
      }
      throw err;
    }
  }
}

function extractStatus(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const e = err as { status?: number; code?: number };
    if (typeof e.status === "number") return e.status;
    if (typeof e.code === "number") return e.code;
  }
  return undefined;
}
