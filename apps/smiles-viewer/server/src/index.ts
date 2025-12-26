import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = process.env.PORT ? Number(process.env.PORT) : 2091;
const MCP_PATH = "/mcp";
const widgetHtml = readFileSync(new URL("../../web/widget.html", import.meta.url), "utf8");

function createSmilesServer() {
  const server = new McpServer({
    name: "smiles-viewer",
    version: "0.1.0",
  });

  server.registerResource(
    "smiles_widget",
    "ui://widget/smiles-viewer.html",
    { description: "Render a SMILES string as a molecule diagram." },
    async () => ({
      contents: [
        {
          uri: "ui://widget/smiles-viewer.html",
          mimeType: "text/html+skybridge",
          text: widgetHtml,
          _meta: {
            "openai/widgetCSP": {
              resource_domains: ["https://unpkg.com"],
            },
          },
        },
      ],
    })
  );

  server.registerTool(
    "render_smiles",
    {
      title: "render_smiles",
      description: "Render a SMILES string as a 2D structure diagram.",
      inputSchema: z.object({
        smiles: z.string().min(1, "SMILES must not be empty"),
      }),
      _meta: {
        "openai/outputTemplate": "ui://widget/smiles-viewer.html",
      },
    },
    async ({ smiles }) => {
      return {
        structuredContent: { smiles },
        content: [
          {
            type: "text",
            text: `SMILESを描画します: ${smiles}`,
          },
        ],
      };
    }
  );

  return server;
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname.startsWith(MCP_PATH)) {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain" }).end("SMILES MCP server");
    return;
  }

  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createSmilesServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(PORT, () => {
  console.log(`SMILES MCP server listening on http://localhost:${PORT}${MCP_PATH}`);
});
