import type { GameEvent, GameState } from '@order-board/rules';
import type { RoomDto } from './api';

export type ServerMessage =
  | { type: 'hello'; user: { id: string; username: string; isTemp: boolean } }
  | { type: 'room_updated'; room: RoomDto; state?: GameState | null }
  | { type: 'game_started'; room: RoomDto; state: GameState; events: GameEvent[] }
  | { type: 'state'; state: GameState; events: GameEvent[] }
  | { type: 'error'; error: string }
  | { type: 'left' }
  | { type: string; [key: string]: unknown };

export type RoomIntent =
  | { type: 'join_room'; roomCode: string }
  | {
      type: 'add_seat';
      roomCode: string;
      displayName?: string;
      role?: 'dominant' | 'submissive' | null;
      avatarSeed?: string;
    }
  | { type: 'remove_seat'; roomCode: string; seatId: string }
  | { type: 'start_game'; roomCode: string }
  | { type: 'pick_start'; roomCode: string; cellId: string }
  | { type: 'roll'; roomCode: string }
  | { type: 'choose_exit'; roomCode: string; exitId: string }
  | { type: 'confirm_order'; roomCode: string }
  | { type: 'leave' }
  | { type: 'sync'; roomCode: string };

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/** 房间 WebSocket 客户端：发意图、收广播 */
export class RoomSocket {
  private socket: WebSocket | null = null;
  private queue: RoomIntent[] = [];
  private onMessage: (msg: ServerMessage) => void;
  private onStatus: (status: 'connecting' | 'open' | 'closed') => void;

  constructor(handlers: {
    onMessage: (msg: ServerMessage) => void;
    onStatus?: (status: 'connecting' | 'open' | 'closed') => void;
  }) {
    this.onMessage = handlers.onMessage;
    this.onStatus = handlers.onStatus ?? (() => {});
  }

  connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.onStatus('connecting');
    const socket = new WebSocket(wsUrl());
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.onStatus('open');
      for (const msg of this.queue) socket.send(JSON.stringify(msg));
      this.queue = [];
    });
    socket.addEventListener('message', (ev) => {
      try {
        this.onMessage(JSON.parse(String(ev.data)) as ServerMessage);
      } catch {
        /* ignore */
      }
    });
    socket.addEventListener('close', () => {
      this.onStatus('closed');
      this.socket = null;
    });
  }

  send(intent: RoomIntent) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(intent));
    } else {
      this.queue.push(intent);
      this.connect();
    }
  }

  close() {
    this.queue = [];
    this.socket?.close();
    this.socket = null;
  }
}
