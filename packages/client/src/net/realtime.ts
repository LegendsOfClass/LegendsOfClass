/**
 * Realtime presence client (M2, D-026). Fails soft: if the socket can't connect,
 * the game keeps working without other players (D-003). Reconnects with backoff.
 */
import { EventBus } from '../EventBus';

const HTTP_BASE: string = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:3000');

function wsUrl(): string {
  if (HTTP_BASE) return HTTP_BASE.replace(/^http/, 'ws') + '/rt';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/rt`;
}

export interface RtPlayer { id: string; name: string; job: string; x: number; y: number; }

let ws: WebSocket | null = null;
let currentMap: string | null = null;
let wantedMap: string | null = null;
let myId: string | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let tokenProvider: () => string | null = () => null;

export function initRealtime(getToken: () => string | null) { tokenProvider = getToken; }

/** Join the presence channel for a map (call on entering town/field). */
export function rtJoin(mapId: string) {
  wantedMap = mapId;
  reconnect();
}

/** Leave presence entirely (logout / battle). */
export function rtLeave() {
  wantedMap = null;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  ws?.close();
  ws = null; currentMap = null; myId = null;
}

export function rtSendMove(x: number, y: number) {
  if (ws?.readyState === WebSocket.OPEN && currentMap) {
    ws.send(JSON.stringify({ t: 'move', x: round4(x), y: round4(y) }));
  }
}

export function rtSendChat(text: string) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'chat', text: text.slice(0, 120) }));
  else EventBus.emit('rt-status', 'offline');
}

/** Re-announce name/job after a job switch so others see the new sprite. */
export function rtRefresh() {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'refresh' }));
}

export function rtMyId() { return myId; }

function reconnect() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  ws?.close();
  ws = null; currentMap = null; myId = null;
  const mapId = wantedMap;
  const token = tokenProvider();
  if (!mapId || !token) return;

  let sock: WebSocket;
  try { sock = new WebSocket(wsUrl()); } catch { scheduleRetry(); return; }
  ws = sock;

  sock.onopen = () => sock.send(JSON.stringify({ t: 'join', token, mapId }));
  sock.onmessage = (ev) => {
    let m: any; try { m = JSON.parse(ev.data); } catch { return; }
    switch (m.t) {
      case 'welcome':
        retry = 0; currentMap = mapId; myId = m.id;
        EventBus.emit('rt-status', 'online');
        EventBus.emit('rt-welcome', { id: m.id, players: m.players as RtPlayer[] });
        break;
      case 'add': EventBus.emit('rt-add', m.p as RtPlayer); break;
      case 'update': EventBus.emit('rt-update', m.p as RtPlayer); break;
      case 'move': EventBus.emit('rt-move', m); break;
      case 'remove': EventBus.emit('rt-remove', m.id); break;
      case 'chat': EventBus.emit('rt-chat', m); break;
      case 'error':
        if (m.key === 'error.rt.chatCooldown') EventBus.emit('rt-chat-cooldown');
        break;
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return; // superseded by a newer connection
    currentMap = null; myId = null;
    EventBus.emit('rt-status', 'offline');
    if (wantedMap) scheduleRetry();
  };
  sock.onerror = () => { /* onclose follows */ };
}

function scheduleRetry() {
  const delay = Math.min(15_000, 1000 * 2 ** Math.min(retry++, 4)); // 1s→16s cap 15s
  retryTimer = setTimeout(reconnect, delay);
}

function round4(n: number) { return Math.round(n * 10_000) / 10_000; }
