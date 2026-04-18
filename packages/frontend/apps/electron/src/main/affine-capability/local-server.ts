/**
 * AFFiNE Local REST HTTP Server.
 *
 * A simple REST API that Claude calls via Bash/curl instead of via MCP protocol.
 * Listens on an ephemeral port on 127.0.0.1 and writes the port to a temp file
 * so Claude knows how to reach it.
 *
 * Endpoints:
 *   GET  /docs              → capability.listDocs()        → JSON array
 *   GET  /docs/:id          → capability.readDoc(id)        → plain text (text/plain)
 *   GET  /docs/:id/blocks   → capability.getBlockTree(id)   → JSON
 *   POST /search            body: { query, limit? }         → capability.searchWorkspace() → JSON
 *   GET  /selection         → capability.getSelection()     → JSON
 *   POST /docs/:id/apply    body: { markdown, reason? }     → capability.applyChanges() → JSON {ok, message}
 *   POST /docs              body: { title, content? }       → capability.createPage() → JSON {docId, title}
 *
 *   GET    /collections               → capability.listCollections()           → JSON array
 *   POST   /collections               body: { name }                           → { collectionId, name }
 *   POST   /collections/:id/docs      body: { docId }                          → { ok }
 *   DELETE /collections/:id/docs/:did                                          → { ok }
 *   DELETE /collections/:id                                                    → { ok }
 */

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { logger } from '../logger';
import type { AFFiNECapability } from './index';

export const AFFINE_PORT_FILE = path.join(os.tmpdir(), 'affine-local.port');

export class AffineLocalServer {
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

    try {
      await fs.writeFile(AFFINE_PORT_FILE, String(this.port), 'utf-8');
    } catch (err) {
      logger.warn('[local-server] could not write port file', err);
    }

    logger.info('[local-server] listening on', this.port);
    return this.port;
  }

  stop(): void {
    this.server.close();
    this.started = false;
    fs.unlink(AFFINE_PORT_FILE).catch(() => {});
    logger.info('[local-server] stopped');
  }

  // ---------------------------------------------------------------------------

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    logger.info('[local-server] request', method, url);

    try {
      // GET /docs
      if (method === 'GET' && url === '/docs') {
        const docs = await this.capability.listDocs();
        this.sendJson(res, 200, docs);
        return;
      }

      // POST /docs  (create page)
      if (method === 'POST' && url === '/docs') {
        const body = await this.readBody(req);
        let parsed: { title: string; content?: string };
        try {
          parsed = JSON.parse(body);
        } catch {
          this.sendJson(res, 400, { error: 'Invalid JSON body' });
          return;
        }
        if (!parsed.title) {
          this.sendJson(res, 400, { error: 'Missing required field: title' });
          return;
        }
        const docId = await this.capability.createPage(
          parsed.title,
          parsed.content
        );
        this.sendJson(res, 200, { docId, title: parsed.title });
        return;
      }

      // POST /search
      if (method === 'POST' && url === '/search') {
        const body = await this.readBody(req);
        let parsed: { query: string; limit?: number };
        try {
          parsed = JSON.parse(body);
        } catch {
          this.sendJson(res, 400, { error: 'Invalid JSON body' });
          return;
        }
        if (!parsed.query) {
          this.sendJson(res, 400, { error: 'Missing required field: query' });
          return;
        }
        const results = await this.capability.searchWorkspace(parsed.query, {
          limit: typeof parsed.limit === 'number' ? parsed.limit : 10,
        });
        this.sendJson(res, 200, results);
        return;
      }

      // GET /selection
      if (method === 'GET' && url === '/selection') {
        const selection = await this.capability.getSelection();
        this.sendJson(res, 200, selection);
        return;
      }

      // Routes with :id
      // Match /docs/:id or /docs/:id/blocks or /docs/:id/apply
      const docsMatch = url.match(/^\/docs\/([^/]+)(\/blocks|\/apply)?$/);
      if (docsMatch) {
        const docId = decodeURIComponent(docsMatch[1]);
        const sub = docsMatch[2] ?? '';

        // GET /docs/:id
        if (method === 'GET' && sub === '') {
          const markdown = await this.capability.readDoc(docId);
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(markdown);
          return;
        }

        // GET /docs/:id/blocks
        if (method === 'GET' && sub === '/blocks') {
          const tree = await this.capability.getBlockTree(docId);
          this.sendJson(res, 200, tree);
          return;
        }

        // POST /docs/:id/apply
        if (method === 'POST' && sub === '/apply') {
          const body = await this.readBody(req);
          let parsed: { markdown: string; reason?: string };
          try {
            parsed = JSON.parse(body);
          } catch {
            this.sendJson(res, 400, { error: 'Invalid JSON body' });
            return;
          }
          if (!parsed.markdown) {
            this.sendJson(res, 400, {
              error: 'Missing required field: markdown',
            });
            return;
          }
          await this.capability.applyChanges(docId, parsed.markdown);
          this.sendJson(res, 200, { ok: true });
          return;
        }
      }

      // GET /collections
      if (method === 'GET' && url === '/collections') {
        const collections = await this.capability.listCollections();
        this.sendJson(res, 200, collections);
        return;
      }

      // POST /collections  (create collection)
      if (method === 'POST' && url === '/collections') {
        const body = await this.readBody(req);
        let parsed: { name: string };
        try {
          parsed = JSON.parse(body);
        } catch {
          this.sendJson(res, 400, { error: 'Invalid JSON body' });
          return;
        }
        if (!parsed.name) {
          this.sendJson(res, 400, { error: 'Missing required field: name' });
          return;
        }
        const collectionId = await this.capability.createCollection(
          parsed.name
        );
        this.sendJson(res, 200, { collectionId, name: parsed.name });
        return;
      }

      // Routes with collection :id
      // /collections/:id  or  /collections/:id/docs  or  /collections/:id/docs/:docId
      const collectionsMatch = url.match(
        /^\/collections\/([^/]+)(\/docs(?:\/([^/]+))?)?$/
      );
      if (collectionsMatch) {
        const collectionId = decodeURIComponent(collectionsMatch[1]);
        const subPath = collectionsMatch[2] ?? '';
        const docId = collectionsMatch[3]
          ? decodeURIComponent(collectionsMatch[3])
          : null;

        // POST /collections/:id/docs  (add doc)
        if (method === 'POST' && subPath === '/docs') {
          const body = await this.readBody(req);
          let parsed: { docId: string };
          try {
            parsed = JSON.parse(body);
          } catch {
            this.sendJson(res, 400, { error: 'Invalid JSON body' });
            return;
          }
          if (!parsed.docId) {
            this.sendJson(res, 400, { error: 'Missing required field: docId' });
            return;
          }
          await this.capability.addDocToCollection(collectionId, parsed.docId);
          this.sendJson(res, 200, { ok: true });
          return;
        }

        // DELETE /collections/:id/docs/:docId  (remove doc)
        if (method === 'DELETE' && subPath.startsWith('/docs/') && docId) {
          await this.capability.removeDocFromCollection(collectionId, docId);
          this.sendJson(res, 200, { ok: true });
          return;
        }

        // DELETE /collections/:id  (delete collection)
        if (method === 'DELETE' && subPath === '') {
          await this.capability.deleteCollection(collectionId);
          this.sendJson(res, 200, { ok: true });
          return;
        }
      }

      // 404 fallthrough
      this.sendJson(res, 404, { error: `Not found: ${method} ${url}` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[local-server] request error', err);
      this.sendJson(res, 500, { error: message });
    }
  }

  private sendJson(
    res: http.ServerResponse,
    status: number,
    data: unknown
  ): void {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }
}
