import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { EndMode, ForkMode, PlayMode } from '@order-board/rules';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  ensureGuestUser,
  getUserFromRequest,
  purgeInactiveTempUsers,
  registerOrUpgrade,
  requireUser,
  SESSION_COOKIE,
  setSessionCookie,
  touchUserActive,
  verifyPassword,
} from './auth.js';
import {
  createTile,
  deleteBoard,
  deleteTile,
  listBoards,
  listPublicBoards,
  listTiles,
  loadBoardDocument,
  normalizePlayMode,
  saveBoard,
  setBoardVisibility,
  toPlayableBoard,
  updateTile,
  type BoardSaveInput,
  type BoardVisibility,
} from './boards.js';
import {
  createCategory,
  deleteCategory,
  ensureDefaultCategories,
  listCategories,
  migrateTilesToCategories,
  updateCategory,
} from './categories.js';
import { db } from './db.js';

// 旧库补分类列/索引（须在 db 初始化完成后再跑，避免循环 await）
migrateTilesToCategories();
db.exec(`CREATE INDEX IF NOT EXISTS idx_tiles_category ON tiles(category_id)`);
import {
  addSeat,
  createRoom,
  getRoomDto,
  getRuntimeState,
  enterRoom,
  listPublicRooms,
  purgeIdleRooms,
  removeSeat,
  roomChooseExit,
  roomConfirmOrder,
  roomPickStart,
  roomRoll,
  setSeatAvatarSeed,
  setSeatRole,
  startRoomGame,
  type RoomVisibility,
  type SeatRole,
} from './rooms.js';
import { registerWebsocket } from './ws.js';

function asBoardSaveInput(body: {
  name?: string;
  cols?: number;
  rows?: number;
  startCellId?: string | null;
  visibility?: string;
  playMode?: string;
  cells?: Array<{
    id: string;
    col: number;
    row: number;
    tileId?: string | null;
    forkMode?: string | null;
    seq?: number;
    title?: string;
    body?: string;
    tileCategory?: string | null;
    tileCategoryColor?: string | null;
    isStart?: boolean;
    endMode?: string | null;
    emphasized?: boolean;
  }>;
  exits?: Array<{
    id?: string;
    fromCellId: string;
    toCellId: string;
    label: string;
    faces?: number[];
  }>;
}): BoardSaveInput {
  return {
    name: body.name ?? '',
    cols: Number(body.cols) || 0,
    rows: Number(body.rows) || 0,
    startCellId: body.startCellId ?? null,
    visibility:
      body.visibility === 'public' || body.visibility === 'private'
        ? (body.visibility as BoardVisibility)
        : undefined,
    playMode: normalizePlayMode(body.playMode) as PlayMode,
    cells: (body.cells ?? []).map((c) => ({
      ...c,
      tileId: null,
      forkMode: (c.forkMode ?? null) as ForkMode | null,
      seq: c.seq,
      title: c.title ?? '',
      body: c.body ?? '',
      tileCategory: c.tileCategory ?? null,
      tileCategoryColor: c.tileCategoryColor ?? null,
      isStart: Boolean(c.isStart),
      endMode: (c.endMode ?? null) as EndMode | null,
      emphasized: Boolean(c.emphasized),
    })),
    exits: body.exits ?? [],
  };
}

function parseTileBody(body: {
  categoryId?: string;
  title?: string;
  body?: string;
  playMode?: string;
  intensityLevel?: number | null;
  tags?: string[];
}) {
  return {
    categoryId: body.categoryId?.trim() ?? '',
    title: body.title?.trim() ?? '',
    body: body.body?.trim() ?? '',
    playMode: normalizePlayMode(body.playMode),
    intensityLevel:
      body.intensityLevel === undefined || body.intensityLevel === null
        ? null
        : Number(body.intensityLevel),
    tags: Array.isArray(body.tags) ? body.tags : [],
  };
}

function userPayload(user: { id: string; username: string; isTemp: boolean }) {
  return { id: user.id, username: user.username, isTemp: user.isTemp };
}

const PORT = Number(process.env.PORT ?? 3789);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  credentials: true,
});
await app.register(cookie);
await registerWebsocket(app);

app.get('/api/health', async () => ({ ok: true }));

/** 确保临时会话：无 Cookie 时自动创建游客 */
app.post('/api/auth/guest', async (request, reply) => {
  const user = ensureGuestUser(request, reply);
  return userPayload(user);
});

app.get('/api/me', async (request, reply) => {
  const user = getUserFromRequest(request);
  if (!user) {
    return reply.code(401).send({ error: '未登录' });
  }
  return userPayload(user);
});

app.post<{ Body: { username?: string; password?: string } }>(
  '/api/auth/register',
  async (request, reply) => {
    const username = request.body?.username?.trim() ?? '';
    const password = request.body?.password ?? '';
    const result = registerOrUpgrade(request, reply, username, password);
    if (!result.ok) {
      return reply.code(result.status).send({ error: result.error });
    }
    return userPayload(result.user);
  },
);

app.post<{ Body: { username?: string; password?: string } }>(
  '/api/auth/login',
  async (request, reply) => {
    const username = request.body?.username?.trim() ?? '';
    const password = request.body?.password ?? '';
    const row = db
      .prepare(
        'SELECT id, username, password_hash, is_temp FROM users WHERE username = ? COLLATE NOCASE',
      )
      .get(username) as
      | { id: string; username: string; password_hash: string; is_temp: number }
      | undefined;
    if (!row || !verifyPassword(password, row.password_hash)) {
      return reply.code(401).send({ error: '用户名或密码错误' });
    }
    if (row.is_temp) {
      return reply.code(401).send({ error: '临时用户请先注册升级' });
    }
    const sessionId = createSession(row.id);
    setSessionCookie(reply, sessionId);
    touchUserActive(row.id);
    return userPayload({ id: row.id, username: row.username, isTemp: false });
  },
);

app.post('/api/auth/logout', async (request, reply) => {
  const sessionId = request.cookies?.[SESSION_COOKIE];
  if (sessionId) destroySession(sessionId);
  clearSessionCookie(reply);
  return { ok: true };
});

app.get('/api/tile-categories', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  ensureDefaultCategories(user.id);
  return listCategories(user.id);
});

app.post<{
  Body: { name?: string; color?: string | null; intensities?: string[] };
}>('/api/tile-categories', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  try {
    return createCategory(user.id, {
      name: request.body?.name ?? '',
      color: request.body?.color ?? null,
      intensities: request.body?.intensities,
    });
  } catch (e) {
    return reply.code(400).send({ error: e instanceof Error ? e.message : '创建失败' });
  }
});

app.put<{
  Params: { id: string };
  Body: {
    name?: string;
    color?: string | null;
    sortOrder?: number;
    intensities?: string[];
  };
}>('/api/tile-categories/:id', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  try {
    const updated = updateCategory(user.id, request.params.id, {
      name: request.body?.name,
      color: request.body?.color,
      sortOrder: request.body?.sortOrder,
      intensities: request.body?.intensities,
    });
    if (!updated) return reply.code(404).send({ error: '分类不存在' });
    return updated;
  } catch (e) {
    return reply.code(400).send({ error: e instanceof Error ? e.message : '更新失败' });
  }
});

app.delete<{ Params: { id: string } }>('/api/tile-categories/:id', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  if (!deleteCategory(user.id, request.params.id)) {
    return reply.code(404).send({ error: '分类不存在' });
  }
  return { ok: true };
});

app.get('/api/tiles', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  return listTiles(user.id);
});

app.post<{
  Body: {
    categoryId?: string;
    title?: string;
    body?: string;
    playMode?: string;
    intensityLevel?: number | null;
    tags?: string[];
  };
}>('/api/tiles', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const input = parseTileBody(request.body ?? {});
  if (!input.categoryId) return reply.code(400).send({ error: '请选择分类' });
  try {
    return createTile(user.id, input);
  } catch (e) {
    return reply.code(400).send({ error: e instanceof Error ? e.message : '创建失败' });
  }
});

app.put<{
  Params: { id: string };
  Body: {
    categoryId?: string;
    title?: string;
    body?: string;
    playMode?: string;
    intensityLevel?: number | null;
    tags?: string[];
  };
}>('/api/tiles/:id', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const input = parseTileBody(request.body ?? {});
  if (!input.categoryId) return reply.code(400).send({ error: '请选择分类' });
  try {
    const updated = updateTile(user.id, request.params.id, input);
    if (!updated) return reply.code(404).send({ error: '指令不存在' });
    return updated;
  } catch (e) {
    return reply.code(400).send({ error: e instanceof Error ? e.message : '更新失败' });
  }
});

app.delete<{ Params: { id: string } }>('/api/tiles/:id', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  if (!deleteTile(user.id, request.params.id)) {
    return reply.code(404).send({ error: '指令不存在' });
  }
  return { ok: true };
});

app.get('/api/boards', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  return listBoards(user.id);
});

app.get('/api/boards/public', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  return listPublicBoards();
});

app.get<{ Params: { id: string } }>('/api/boards/:id', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const board = loadBoardDocument(user.id, request.params.id);
  if (!board) return reply.code(404).send({ error: '棋盘不存在' });
  return board;
});

app.patch<{ Params: { id: string }; Body: { visibility?: string } }>(
  '/api/boards/:id/visibility',
  async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const visibility = request.body?.visibility;
    if (visibility !== 'public' && visibility !== 'private') {
      return reply.code(400).send({ error: 'visibility 须为 public 或 private' });
    }
    try {
      const updated = setBoardVisibility(user.id, request.params.id, visibility);
      if (!updated) return reply.code(404).send({ error: '棋盘不存在' });
      return updated;
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : '更新失败' });
    }
  },
);

app.post<{ Body: Record<string, unknown> }>('/api/boards', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const result = saveBoard(user.id, null, asBoardSaveInput(request.body as Parameters<typeof asBoardSaveInput>[0]));
  if (!result.ok) return reply.code(400).send({ error: result.error });
  return result.board;
});

app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
  '/api/boards/:id',
  async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const result = saveBoard(
      user.id,
      request.params.id,
      asBoardSaveInput(request.body as Parameters<typeof asBoardSaveInput>[0]),
    );
    if (!result.ok) {
      const code = result.error === '棋盘不存在' ? 404 : 400;
      return reply.code(code).send({ error: result.error });
    }
    return result.board;
  },
);

app.delete<{ Params: { id: string } }>('/api/boards/:id', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  if (!deleteBoard(user.id, request.params.id)) {
    return reply.code(404).send({ error: '棋盘不存在' });
  }
  return { ok: true };
});

/** 开局：返回可玩的 BoardDefinition */
app.get<{ Params: { id: string } }>('/api/boards/:id/playable', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const result = toPlayableBoard(user.id, request.params.id);
  if (!result.ok) return reply.code(400).send({ error: result.error });
  return result.board;
});

/** —— 房间 HTTP —— */

app.get('/api/rooms/public', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  return listPublicRooms();
});

app.post<{
  Body: {
    boardId?: string;
    displayName?: string;
    visibility?: string;
    role?: string | null;
    avatarSeed?: string;
  };
}>(
  '/api/rooms',
  async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = request.body ?? {};
    const boardId = body.boardId?.trim() ?? '';
    if (!boardId) return reply.code(400).send({ error: '缺少 boardId' });
    const displayName = body.displayName?.trim() || user.username;
    const visibility: RoomVisibility =
      body.visibility === 'private' ? 'private' : 'public';
    const raw = body.role;
    let role: SeatRole | null = null;
    if (raw === 'dominant' || raw === 'submissive') role = raw;
    else if (raw != null && raw !== '' && raw !== 'none') {
      return reply.code(400).send({ error: 'role 须为 dominant / submissive / null' });
    }
    const result = createRoom(user.id, boardId, displayName, visibility, {
      role,
      avatarSeed: body.avatarSeed,
    });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return result.room;
  },
);

app.get<{ Params: { code: string } }>('/api/rooms/:code', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const room = getRoomDto(request.params.code);
  if (!room) return reply.code(404).send({ error: '房间不存在' });
  return { room, state: getRuntimeState(room.code) };
});

app.post<{ Params: { code: string } }>('/api/rooms/:code/join', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const result = enterRoom(request.params.code, user.id);
  if (!result.ok) return reply.code(400).send({ error: result.error });
  return { room: result.room, state: result.state };
});

app.post<{
  Params: { code: string };
  Body: { displayName?: string; role?: string | null; avatarSeed?: string };
}>(
  '/api/rooms/:code/seats',
  async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = request.body ?? {};
    const raw = body.role;
    let role: SeatRole | null = null;
    if (raw === 'dominant' || raw === 'submissive') role = raw;
    else if (raw != null && raw !== '' && raw !== 'none') {
      return reply.code(400).send({ error: 'role 须为 dominant / submissive / null' });
    }
    const result = addSeat(request.params.code, user.id, body.displayName ?? '', {
      role,
      avatarSeed: body.avatarSeed,
    });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return result.room;
  },
);

app.delete<{ Params: { code: string; seatId: string } }>(
  '/api/rooms/:code/seats/:seatId',
  async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const result = removeSeat(request.params.code, user.id, request.params.seatId);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return result.room;
  },
);

app.patch<{
  Params: { code: string; seatId: string };
  Body: { role?: string | null; avatarSeed?: string };
}>('/api/rooms/:code/seats/:seatId', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const body = request.body ?? {};
  const hasRole = Object.prototype.hasOwnProperty.call(body, 'role');
  const hasSeed = Object.prototype.hasOwnProperty.call(body, 'avatarSeed');
  if (!hasRole && !hasSeed) {
    return reply.code(400).send({ error: '缺少 role 或 avatarSeed' });
  }

  if (hasRole) {
    const raw = body.role;
    let role: SeatRole | null = null;
    if (raw === 'dominant' || raw === 'submissive') role = raw;
    else if (raw != null && raw !== '' && raw !== 'none') {
      return reply.code(400).send({ error: 'role 须为 dominant / submissive / null' });
    }
    const result = setSeatRole(request.params.code, user.id, request.params.seatId, role);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    if (!hasSeed) return result.room;
  }

  if (hasSeed) {
    const result = setSeatAvatarSeed(
      request.params.code,
      user.id,
      request.params.seatId,
      String(body.avatarSeed ?? ''),
    );
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return result.room;
  }

  return reply.code(400).send({ error: '缺少 role 或 avatarSeed' });
});

app.post<{ Params: { code: string } }>('/api/rooms/:code/start', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const result = startRoomGame(request.params.code, user.id);
  if (!result.ok) return reply.code(400).send({ error: result.error });
  return { room: result.room, state: result.state, events: result.events };
});

app.post<{ Params: { code: string }; Body: { cellId?: string } }>(
  '/api/rooms/:code/actions/pick-start',
  async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const cellId = request.body?.cellId?.trim() ?? '';
    if (!cellId) return reply.code(400).send({ error: '缺少 cellId' });
    const result = roomPickStart(request.params.code, user.id, cellId);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { state: result.state, events: result.events };
  },
);

app.post<{ Params: { code: string } }>('/api/rooms/:code/actions/roll', async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const result = roomRoll(request.params.code, user.id);
  if (!result.ok) return reply.code(400).send({ error: result.error });
  return { state: result.state, events: result.events };
});

app.post<{ Params: { code: string }; Body: { exitId?: string } }>(
  '/api/rooms/:code/actions/choose-exit',
  async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const exitId = request.body?.exitId?.trim() ?? '';
    if (!exitId) return reply.code(400).send({ error: '缺少 exitId' });
    const result = roomChooseExit(request.params.code, user.id, exitId);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { state: result.state, events: result.events };
  },
);

app.post<{ Params: { code: string } }>(
  '/api/rooms/:code/actions/confirm-order',
  async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const result = roomConfirmOrder(request.params.code, user.id);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { state: result.state, events: result.events };
  },
);

try {
  const purgedUsers = purgeInactiveTempUsers();
  const purgedRooms = purgeIdleRooms();
  if (purgedUsers || purgedRooms) {
    app.log.info({ purgedUsers, purgedRooms }, '启动清理完成');
  }
  await app.listen({ port: PORT, host: HOST });
  console.log(`令棋服务器 http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
