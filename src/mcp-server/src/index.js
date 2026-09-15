// ChainSentinel MCP server — stdio transport (decision D3), 11 frozen tools,
// read-only, thin adapter over the REST API. Bob never touches PostgreSQL.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOOL_DEFINITIONS, callTool } from "./tools.js";

const baseUrl = process.env.BACKEND_URL ?? "http://localhost:3001";

const server = new McpServer({ name: "chainsentinel-mcp", version: "1.0.0" });

for (const tool of TOOL_DEFINITIONS) {
  server.tool(tool.name, tool.description, tool.input, async (input) => {
    const result = await callTool(baseUrl, tool.name, input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: result.ok === false,
    };
  });
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`ChainSentinel MCP server ready (11 tools, backend: ${baseUrl})`);
