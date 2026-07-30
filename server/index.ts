import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';

import { decodeInputBatch } from '@shared/protocol.js';
import type { ClientMessage } from '@shared/types.js';
import { Room } from './room.js';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 40);

const here = path.dirname(fileURLToPath(import.meta.url));
// In the built bundle this file lives at dist/server.js next to dist/public.
const PUBLIC_DIR = fs.existsSync(path.join(here, 'public'))
  ? path.join(here, 'public')
  : path.resolve(here, '../dist/public');

const rooms = new Map<string, Room>();

function getRoom(name: string): Room | null {
  const key = normalizeRoom(name);
  let room = rooms.get(key);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) return null;
    room = new Room(key);
    rooms.set(key, room);
    log(`room "${key}" created (${rooms.size} live)`);
  }
  return room;
}

function normalizeRoom(name: string): string {
  const cleaned = (name || 'estadio').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  return cleaned || 'estadio';
}

// Reap rooms that nobody has been in for a while.
setInterval(() => {
  for (const [key, room] of rooms) {
    if (!room.isEmpty) {
      emptySince.delete(key);
      continue;
    }
    const since = emptySince.get(key) ?? Date.now();
    emptySince.set(key, since);
    if (Date.now() - since > 120_000) {
      room.dispose();
      rooms.delete(key);
      emptySince.delete(key);
      log(`room "${key}" reaped`);
    }
  }
}, 30_000);
const emptySince = new Map<string, number>();

// --- static file serving -----------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // Discord serves activities behind /.proxy/ - strip it so the same build works.
  let pathname = url.pathname.replace(/^\/\.proxy/, '');
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const target = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      // SPA fallback so deep links still boot the game.
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, html) => {
        if (err2) {
          res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
          return;
        }
        res.writeHead(200, { 'content-type': MIME['.html'] }).end(html);
      });
      return;
    }
    const ext = path.extname(target);
    const headers: Record<string, string> = { 'content-type': MIME[ext] ?? 'application/octet-stream' };
    if (ext !== '.html') headers['cache-control'] = 'public, max-age=3600';
    res.writeHead(200, headers).end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname.replace(/^\/\.proxy/, '');

  if (pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({ ok: true, rooms: rooms.size, uptime: process.uptime() }),
    );
    return;
  }
  if (pathname === '/api/rooms') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify([...rooms.values()].map((r) => r.status)),
    );
    return;
  }
  serveStatic(req, res);
});

// --- websockets --------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname.replace(/^\/\.proxy/, '');
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const roomName = normalizeRoom(url.searchParams.get('room') ?? 'estadio');
  const rawName = (url.searchParams.get('name') ?? '').trim();
  const teamParam = url.searchParams.get('team');
  const preferred = teamParam === '0' ? 0 : teamParam === '1' ? 1 : undefined;

  const room = getRoom(roomName);
  if (!room) {
    ws.close(4001, 'server full');
    return;
  }

  const name = sanitizeName(rawName);
  const client = room.join(
    {
      send: (data: string | ArrayBuffer) => {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(data, { binary: typeof data !== 'string' });
      },
      close: () => ws.close(),
    },
    name,
    preferred,
  );

  if (!client) {
    ws.close(4002, 'room full');
    return;
  }

  ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    try {
      if (isBinary) {
        const buf = Array.isArray(data) ? Buffer.concat(data) : data;
        const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        room.handleInput(client, decodeInputBatch(bytes));
        return;
      }
      const text = data.toString();
      if (text.length > 4096) return;
      const msg = JSON.parse(text) as ClientMessage;
      room.handleJson(client, msg);
    } catch {
      // Malformed traffic from a client is never worth crashing a match over.
    }
  });

  ws.on('close', () => room.leave(client.id));
  ws.on('error', () => room.leave(client.id));
});

function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18);
  if (cleaned) return cleaned;
  return `Anon${Math.floor(Math.random() * 900 + 100)}`;
}

function log(msg: string): void {
  console.log(`[narco] ${new Date().toISOString()} ${msg}`);
}

server.listen(PORT, HOST, () => {
  log(`serving ${PUBLIC_DIR}`);
  log(`listening on http://${HOST}:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log(`${sig} - shutting down`);
    for (const room of rooms.values()) room.dispose();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
