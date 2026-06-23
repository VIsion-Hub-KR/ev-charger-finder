// 로컬 개발 서버: public/ 정적 파일 + /api/* 서버리스 핸들러를 함께 제공.
// 실행: node --env-file=.env.local scripts/dev-server.mjs  (포트 3000)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import chargersHandler from '../api/chargers.js';
import searchHandler   from '../api/search.js';
import routeHandler    from '../api/route.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Map API pathnames to their handlers. */
const apiHandlers = {
  '/api/chargers': chargersHandler,
  '/api/search':   searchHandler,
  '/api/route':    routeHandler,
};

/**
 * Build a minimal Vercel-style req/res shim and invoke the given handler.
 * @param {object} nodeReq
 * @param {object} nodeRes
 * @param {URL} url
 * @param {Function} handler
 */
async function callHandler(nodeReq, nodeRes, url, handler) {
  const req = { query: Object.fromEntries(url.searchParams), method: nodeReq.method };
  const res = {
    statusCode: 200,
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(obj) {
      this.setHeader('content-type', 'application/json; charset=utf-8');
      nodeRes.writeHead(this.statusCode, this._headers);
      nodeRes.end(JSON.stringify(obj));
    },
  };
  try { await handler(req, res); }
  catch (e) { nodeRes.writeHead(500); nodeRes.end(String(e)); }
}

const server = createServer(async (nodeReq, nodeRes) => {
  const url = new URL(nodeReq.url, `http://localhost:${PORT}`);

  // API routes → Vercel 스타일 핸들러 호출
  const apiHandler = apiHandlers[url.pathname];
  if (apiHandler) {
    await callHandler(nodeReq, nodeRes, url, apiHandler);
    return;
  }

  // 정적 파일
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const buf = await readFile(join(root, path));
    nodeRes.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    nodeRes.end(buf);
  } catch {
    nodeRes.writeHead(404); nodeRes.end('not found');
  }
});

server.listen(PORT, () => console.log(`dev server: http://localhost:${PORT}`));
