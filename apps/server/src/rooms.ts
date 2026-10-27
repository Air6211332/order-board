import {
  chooseExit,
  confirmOrder,
  pickStart,
  roll,
  startGame,
  type BoardDefinition,
  type GameEvent,
  type GameState,
} from '@order-board/rules';
import { customAlphabet } from 'nanoid';
import { newId } from './auth.js';
import { getBoardPlayMode, normalizePlayMode, toPlayableBoard } from './boards.js';
import { db, withTransaction } from './db.js';
import type { PlayMode } from './boards.js';

const roomCodeAlphabet = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 6);
const avatarSeedAlphabet = customAlphabet(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  10,
);
const MAX_SEATS_MULTI = 6;
const MAX_SEATS_SOLO = 1;

export type SeatRole = 'dominant' | 'submissive';

function normalizeSeatRole(raw: unknown): SeatRole | null {
  return raw === 'dominant' || raw === 'submissive' ? raw : null;
}

/** 生成 DiceBear 用 seed */
export function newAvatarSeed(): string {
  return avatarSeedAlphabet();
}
/** 兜底：长时间无 last_active 仍清理 */
const ROOM_IDLE_MS = 30 * 60 * 1000;
/** WS 订阅归零后的销毁宽限期 */
export const ROOM_EMPTY_GRACE_MS = 3 * 60 * 1000;

export type RoomStatus = 'lobby' | 'playing' | 'ended';
export type RoomVisibility = 'public' | 'private';

export interface RoomSeatDto {
  id: string;
  userId: string;
  displayName: string;
  sortOrder: number;
  role: SeatRole | null;
  avatarSeed: string;
}

export interface RoomDto {
  code: string;
  hostUserId: string;
  boardId: string | null;
  boardName: string;
  playMode: PlayMode;
  status: RoomStatus;
  visibility: RoomVisibility;
  seats: RoomSeatDto[];
  createdAt: number;
  updatedAt: number;
}

export interface PublicRoomSummary {
  code: string;
  boardName: string;
  status: RoomStatus;
  seatCount: number;
  hostUsername: string;
  updatedAt: number;
}

export interface RoomRuntime {
  code: string;
  hostUserId: string;
  boardSnapshot: BoardDefinition;
  status: RoomStatus;
  /** playerId → userId */
  seatOwner: Map<string, string>;
  gameState: GameState | null;
}

const runtimes = new Map<string, RoomRuntime>();

type BroadcastFn = (roomCode: string, payload: unknown) => void;
let broadcast: BroadcastFn = () => {};

export function setRoomBroadcast(fn: BroadcastFn) {
  broadcast = fn;
}

function touchRoom(code: string) {
  const now = Date.now();
  db.prepare('UPDATE rooms SET updated_at = ?, last_active_at = ? WHERE code = ?').run(
    now,
    now,
    code,
  );
}

function loadSeats(code: string): RoomSeatDto[] {
  const rows = db
    .prepare(
      `SELECT id, user_id AS userId, display_name AS displayName,
              sort_order AS sortOrder, role, avatar_seed AS avatarSeed
       FROM room_seats WHERE room_code = ? ORDER BY sort_order, created_at`,
    )
    .all(code) as Array<{
    id: string;
    userId: string;
    displayName: string;
    sortOrder: number;
    role: string | null;
    avatarSeed: string | null;
  }>;
  const fill = db.prepare(`UPDATE room_seats SET avatar_seed = ? WHERE id = ?`);
  return rows.map((r) => {
    let avatarSeed = (r.avatarSeed ?? '').trim();
    if (!avatarSeed) {
      avatarSeed = newAvatarSeed();
      fill.run(avatarSeed, r.id);
    }
    return {
      id: r.id,
      userId: r.userId,
      displayName: r.displayName,
      sortOrder: r.sortOrder,
      role: normalizeSeatRole(r.role),
      avatarSeed,
    };
  });
}

function roomPlayMode(boardId: string | null, boardSnapshot: string): PlayMode {
  if (boardId) {
    const mode = getBoardPlayMode(boardId);
    if (mode) return mode;
  }
  try {
    const snap = JSON.parse(boardSnapshot) as { playMode?: string };
    return normalizePlayMode(snap.playMode);
  } catch {
    return 'multi';
  }
}

function maxSeatsFor(playMode: PlayMode): number {
  return playMode === 'solo' ? MAX_SEATS_SOLO : MAX_SEATS_MULTI;
}

function normalizeRoomVisibility(raw: unknown): RoomVisibility {
  return raw === 'private' ? 'private' : 'public';
}

function getRoomRow(code: string) {
  return db
    .prepare(
      `SELECT code, host_user_id AS hostUserId, board_id AS boardId, board_snapshot AS boardSnapshot,
              game_state AS gameState, status, visibility,
              created_at AS createdAt, updated_at AS updatedAt
       FROM rooms WHERE code = ?`,
    )
    .get(code.toUpperCase()) as
    | {
        code: string;
        hostUserId: string;
        boardId: string | null;
        boardSnapshot: string;
        gameState: string | null;
        status: RoomStatus;
        visibility: string;
        createdAt: number;
        updatedAt: number;
      }
    | undefined;
}

/** 将对局状态写入 SQLite，便于刷新/重启后恢复 */
function persistGameState(rt: RoomRuntime) {
  const now = Date.now();
  db.prepare(
    `UPDATE rooms SET status = ?, game_state = ?, updated_at = ?, last_active_at = ? WHERE code = ?`,
  ).run(rt.status, rt.gameState ? JSON.stringify(rt.gameState) : null, now, now, rt.code);
}

export function getRoomDto(code: string): RoomDto | null {
  const row = getRoomRow(code);
  if (!row) return null;
  const board = JSON.parse(row.boardSnapshot) as BoardDefinition;
  return {
    code: row.code,
    hostUserId: row.hostUserId,
    boardId: row.boardId,
    boardName: board.name,
    playMode: roomPlayMode(row.boardId, row.boardSnapshot),
    status: row.status,
    visibility: normalizeRoomVisibility(row.visibility),
    seats: loadSeats(row.code),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 大厅公开房间列表 */
export function listPublicRooms(): PublicRoomSummary[] {
  return db
    .prepare(
      `SELECT r.code, r.status, r.updated_at AS updatedAt, r.board_snapshot AS boardSnapshot,
              u.username AS hostUsername,
              (SELECT COUNT(*) FROM room_seats s WHERE s.room_code = r.code) AS seatCount
       FROM rooms r
       JOIN users u ON u.id = r.host_user_id
       WHERE r.visibility = 'public' AND r.status IN ('lobby', 'playing')
       ORDER BY r.updated_at DESC
       LIMIT 100`,
    )
    .all()
    .map((row) => {
      const r = row as {
        code: string;
        status: RoomStatus;
        updatedAt: number;
        boardSnapshot: string;
        hostUsername: string;
        seatCount: number;
      };
      let boardName = '棋盘';
      try {
        boardName = (JSON.parse(r.boardSnapshot) as BoardDefinition).name || boardName;
      } catch {
        /* ignore */
      }
      return {
        code: r.code,
        boardName,
        status: r.status,
        seatCount: Number(r.seatCount) || 0,
        hostUsername: r.hostUsername,
        updatedAt: r.updatedAt,
      };
    });
}

/** 删除房间（库 + 内存） */
export function destroyRoom(code: string): boolean {
  const upper = code.toUpperCase();
  runtimes.delete(upper);
  const result = db.prepare('DELETE FROM rooms WHERE code = ?').run(upper);
  return Number(result.changes ?? 0) > 0;
}

function ensureRuntime(code: string): RoomRuntime | null {
  const upper = code.toUpperCase();
  const existing = runtimes.get(upper);
  if (existing) return existing;
  const row = getRoomRow(upper);
  if (!row) return null;
  const board = JSON.parse(row.boardSnapshot) as BoardDefinition;
  const seats = loadSeats(upper);
  const seatOwner = new Map(seats.map((s) => [s.id, s.userId]));
  let gameState: GameState | null = null;
  if (row.gameState) {
    try {
      gameState = JSON.parse(row.gameState) as GameState;
    } catch {
      gameState = null;
    }
  }
  const rt: RoomRuntime = {
    code: upper,
    hostUserId: row.hostUserId,
    boardSnapshot: board,
    status: row.status,
    seatOwner,
    gameState,
  };
  runtimes.set(upper, rt);
  return rt;
}

function emitRoomUpdated(code: string) {
  const dto = getRoomDto(code);
  if (dto) broadcast(code, { type: 'room_updated', room: dto });
}

export function createRoom(
  hostUserId: string,
  boardId: string,
  hostDisplayName: string,
  visibility: RoomVisibility = 'public',
  opts?: { role?: SeatRole | null; avatarSeed?: string },
): { ok: true; room: RoomDto } | { ok: false; error: string } {
  const playable = toPlayableBoard(hostUserId, boardId);
  if (!playable.ok) return { ok: false, error: playable.error };
  const playMode = getBoardPlayMode(boardId) ?? 'multi';
  let vis = normalizeRoomVisibility(visibility);
  if (playMode === 'solo') {
    if (vis === 'public') return { ok: false, error: '单人棋盘只能开私有房' };
    vis = 'private';
  }

  let code = roomCodeAlphabet();
  for (let i = 0; i < 8; i++) {
    const clash = db.prepare('SELECT code FROM rooms WHERE code = ?').get(code);
    if (!clash) break;
    code = roomCodeAlphabet();
  }

  let avatarSeed = newAvatarSeed();
  if (opts?.avatarSeed != null) {
    const trimmed = opts.avatarSeed.trim();
    if (!trimmed) return { ok: false, error: '头像 seed 不能为空' };
    if (trimmed.length > 64) return { ok: false, error: '头像 seed 过长' };
    avatarSeed = trimmed;
  }
  const role = opts?.role != null ? normalizeSeatRole(opts.role) : null;

  const now = Date.now();
  const seatId = newId('seat');
  // 快照附带 playMode，便于恢复
  const snapshot = JSON.stringify({ ...playable.board, playMode });

  withTransaction(() => {
    db.prepare(
      `INSERT INTO rooms (code, host_user_id, board_id, board_snapshot, status, visibility, created_at, updated_at, last_active_at)
       VALUES (?, ?, ?, ?, 'lobby', ?, ?, ?, ?)`,
    ).run(code, hostUserId, boardId, snapshot, vis, now, now, now);
    db.prepare(
      `INSERT INTO room_seats (id, room_code, user_id, display_name, sort_order, role, avatar_seed, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(
      seatId,
      code,
      hostUserId,
      hostDisplayName.trim() || '玩家1',
      role,
      avatarSeed,
      now,
    );
  });

  runtimes.set(code, {
    code,
    hostUserId,
    boardSnapshot: playable.board,
    status: 'lobby',
    seatOwner: new Map([[seatId, hostUserId]]),
    gameState: null,
  });

  return { ok: true, room: getRoomDto(code)! };
}

/**
 * 进入房间（大厅可进；对局中/结束后仅已有座位的用户可重连）。
 * 用于 HTTP 与 WS 订阅，刷新后应走此路径而非当作「新加入」。
 */
export function enterRoom(
  code: string,
  userId: string,
): { ok: true; room: RoomDto; state: GameState | null } | { ok: false; error: string } {
  const row = getRoomRow(code);
  if (!row) return { ok: false, error: '房间不存在' };
  const seats = loadSeats(row.code);
  const hasSeat = seats.some((s) => s.userId === userId);
  if (row.status !== 'lobby' && !hasSeat) {
    return { ok: false, error: '对局已开始，且你不在本局座位中' };
  }
  ensureRuntime(row.code);
  touchRoom(row.code);
  return { ok: true, room: getRoomDto(row.code)!, state: getRuntimeState(row.code) };
}

/** @deprecated 兼容旧调用：等同 enterRoom */
export function joinRoom(
  code: string,
  userId: string,
): { ok: true; room: RoomDto } | { ok: false; error: string } {
  const result = enterRoom(code, userId);
  if (!result.ok) return result;
  return { ok: true, room: result.room };
}

export function addSeat(
  code: string,
  userId: string,
  displayName: string,
  opts?: { role?: SeatRole | null; avatarSeed?: string },
): { ok: true; room: RoomDto } | { ok: false; error: string } {
  const row = getRoomRow(code);
  if (!row) return { ok: false, error: '房间不存在' };
  if (row.status !== 'lobby') return { ok: false, error: '对局已开始，无法加座' };
  const seats = loadSeats(row.code);
  const playMode = roomPlayMode(row.boardId, row.boardSnapshot);
  const maxSeats = maxSeatsFor(playMode);
  if (seats.length >= maxSeats) {
    return {
      ok: false,
      error: playMode === 'solo' ? '单人模式只能有一个座位' : `最多 ${maxSeats} 个座位`,
    };
  }

  let avatarSeed = newAvatarSeed();
  if (opts?.avatarSeed != null) {
    const trimmed = opts.avatarSeed.trim();
    if (!trimmed) return { ok: false, error: '头像 seed 不能为空' };
    if (trimmed.length > 64) return { ok: false, error: '头像 seed 过长' };
    avatarSeed = trimmed;
  }
  const role = opts?.role != null ? normalizeSeatRole(opts.role) : null;

  const seatId = newId('seat');
  const now = Date.now();
  const name = displayName.trim() || `玩家${seats.length + 1}`;
  db.prepare(
    `INSERT INTO room_seats (id, room_code, user_id, display_name, sort_order, role, avatar_seed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(seatId, row.code, userId, name, seats.length, role, avatarSeed, now);
  touchRoom(row.code);

  const rt = ensureRuntime(row.code);
  rt?.seatOwner.set(seatId, userId);
  emitRoomUpdated(row.code);
  return { ok: true, room: getRoomDto(row.code)! };
}

function assertLobbySeatEditable(
  code: string,
  actorUserId: string,
  seatId: string,
  denyMsg: string,
):
  | { ok: true; roomCode: string }
  | { ok: false; error: string } {
  const row = getRoomRow(code);
  if (!row) return { ok: false, error: '房间不存在' };
  if (row.status !== 'lobby') return { ok: false, error: denyMsg };
  const seat = db
    .prepare(`SELECT id, user_id AS userId FROM room_seats WHERE id = ? AND room_code = ?`)
    .get(seatId, row.code) as { id: string; userId: string } | undefined;
  if (!seat) return { ok: false, error: '座位不存在' };
  const isHost = actorUserId === row.hostUserId;
  if (!isHost && seat.userId !== actorUserId) {
    return { ok: false, error: '只能修改自己的座位' };
  }
  return { ok: true, roomCode: row.code };
}

/** 大厅内设置座位角色（房主或座位本人） */
export function setSeatRole(
  code: string,
  actorUserId: string,
  seatId: string,
  role: SeatRole | null,
): { ok: true; room: RoomDto } | { ok: false; error: string } {
  const gate = assertLobbySeatEditable(code, actorUserId, seatId, '对局已开始，无法改角色');
  if (!gate.ok) return gate;
  db.prepare(`UPDATE room_seats SET role = ? WHERE id = ?`).run(role, seatId);
  touchRoom(gate.roomCode);
  emitRoomUpdated(gate.roomCode);
  return { ok: true, room: getRoomDto(gate.roomCode)! };
}

/** 大厅内设置座位头像 seed（房主或座位本人） */
export function setSeatAvatarSeed(
  code: string,
  actorUserId: string,
  seatId: string,
  seed: string,
): { ok: true; room: RoomDto } | { ok: false; error: string } {
  const trimmed = seed.trim();
  if (!trimmed) return { ok: false, error: '头像 seed 不能为空' };
  if (trimmed.length > 64) return { ok: false, error: '头像 seed 过长' };
  const gate = assertLobbySeatEditable(code, actorUserId, seatId, '对局已开始，无法改头像');
  if (!gate.ok) return gate;
  db.prepare(`UPDATE room_seats SET avatar_seed = ? WHERE id = ?`).run(trimmed, seatId);
  touchRoom(gate.roomCode);
  emitRoomUpdated(gate.roomCode);
  return { ok: true, room: getRoomDto(gate.roomCode)! };
}

export function removeSeat(
  code: string,
  actorUserId: string,
  seatId: string,
): { ok: true; room: RoomDto } | { ok: false; error: string } {
  const row = getRoomRow(code);
  if (!row) return { ok: false, error: '房间不存在' };
  if (row.status !== 'lobby') return { ok: false, error: '对局已开始，无法退座' };
  const seat = db
    .prepare(`SELECT id, user_id AS userId FROM room_seats WHERE id = ? AND room_code = ?`)
    .get(seatId, row.code) as { id: string; userId: string } | undefined;
  if (!seat) return { ok: false, error: '座位不存在' };
  const isHost = actorUserId === row.hostUserId;
  if (!isHost && seat.userId !== actorUserId) {
    return { ok: false, error: '只能移除自己的座位' };
  }
  const seats = loadSeats(row.code);
  if (seats.length <= 1) return { ok: false, error: '至少保留一个座位' };

  db.prepare('DELETE FROM room_seats WHERE id = ?').run(seatId);
  touchRoom(row.code);
  const rt = ensureRuntime(row.code);
  rt?.seatOwner.delete(seatId);
  emitRoomUpdated(row.code);
  return { ok: true, room: getRoomDto(row.code)! };
}

export function startRoomGame(
  code: string,
  hostUserId: string,
): { ok: true; room: RoomDto; state: GameState; events: GameEvent[] } | { ok: false; error: string } {
  const row = getRoomRow(code);
  if (!row) return { ok: false, error: '房间不存在' };
  if (row.hostUserId !== hostUserId) return { ok: false, error: '仅房主可开始' };
  if (row.status !== 'lobby') return { ok: false, error: '房间不在大厅状态' };
  const seats = loadSeats(row.code);
  if (seats.length < 1) return { ok: false, error: '至少需要一名玩家' };

  const board = JSON.parse(row.boardSnapshot) as BoardDefinition;
  const { state, events } = startGame({
    board,
    playerNames: seats.map((s) => s.displayName),
  });
  // 引擎生成 p1..pn，与座位顺序对齐，改写 id 为 seat.id 并写入头像 seed
  const seatOwner = new Map<string, string>();
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i]!;
    const player = state.players[i];
    if (player) {
      player.id = seat.id;
      player.avatarSeed = seat.avatarSeed;
      seatOwner.set(seat.id, seat.userId);
    }
  }

  const rt: RoomRuntime = {
    code: row.code,
    hostUserId: row.hostUserId,
    boardSnapshot: board,
    status: 'playing',
    seatOwner,
    gameState: state,
  };
  runtimes.set(row.code, rt);
  persistGameState(rt);

  broadcast(row.code, {
    type: 'game_started',
    room: getRoomDto(row.code),
    state,
    events,
  });
  return { ok: true, room: getRoomDto(row.code)!, state, events };
}

/** 当前回合应由哪个用户操作（seatId 映射，失败则按座位顺序兜底） */
function controllerUserId(rt: RoomRuntime): string | null {
  if (!rt.gameState) return null;
  const idx = rt.gameState.currentPlayerIndex;
  const current = rt.gameState.players[idx];
  if (!current) return null;
  const bySeatId = rt.seatOwner.get(current.id);
  if (bySeatId) return bySeatId;
  const seats = loadSeats(rt.code);
  return seats[idx]?.userId ?? null;
}

function assertCurrentController(
  rt: RoomRuntime,
  userId: string,
): { ok: true } | { ok: false; error: string } {
  if (!rt.gameState) return { ok: false, error: '对局未开始' };
  if (rt.status !== 'playing') return { ok: false, error: '对局未在进行中' };
  const owner = controllerUserId(rt);
  if (!owner) return { ok: false, error: '无当前玩家' };
  if (owner !== userId) return { ok: false, error: '未轮到你控制的玩家' };
  return { ok: true };
}

function commitState(
  rt: RoomRuntime,
  state: GameState,
  events: GameEvent[],
): { state: GameState; events: GameEvent[] } {
  rt.gameState = state;
  if (state.phase === 'ended') rt.status = 'ended';
  persistGameState(rt);
  broadcast(rt.code, { type: 'state', state, events });
  return { state, events };
}

export function roomPickStart(
  code: string,
  userId: string,
  cellId: string,
): { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string } {
  const rt = ensureRuntime(code);
  if (!rt) return { ok: false, error: '房间不存在' };
  const gate = assertCurrentController(rt, userId);
  if (!gate.ok) return gate;
  try {
    const result = pickStart(rt.gameState!, cellId);
    return { ok: true, ...commitState(rt, result.state, result.events) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '选起点失败' };
  }
}

export function roomRoll(
  code: string,
  userId: string,
): { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string } {
  const rt = ensureRuntime(code);
  if (!rt) return { ok: false, error: '房间不存在' };
  const gate = assertCurrentController(rt, userId);
  if (!gate.ok) return gate;
  try {
    const result = roll(rt.gameState!);
    return { ok: true, ...commitState(rt, result.state, result.events) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '掷骰失败' };
  }
}

export function roomChooseExit(
  code: string,
  userId: string,
  exitId: string,
): { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string } {
  const rt = ensureRuntime(code);
  if (!rt) return { ok: false, error: '房间不存在' };
  const gate = assertCurrentController(rt, userId);
  if (!gate.ok) return gate;
  try {
    const result = chooseExit(rt.gameState!, exitId);
    return { ok: true, ...commitState(rt, result.state, result.events) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '选出口失败' };
  }
}

export function roomConfirmOrder(
  code: string,
  userId: string,
): { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string } {
  const rt = ensureRuntime(code);
  if (!rt) return { ok: false, error: '房间不存在' };
  const gate = assertCurrentController(rt, userId);
  if (!gate.ok) return gate;
  try {
    const result = confirmOrder(rt.gameState!);
    return { ok: true, ...commitState(rt, result.state, result.events) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '确认失败' };
  }
}

export function getRuntimeState(code: string): GameState | null {
  return ensureRuntime(code)?.gameState ?? null;
}

/** 清理长时间无活动的房间（兜底） */
export function purgeIdleRooms(idleMs: number = ROOM_IDLE_MS): number {
  const cutoff = Date.now() - idleMs;
  const rows = db
    .prepare(`SELECT code FROM rooms WHERE last_active_at < ?`)
    .all(cutoff) as Array<{ code: string }>;
  for (const r of rows) {
    destroyRoom(r.code);
  }
  return rows.length;
}
