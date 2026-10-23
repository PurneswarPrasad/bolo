/**
 * Manual smoke test — requires a valid OAuth session cookie or env token.
 * Run after completing Swiggy OAuth in the browser.
 *
 * Usage: SWIGGY_ACCESS_TOKEN=eyJ... npm run smoke-test -w server
 */
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const token = process.env.SWIGGY_ACCESS_TOKEN;
const mcpUrl = process.env.SWIGGY_MCP_URL ?? "https://mcp.swiggy.com/food";

async function main() {
  if (!token) {
    console.error("Set SWIGGY_ACCESS_TOKEN from a completed OAuth flow");
    process.exit(1);
  }

  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });

  const client = new Client({ name: "bolo-smoke-test", version: "1.0.0" });
  await client.connect(transport);

  const addresses = await client.callTool({ name: "get_addresses", arguments: {} });
  console.log("get_addresses:", JSON.stringify(addresses, null, 2));

  const text = extractText(addresses);
  const parsed = JSON.parse(text) as {
    addresses?: Array<{ id: string }>;
    data?: { addresses?: Array<{ id: string }> };
  };
  const addressList = parsed.addresses ?? parsed.data?.addresses ?? [];
  const addressId = addressList[0]?.id;

  if (!addressId) {
    console.error("No saved addresses — add one in the Swiggy app");
    process.exit(1);
  }

  const search = await client.callTool({
    name: "search_restaurants",
    arguments: { addressId, query: "Behrouz" },
  });
  console.log("search_restaurants:", JSON.stringify(search, null, 2));

  await client.close();
  console.log("Smoke test passed");
}

function extractText(result: unknown): string {
  const r = result as { content?: Array<{ type?: string; text?: string }> };
  return (
    r.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("") ?? "{}"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
