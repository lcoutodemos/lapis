/**
 * AFFiNE MCP HTTP Server.
 *
 * Implements a minimal subset of the Model Context Protocol over HTTP so that
 * Claude Code (and later Copilot ACP) can call AFFiNE workspace tools.
 *
 * Protocol: JSON-RPC 2.0 over HTTP POST.
 * Each request gets a synchronous JSON response (no SSE streaming needed
 * for tool calls in the Streamable HTTP transport).
 *
 * Methods implemented:
 *   initialize    → handshake
 *   tools/list    → enumerate AFFiNE tools
 *   tools/call    → execute a tool via AFFiNECapability
 *   ping          → no-op keepalive
 *
 * The server binds to 127.0.0.1 on an ephemeral port. The port is written
 * into ~/.claude.json (mcpServers.affine.url) before each CLI session starts.
 */

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { logger } from '../logger';
import type { AFFiNECapability } from './index';

// ---------------------------------------------------------------------------
// Tool definitions — what the model sees
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    name: 'affine_read_doc',
    description:
      'Read a document from the workspace as markdown. Block IDs are annotated as HTML comments <!-- block:ID -->. Always read before editing.',
    inputSchema: {
      type: 'object',
      properties: {
        docId: {
          type: 'string',
          description: 'The document ID to read',
        },
      },
      required: ['docId'],
    },
  },
  {
    name: 'affine_list_docs',
    description:
      'List all documents in the active workspace with their IDs, titles, tags, and last-updated timestamps.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'affine_search_workspace',
    description:
      'Search across all documents in the workspace using keyword and semantic search. Returns ranked results with excerpts.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'affine_get_selection',
    description:
      "Get the user's current editor selection as markdown with block IDs. Use this to understand what content the user is focused on.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'affine_get_block_tree',
    description:
      'Get the hierarchical block structure of a document. Useful for understanding document organisation before making structural edits.',
    inputSchema: {
      type: 'object',
      properties: {
        docId: {
          type: 'string',
          description: 'The document ID',
        },
      },
      required: ['docId'],
    },
  },
  {
    name: 'affine_apply_changes',
    description:
      'Apply edits to a document by supplying the full document markdown. Changes are written immediately and visible in the editor. ' +
      'Read the document first. Supply the full document markdown with your changes applied. ' +
      'Block IDs in HTML comments are optional; they will be assigned automatically if omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        docId: {
          type: 'string',
          description: 'The document ID to edit',
        },
        proposedMarkdown: {
          type: 'string',
          description: 'The complete updated document markdown',
        },
        reason: {
          type: 'string',
          description:
            'Brief description of what you changed and why (shown to user)',
        },
      },
      required: ['docId', 'proposedMarkdown'],
    },
  },
  {
    name: 'affine_create_page',
    description: 'Create a new page/document in the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the new document',
        },
        initialContent: {
          type: 'string',
          description: 'Optional initial markdown content',
        },
      },
      required: ['title'],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export class AffineMcpServer {
  private readonly server: http.Server;
  private port = 0;
  private started = false;

  constructor(private readonly capability: AFFiNECapability) {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch(err => logger.error(err));
    });
  }

  async start(): Promise<number> {
    if (this.started) return this.port;

    await new Promise<void>((resolve, reject) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as { port: number };
        this.port = addr.port;
        resolve();
      });
      this.server.once('error', reject);
    });

    this.started = true;
    logger.info('[mcp-server] listening on', this.port);
    // ~/.claude.json is NOT written here — it waits for the renderer to
    // signal capability readiness via notifyRendererReady().
    return this.port;
  }

  /**
   * Called once the renderer capability handler has registered.
   * Writes ~/.claude.json so Claude Code sessions can discover the MCP server.
   */
  async notifyRendererReady(): Promise<void> {
    await this.updateClaudeConfig();
  }

  stop(): void {
    this.server.close();
    this.started = false;
  }

  // ---------------------------------------------------------------------------

  private async updateClaudeConfig(): Promise<void> {
    const configPath = path.join(os.homedir(), '.claude.json');
    let config: Record<string, unknown> = {};

    try {
      const raw = await fs.readFile(configPath, 'utf-8');
      config = JSON.parse(raw);
    } catch {
      // File may not exist yet — that's fine
    }

    const mcpServers = (config['mcpServers'] as Record<string, unknown>) ?? {};
    mcpServers['affine'] = {
      url: `http://127.0.0.1:${this.port}/mcp`,
      transport: 'http',
    };
    config['mcpServers'] = mcpServers;

    try {
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      logger.info('[mcp-server] updated ~/.claude.json');
    } catch (err) {
      logger.warn('[mcp-server] could not update ~/.claude.json', err);
    }
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Only accept POST to /mcp
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let rpc: { jsonrpc: string; id: unknown; method: string; params?: unknown };
    try {
      rpc = JSON.parse(body);
    } catch {
      res.writeHead(400).end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        })
      );
      return;
    }

    let result: unknown;
    try {
      result = await this.dispatch(rpc.method, rpc.params ?? {});
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[mcp-server] tool error', err);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: rpc.id,
          error: { code: -32603, message },
        })
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'affine', version: '1.0.0' },
        };

      case 'notifications/initialized':
        return {};

      case 'tools/list':
        return { tools: TOOL_DEFINITIONS };

      case 'tools/call':
        return this.callTool(
          params as { name: string; arguments?: Record<string, unknown> }
        );

      case 'ping':
        return {};

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{ content: Array<{ type: string; text: string }> }> {
    const args = params.arguments ?? {};
    const text = await this.executeTool(params.name, args);
    return { content: [{ type: 'text', text }] };
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    switch (name) {
      case 'affine_read_doc': {
        const markdown = await this.capability.readDoc(String(args['docId']));
        return markdown;
      }

      case 'affine_list_docs': {
        const docs = await this.capability.listDocs();
        return JSON.stringify(docs, null, 2);
      }

      case 'affine_search_workspace': {
        const results = await this.capability.searchWorkspace(
          String(args['query']),
          { limit: typeof args['limit'] === 'number' ? args['limit'] : 10 }
        );
        return JSON.stringify(results, null, 2);
      }

      case 'affine_get_selection': {
        const selection = await this.capability.getSelection();
        return JSON.stringify(selection, null, 2);
      }

      case 'affine_get_block_tree': {
        const tree = await this.capability.getBlockTree(String(args['docId']));
        return JSON.stringify(tree, null, 2);
      }

      case 'affine_apply_changes': {
        await this.capability.applyChanges(
          String(args['docId']),
          String(args['proposedMarkdown'])
        );
        const reason = args['reason'] ? ` Reason: ${args['reason']}` : '';
        return `Changes applied to document ${args['docId']}.${reason} The content is now visible in the editor.`;
      }

      case 'affine_create_page': {
        const newDocId = await this.capability.createPage(
          String(args['title']),
          args['initialContent'] ? String(args['initialContent']) : undefined
        );
        return `Created new page "${args['title']}" with ID: ${newDocId}`;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
