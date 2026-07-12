/**
 * Realtime Presence Hub (docs/06-multiplayer, D-003/D-026).
 * A lightweight WebSocket layer that attaches to the existing HTTP server:
 * see other players walk around + map chat. Deliberately isolated from the
 * transactional REST layer — if this hub dies, the game keeps working.
 *
 * Channels: players on the same map share a channel of up to `maxPerChannel`
 * (50 per docs). When a channel is full the next player lands in "<map>#1", etc.
 *
 * Protocol (JSON):
 *  client → server : {t:'join', token, mapId} | {t:'move', x, y} (normalized 0..1)
 *                    {t:'chat', text} | {t:'refresh'}
 *  server → client : {t:'welcome', id, channel, players:[Player]}
 *                    {t:'add'|'update', p:Player} | {t:'move', id, x, y}
 *                    {t:'remove', id} | {t:'chat', id, name, text, ts} | {t:'error', key}
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';

export interface RealtimeDeps {
  httpServer: HttpServer;
  /** Verify a JWT and return the accountId, or throw. Injected by server-api (no secret here). */
  verifyToken: (token: string) => Promise<number> | number;
  /** Load presence-safe player info from the database (never trust the client). */
  loadPlayer: (accountId: number) => Promise<{ name: string; jobId: string; mapId: string } | null>;
  log: { info: (msg: string) => void; warn: (msg: string) => void };
  maxPerChannel?: number;
  validMaps?: string[];
}

interface Player { id: string; account: number; name: string; job: string; x: number; y: number; }

interface Conn {
  ws: WebSocket;
  player: Player;
  channel: string;
  lastMove: number;
  lastChat: number;
  moveCount: number;
  moveWindow: number;
}

const CHAT_MAX_LEN = 120;
const CHAT_COOLDOWN_MS = 1200;
const MOVES_PER_SEC = 15;

export function attachRealtime(deps: RealtimeDeps) {
  const maxPerChannel = deps.maxPerChannel ?? 50;
  const validMaps = new Set(deps.validMaps ?? ['town', 'grassland']);
  const wss = new WebSocketServer({ server: deps.httpServer, path: '/rt' });
  const channels = new Map<string, Map<string, Conn>>(); // channelKey -> connId -> Conn
  let seq = 0;

  function pickChannel(mapId: string): string {
    for (let i = 0; ; i++) {
      const key = i === 0 ? mapId : `${mapId}#${i}`;
      const ch = channels.get(key);
      if (!ch || ch.size < maxPerChannel) return key;
    }
  }

  function broadcast(channel: string, msg: unknown, exceptId?: string) {
    const ch = channels.get(channel);
    if (!ch) return;
    const data = JSON.stringify(msg);
    for (const [id, conn] of ch) {
      if (id === exceptId) continue;
      if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(data);
    }
  }

  function leave(connId: string, conn: Conn) {
    const ch = channels.get(conn.channel);
    if (ch?.delete(connId)) {
      if (ch.size === 0) channels.delete(conn.channel);
      broadcast(conn.channel, { t: 'remove', id: connId });
    }
  }

  wss.on('connection', (ws) => {
    const connId = `p${++seq}`;
    let conn: Conn | null = null;
    let joined = false;

    const send = (msg: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };

    // unauthenticated sockets get 10s to join, then are dropped
    const joinTimeout = setTimeout(() => { if (!joined) ws.close(); }, 10_000);

    ws.on('message', async (raw) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(raw)); } catch { return; }

      try {
        if (msg.t === 'join' && !joined) {
          const accountId = await deps.verifyToken(String(msg.token ?? ''));
          const info = await deps.loadPlayer(accountId);
          if (!info) { send({ t: 'error', key: 'error.rt.unknownAccount' }); ws.close(); return; }
          const mapId = String(msg.mapId ?? '');
          // presence map must match the map the server believes the player is on
          if (!validMaps.has(mapId) || mapId !== info.mapId) { send({ t: 'error', key: 'error.rt.wrongMap' }); ws.close(); return; }

          joined = true;
          clearTimeout(joinTimeout);
          const channel = pickChannel(mapId);
          conn = {
            ws,
            channel,
            player: { id: connId, account: accountId, name: info.name, job: info.jobId, x: 0.5, y: 0.7 },
            lastMove: 0, lastChat: 0, moveCount: 0, moveWindow: 0,
          };
          if (!channels.has(channel)) channels.set(channel, new Map());
          channels.get(channel)!.set(connId, conn);

          send({
            t: 'welcome', id: connId, channel,
            players: [...channels.get(channel)!.values()].map((c) => c.player),
          });
          broadcast(channel, { t: 'add', p: conn.player }, connId);
          return;
        }

        if (!conn) return; // everything below requires a joined connection

        if (msg.t === 'move') {
          const now = Date.now();
          const win = Math.floor(now / 1000);
          if (conn.moveWindow !== win) { conn.moveWindow = win; conn.moveCount = 0; }
          if (++conn.moveCount > MOVES_PER_SEC) return; // silently drop floods
          const x = clamp01(Number(msg.x)); const y = clamp01(Number(msg.y));
          if (Number.isNaN(x) || Number.isNaN(y)) return;
          conn.player.x = x; conn.player.y = y;
          broadcast(conn.channel, { t: 'move', id: connId, x, y }, connId);
          return;
        }

        if (msg.t === 'chat') {
          const now = Date.now();
          if (now - conn.lastChat < CHAT_COOLDOWN_MS) { send({ t: 'error', key: 'error.rt.chatCooldown' }); return; }
          const text = sanitizeChat(String(msg.text ?? ''));
          if (!text) return;
          conn.lastChat = now;
          broadcast(conn.channel, { t: 'chat', id: connId, name: conn.player.name, text, ts: now });
          return;
        }

        if (msg.t === 'refresh') {
          // job/name may change (e.g. job switch at the Job Master) — re-read from DB
          const info = await deps.loadPlayer(conn.player.account);
          if (info && info.mapId === conn.channel.split('#')[0]) {
            conn.player.name = info.name; conn.player.job = info.jobId;
            broadcast(conn.channel, { t: 'update', p: conn.player });
          }
          return;
        }
      } catch {
        send({ t: 'error', key: 'error.rt.auth' });
        ws.close();
      }
    });

    ws.on('close', () => {
      clearTimeout(joinTimeout);
      if (conn) leave(connId, conn);
    });
    ws.on('error', () => { /* close handler runs after */ });
  });

  deps.log.info('realtime presence hub attached at /rt');
  return {
    /** current channel occupancy — used by tests/monitoring */
    stats: () => Object.fromEntries([...channels.entries()].map(([k, v]) => [k, v.size])),
    close: () => wss.close(),
  };
}

function clamp01(n: number) { return Math.min(1, Math.max(0, n)); }

function sanitizeChat(text: string): string {
  const cleaned = text.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned.slice(0, CHAT_MAX_LEN);
}
