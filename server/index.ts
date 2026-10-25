import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

export type MatchState = 'LOBBY' | 'COUNTDOWN' | 'ACTIVE' | 'PODIUM';

export interface PlayerNetState {
  id: string;
  name: string;
  color: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  state: 'grounded' | 'airborne' | 'dashing' | 'dead';
  ups: number;
  topUps: number;
  strafeSync: number;
  alive: boolean;
  distance: number;
}

interface RoomState {
  roomId: string;
  matchState: MatchState;
  matchSeed: number;
  countdownRemaining: number;
  matchElapsedSec: number;
  players: Map<string, { ws: WebSocket; data: PlayerNetState }>;
}

const PORT = Number(process.env.PORT || 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const NEON_PALETTE = [
  0x00f3ff, // Cyan
  0xff007f, // Magenta
  0x00ff66, // Electric Lime
  0xffbe0b, // Cyber Amber
  0x8338ec, // Neon Violet
  0xff4d00, // Plasma Orange
];

const rooms = new Map<string, RoomState>();
let nextClientNum = 1;

function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      roomId,
      matchState: 'LOBBY',
      matchSeed: 1337420,
      countdownRemaining: 0,
      matchElapsedSec: 0,
      players: new Map(),
    };
    rooms.set(roomId, room);
  }
  return room;
}

function broadcastRoomState(room: RoomState): void {
  const payload = JSON.stringify({
    type: 'room_state',
    roomId: room.roomId,
    matchState: room.matchState,
    matchSeed: room.matchSeed,
    countdownRemaining: room.countdownRemaining,
    matchElapsedSec: room.matchElapsedSec,
    players: Array.from(room.players.values()).map((p) => p.data),
  });

  for (const { ws } of room.players.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        status: 'ok',
        rooms: rooms.size,
        uptime: Math.round(process.uptime()),
      })
    );
    return;
  }

  // Serve built Vite static files from dist/
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const safeFilePath = path.resolve(DIST_DIR, `.${requestedPath}`);

  if (!safeFilePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const serveFile = (filePath: string) => {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        // Fallback to index.html for SPA routes if available
        const indexHtml = path.join(DIST_DIR, 'index.html');
        if (filePath !== indexHtml && fs.existsSync(indexHtml)) {
          serveFile(indexHtml);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('GRIDRUNNER Multiplayer Server Online. Run `npm run build` to serve static client assets.');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  };

  serveFile(safeFilePath);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const requestedRoom = url.searchParams.get('room') || 'default';
  const room = getOrCreateRoom(requestedRoom);

  const clientIndex = nextClientNum++;
  const playerId = `runner_${clientIndex}`;
  const color = NEON_PALETTE[(clientIndex - 1) % NEON_PALETTE.length];

  const initialPlayer: PlayerNetState = {
    id: playerId,
    name: `RUNNER-${clientIndex}`,
    color,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    state: 'grounded',
    ups: 0,
    topUps: 0,
    strafeSync: 0,
    alive: true,
    distance: 0,
  };

  room.players.set(playerId, { ws, data: initialPlayer });

  ws.send(
    JSON.stringify({
      type: 'welcome',
      playerId,
      color,
      roomId: room.roomId,
      matchState: room.matchState,
      matchSeed: room.matchSeed,
    })
  );

  broadcastRoomState(room);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const entry = room.players.get(playerId);
      if (!entry) return;

      if (msg.type === 'player_update') {
        entry.data.x = Number(msg.x) || 0;
        entry.data.y = Number(msg.y) || 0;
        entry.data.z = Number(msg.z) || 0;
        entry.data.vx = Number(msg.vx) || 0;
        entry.data.vy = Number(msg.vy) || 0;
        entry.data.vz = Number(msg.vz) || 0;
        entry.data.yaw = Number(msg.yaw) || 0;
        entry.data.state = msg.state || 'grounded';
        entry.data.ups = Number(msg.ups) || 0;
        entry.data.topUps = Math.max(
          entry.data.topUps,
          Number(msg.topUps) || entry.data.ups
        );
        entry.data.strafeSync = Number(msg.strafeSync) || 0;
        entry.data.alive = msg.alive !== false;
        entry.data.distance = Number(msg.distance) || 0;

        // Check if all players were eliminated during an active match
        if (room.matchState === 'ACTIVE' && room.players.size > 0) {
          const anyAlive = Array.from(room.players.values()).some(
            (p) => p.data.alive
          );
          if (!anyAlive && room.matchElapsedSec > 1.5) {
            room.matchState = 'PODIUM';
            broadcastRoomState(room);
          }
        }
      } else if (msg.type === 'start_match' || msg.type === 'rematch') {
        const seed =
          typeof msg.seed === 'number'
            ? msg.seed >>> 0
            : ((Date.now() ^ 0x5f3759df) >>> 0) || 1337420;
        room.matchSeed = seed;
        room.matchElapsedSec = 0;

        // Reset player stats for the new match
        let slot = 0;
        const count = room.players.size;
        for (const p of room.players.values()) {
          const laneX =
            count > 1 ? (slot - (count - 1) * 0.5) * 90 : 0;
          slot++;
          p.data.x = laneX;
          p.data.y = 0;
          p.data.z = 0;
          p.data.vx = 0;
          p.data.vy = 0;
          p.data.vz = 0;
          p.data.ups = 0;
          p.data.topUps = 0;
          p.data.strafeSync = 0;
          p.data.alive = true;
          p.data.distance = 0;
        }

        const instant = Boolean(msg.instant);
        if (instant) {
          room.matchState = 'ACTIVE';
          room.countdownRemaining = 0;
        } else {
          room.matchState = 'COUNTDOWN';
          room.countdownRemaining = 3.0;
        }
        broadcastRoomState(room);
      } else if (msg.type === 'end_match') {
        room.matchState = 'PODIUM';
        broadcastRoomState(room);
      }
    } catch {
      // Ignore malformed JSON
    }
  });

  ws.on('close', () => {
    room.players.delete(playerId);
    if (room.players.size === 0) {
      room.matchState = 'LOBBY';
      if (room.roomId !== 'default') {
        rooms.delete(room.roomId);
      }
    } else {
      broadcastRoomState(room);
    }
  });
});

// 25s WebSocket heartbeat so cloud reverse proxies (Render, Railway, Fly.io) keep connections open
setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.ping();
    }
  }
}, 25000);

// 25Hz (40ms) Server Room Tick & State Broadcast
const SERVER_DT = 0.04;
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size === 0) continue;

    if (room.matchState === 'COUNTDOWN') {
      room.countdownRemaining = Math.max(
        0,
        room.countdownRemaining - SERVER_DT
      );
      if (room.countdownRemaining <= 0) {
        room.matchState = 'ACTIVE';
        room.matchElapsedSec = 0;
      }
    } else if (room.matchState === 'ACTIVE') {
      room.matchElapsedSec += SERVER_DT;
      // 2.5-minute (150s) max match duration
      if (room.matchElapsedSec >= 150) {
        room.matchState = 'PODIUM';
      }
    }

    broadcastRoomState(room);
  }
}, 40);

server.listen(PORT, () => {
  console.log(
    `[GRIDRUNNER] HTTP + WebSocket multiplayer server listening on http://localhost:${PORT}`
  );
});
