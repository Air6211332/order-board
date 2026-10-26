import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import {
  getUserFromRequest,
  getUserFromSessionId,
  SESSION_COOKIE,
  type AuthUser,
} from './auth.js';
import {
  addSeat,
  destroyRoom,
  enterRoom,
  getRoomDto,
  getRuntimeState,
  removeSeat,
  ROOM_EMPTY_GRACE_MS,
  roomChooseExit,
  roomConfirmOrder,
  roomPickStart,
  roomRoll,
  setRoomBroadcast,
  startRoomGame,
} from './rooms.js';

/** 从原始 Cookie 头解析会话（WS 升级时 @fastify/cookie 有时未填充） */
function userFromCookieHeader(request: FastifyRequest): AuthUser | null {
  const fromPlugin = getUserFromRequest(request);
  if (fromPlugin) return fromPlugin;

  const raw = request.headers.cookie;
  if (!raw) return null;
  const match = raw.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  const sessionId = match?.[1] ? decodeURIComponent(match[1]) : null;
  if (!sessionId) return null;
  return getUserFromSessionId(sessionId);
}

interface ClientMeta {
  user: AuthUser;
  roomCode: string | null;
}

const roomClients = new Map<string, Set<WebSocket>>();
const clientMeta = new WeakMap<WebSocket, ClientMeta>();
/** 空订销毁定时器 */
const emptyDestroyTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelEmptyDestroy(code: string) {
  const t = emptyDestroyTimers.get(code);
  if (t) {
    clearTimeout(t);
    emptyDestroyTimers.delete(code);
  }
}

function scheduleEmptyDestroy(code: string) {
  cancelEmptyDestroy(code);
  const timer = setTimeout(() => {
    emptyDestroyTimers.delete(code);
    const set = roomClients.get(code);
    if (set && set.size > 0) return;
    destroyRoom(code);
  }, ROOM_EMPTY_GRACE_MS);
  emptyDestroyTimers.set(code, timer);
}

function subscribe(socket: WebSocket, code: string) {
  const upper = code.toUpperCase();
  cancelEmptyDestroy(upper);
  let set = roomClients.get(upper);
  if (!set) {
    set = new Set();
    roomClients.set(upper, set);
  }
  set.add(socket);
  const meta = clientMeta.get(socket);
  if (meta) meta.roomCode = upper;
}

function unsubscribe(socket: WebSocket) {
  const meta = clientMeta.get(socket);
  if (!meta?.roomCode) return;
  const code = meta.roomCode;
  const set = roomClients.get(code);
  set?.delete(socket);
  if (set && set.size === 0) {
    roomClients.delete(code);
    scheduleEmptyDestroy(code);
  }
  meta.roomCode = null;
}

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export function broadcastToRoom(roomCode: string, payload: unknown) {
  const set = roomClients.get(roomCode.toUpperCase());
  if (!set) return;
  const raw = JSON.stringify(payload);
  for (const socket of set) {
    if (socket.readyState === socket.OPEN) socket.send(raw);
  }
}

type Incoming = {
  type: string;
  roomCode?: string;
  seatId?: string;
  displayName?: string;
  exitId?: string;
  cellId?: string;
};

export async function registerWebsocket(app: FastifyInstance) {
  await app.register(websocket);
  setRoomBroadcast(broadcastToRoom);

  app.get('/ws', { websocket: true }, (socket, request) => {
    const user = userFromCookieHeader(request);
    if (!user) {
      send(socket, { type: 'error', error: '未登录' });
      socket.close();
      return;
    }
    clientMeta.set(socket, { user, roomCode: null });
    send(socket, { type: 'hello', user: { id: user.id, username: user.username, isTemp: user.isTemp } });

    socket.on('message', (raw: WebSocket.RawData) => {
      let msg: Incoming;
      try {
        msg = JSON.parse(String(raw)) as Incoming;
      } catch {
        send(socket, { type: 'error', error: '无效消息' });
        return;
      }

      const code = (msg.roomCode ?? '').toUpperCase();
      const meta = clientMeta.get(socket)!;

      const handle = () => {
        switch (msg.type) {
          case 'join_room': {
            if (!code) {
              send(socket, { type: 'error', error: '缺少房间码' });
              return;
            }
            // 大厅进入或对局中重连（已有座位）
            const result = enterRoom(code, meta.user.id);
            if (!result.ok) {
              send(socket, { type: 'error', error: result.error });
              return;
            }
            unsubscribe(socket);
            subscribe(socket, result.room.code);
            send(socket, {
              type: 'room_updated',
              room: result.room,
              state: result.state,
            });
            return;
          }
          case 'add_seat': {
            if (!code) {
              send(socket, { type: 'error', error: '缺少房间码' });
              return;
            }
            const result = addSeat(code, meta.user.id, msg.displayName ?? '');
            if (!result.ok) send(socket, { type: 'error', error: result.error });
            return;
          }
          case 'remove_seat': {
            if (!code || !msg.seatId) {
              send(socket, { type: 'error', error: '缺少参数' });
              return;
            }
            const result = removeSeat(code, meta.user.id, msg.seatId);
            if (!result.ok) send(socket, { type: 'error', error: result.error });
            return;
          }
          case 'start_game': {
            if (!code) {
              send(socket, { type: 'error', error: '缺少房间码' });
              return;
            }
            const result = startRoomGame(code, meta.user.id);
            if (!result.ok) send(socket, { type: 'error', error: result.error });
            return;
          }
          case 'pick_start': {
            if (!code || !msg.cellId) {
              send(socket, { type: 'error', error: '缺少参数' });
              return;
            }
            const result = roomPickStart(code, meta.user.id, msg.cellId);
            if (!result.ok) send(socket, { type: 'error', error: result.error });
            return;
          }
          case 'roll': {
            if (!code) {
              send(socket, { type: 'error', error: '缺少房间码' });
              return;
            }
            const result = roomRoll(code, meta.user.id);
            if (!result.ok) send(socket, { type: 'error', error: result.error });
            return;
          }
          case 'choose_exit': {
            if (!code || !msg.exitId) {
              send(socket, { type: 'error', error: '缺少参数' });
              return;
            }
            const result = roomChooseExit(code, meta.user.id, msg.exitId);
            if (!result.ok) send(socket, { type: 'error', error: result.error });
            return;
          }
          case 'confirm_order': {
            if (!code) {
              send(socket, { type: 'error', error: '缺少房间码' });
              return;
            }
            const result = roomConfirmOrder(code, meta.user.id);
            if (!result.ok) send(socket, { type: 'error', error: result.error });
            return;
          }
          case 'leave': {
            unsubscribe(socket);
            send(socket, { type: 'left' });
            return;
          }
          case 'sync': {
            if (!code) {
              send(socket, { type: 'error', error: '缺少房间码' });
              return;
            }
            const room = getRoomDto(code);
            if (!room) {
              send(socket, { type: 'error', error: '房间不存在' });
              return;
            }
            send(socket, { type: 'room_updated', room, state: getRuntimeState(code) });
            return;
          }
          default:
            send(socket, { type: 'error', error: `未知消息类型: ${msg.type}` });
        }
      };

      try {
        handle();
      } catch (e) {
        send(socket, { type: 'error', error: e instanceof Error ? e.message : '处理失败' });
      }
    });

    socket.on('close', () => {
      unsubscribe(socket);
    });
  });
}
