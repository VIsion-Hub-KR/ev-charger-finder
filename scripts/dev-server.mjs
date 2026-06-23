// 로컬 개발 서버: public/ 정적 파일 + /api/chargers 서버리스 핸들러를 함께 제공.
// 실행: node --env-file=.env.local scripts/dev-server.mjs  (포트 3000)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import handler from '../api/chargers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (nodeReq, nodeRes) => {
  const url = new URL(nodeReq.url, `http://localhost:${PORT}`);

  // API route → Vercel 스타일 핸들러 호출
  if (url.pathname === '/api/chargers') {
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
    return;
  }

  // 정적 파일
  let path = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const buf = await readFile(join(root, path));
    nodeRes.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    nodeRes.end(buf);
  } catch {
    nodeRes.writeHead(404); nodeRes.end('not found');
  }
});

server.listen(PORT, () => console.log(`dev server: http://localhost:${PORT}`));
