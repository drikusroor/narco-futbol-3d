import { decodeSnapshot, encodeInputBatch, type Snapshot } from '@shared/protocol.js';
import type { ClientMessage, PlayerInput, ServerMessage } from '@shared/types.js';
import { isDiscordActivity } from '../discord.js';

export interface SocketHandlers {
  onSnapshot(snap: Snapshot, receivedAt: number): void;
  onMessage(msg: ServerMessage): void;
  onOpen(): void;
  onClose(reason: string): void;
}

export interface JoinOptions {
  room: string;
  name: string;
  team?: number;
}

/**
 * Thin wrapper over the WebSocket: binary frames are snapshots in and inputs
 * out, text frames are lobby chatter. Reconnects are the caller's business -
 * a dropped connection drops you back to the menu.
 */
export class GameSocket {
  private ws: WebSocket | null = null;
  private handlers: SocketHandlers;
  private sendQueue: PlayerInput[] = [];
  /** Round trip time in milliseconds, from the server's ping. */
  ping = 0;
  connected = false;

  constructor(handlers: SocketHandlers) {
    this.handlers = handlers;
  }

  connect(opts: JoinOptions): void {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Inside Discord every request has to go through the activity proxy.
    const path = isDiscordActivity() ? '/.proxy/ws' : '/ws';
    const params = new URLSearchParams({ room: opts.room, name: opts.name });
    if (opts.team === 0 || opts.team === 1) params.set('team', String(opts.team));
    const url = `${proto}//${location.host}${path}?${params.toString()}`;

    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.handlers.onOpen();
    };
    ws.onclose = (e) => {
      this.connected = false;
      this.handlers.onClose(e.reason || 'connection closed');
    };
    ws.onerror = () => {
      // onclose always follows; nothing useful to report here.
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data) as ServerMessage;
        } catch {
          return;
        }
        if (msg.t === 'ping') {
          this.send({ t: 'pong', time: msg.time });
          return;
        }
        this.handlers.onMessage(msg);
        return;
      }
      const snap = decodeSnapshot(ev.data as ArrayBuffer);
      if (snap) this.handlers.onSnapshot(snap, performance.now());
    };
  }

  /** Queue an input; the batch is flushed once per frame with redundancy. */
  queueInput(input: PlayerInput): void {
    this.sendQueue.push(input);
    if (this.sendQueue.length > 8) this.sendQueue.shift();
  }

  flush(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sendQueue.length) return;
    this.ws.send(encodeInputBatch(this.sendQueue));
    // Keep the last couple so a lost packet still carries the newest presses.
    this.sendQueue = this.sendQueue.slice(-2);
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}

export type { Snapshot };
