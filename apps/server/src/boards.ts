import type {
  BoardDefinition,
  BoundTile,
  EndMode,
  ForkMode,
  PlayMode,
} from '@order-board/rules';
import { fillMissingSeqs, validateBoard } from '@order-board/rules';
import { db, withTransaction } from './db.js';
import { newId } from './auth.js';
import {
  assertIntensityLevel,
  ensureDefaultCategories,
  findOrCreateCategory,
  getCategory,
  getIntensityLabel,
} from './categories.js';

export type { PlayMode };

export interface TileRow {
  id: string;
  user_id: string;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  play_mode: PlayMode;
  intensity_level: number | null;
  intensity_label: string | null;
  tags: string[];
  title: string;
  body: string;
  created_at: number;
  updated_at: number;
}

export type BoardVisibility = 'public' | 'private';

export interface BoardSummary {
  id: string;
  name: string;
  cols: number;
  rows: number;
  startCellId: string | null;
  visibility: BoardVisibility;
  playMode: PlayMode;
  updatedAt: number;
}

export interface PublicBoardSummary {
  id: string;
  name: string;
  cols: number;
  rows: number;
  playMode: PlayMode;
  ownerUsername: string;
  updatedAt: number;
}

export interface BoardDocument {
  id: string;
  name: string;
  cols: number;
  rows: number;
  startCellId: string | null;
  visibility: BoardVisibility;
  playMode: PlayMode;
  cells: Array<{
    id: string;
    col: number;
    row: number;
    /** @deprecated 已内嵌文案，始终为 null */
    tileId: string | null;
    forkMode: ForkMode | null;
    seq: number;
    title: string;
    body: string;
    tileCategory: string | null;
    tileCategoryColor: string | null;
    isStart: boolean;
    endMode: EndMode | null;
    emphasized: boolean;
  }>;
  exits: Array<{
    id: string;
    fromCellId: string;
    toCellId: string;
    label: string;
    faces: number[];
  }>;
  updatedAt: number;
}

export interface BoardSaveInput {
  name: string;
  cols: number;
  rows: number;
  startCellId: string | null;
  visibility?: BoardVisibility;
  playMode?: PlayMode;
  cells: Array<{
    id: string;
    col: number;
    row: number;
    tileId?: string | null;
    forkMode?: ForkMode | null;
    seq?: number;
    title?: string;
    body?: string;
    tileCategory?: string | null;
    tileCategoryColor?: string | null;
    isStart?: boolean;
    endMode?: EndMode | null;
    emphasized?: boolean;
  }>;
  exits: Array<{
    id?: string;
    fromCellId: string;
    toCellId: string;
    label: string;
    faces?: number[];
  }>;
}

export interface TileWriteInput {
  categoryId: string;
  title: string;
  body: string;
  playMode?: PlayMode;
  intensityLevel?: number | null;
  tags?: string[];
}

function normalizeVisibility(raw: unknown, fallback: BoardVisibility): BoardVisibility {
  return raw === 'public' || raw === 'private' ? raw : fallback;
}

export function normalizePlayMode(raw: unknown, fallback: PlayMode = 'multi'): PlayMode {
  return raw === 'solo' || raw === 'multi' ? raw : fallback;
}

function parseTags(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);
  } catch {
    return [];
  }
}

function serializeTags(tags: string[] | undefined): string {
  return JSON.stringify(parseTags(tags ?? []));
}

const FORK_MODES: ForkMode[] = ['advance_die', 'reroll_die', 'status', 'player_choice'];
const END_MODES: EndMode[] = ['direct', 'bounce'];

function parseFaces(raw: unknown): number[] {
  if (raw == null || raw === '') return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n) => Number.isInteger(n) && n >= 1 && n <= 6) as number[];
  } catch {
    return [];
  }
}

function normalizeForkMode(raw: unknown): ForkMode | null {
  if (raw == null || raw === '') return null;
  return FORK_MODES.includes(raw as ForkMode) ? (raw as ForkMode) : null;
}

function normalizeEndMode(raw: unknown): EndMode | null {
  if (raw == null || raw === '') return null;
  return END_MODES.includes(raw as EndMode) ? (raw as EndMode) : null;
}

function mapTileRow(row: {
  id: string;
  user_id: string;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  play_mode: string | null;
  intensity_level: number | null;
  tags_json: string | null;
  title: string;
  body: string;
  created_at: number;
  updated_at: number;
}): TileRow {
  const intensityLevel = row.intensity_level ?? null;
  return {
    id: row.id,
    user_id: row.user_id,
    category_id: row.category_id,
    category_name: row.category_name,
    category_color: row.category_color,
    play_mode: normalizePlayMode(row.play_mode),
    intensity_level: intensityLevel,
    intensity_label:
      row.category_id && intensityLevel != null
        ? (getIntensityLabel(row.category_id, intensityLevel) ?? null)
        : null,
    tags: parseTags(row.tags_json),
    title: row.title,
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const TILE_SELECT = `
  SELECT t.id, t.user_id, t.category_id, t.title, t.body, t.created_at, t.updated_at,
         t.play_mode, t.intensity_level, t.tags_json,
         c.name AS category_name, c.color AS category_color
  FROM tiles t
  LEFT JOIN tile_categories c ON c.id = t.category_id
`;

export function listTiles(userId: string): TileRow[] {
  ensureDefaultCategories(userId);
  const rows = db
    .prepare(`${TILE_SELECT} WHERE t.user_id = ? ORDER BY t.updated_at DESC`)
    .all(userId) as unknown as Array<Parameters<typeof mapTileRow>[0]>;
  return rows.map(mapTileRow);
}

export function getTile(userId: string, tileId: string): TileRow | null {
  const row = db
    .prepare(`${TILE_SELECT} WHERE t.id = ? AND t.user_id = ?`)
    .get(tileId, userId) as Parameters<typeof mapTileRow>[0] | undefined;
  return row ? mapTileRow(row) : null;
}

export function createTile(userId: string, input: TileWriteInput): TileRow {
  const cat = getCategory(userId, input.categoryId);
  if (!cat) throw new Error('分类不存在');
  const title = input.title.trim();
  if (!title) throw new Error('标题不能为空');
  if (title === '开始' || title === '结束') {
    throw new Error('请使用棋盘起点/终点，勿再建「开始」「结束」指令');
  }
  const playMode = normalizePlayMode(input.playMode);
  const intensityLevel = input.intensityLevel ?? null;
  assertIntensityLevel(input.categoryId, intensityLevel);
  const now = Date.now();
  const id = newId('tile');
  db.prepare(
    `INSERT INTO tiles (id, user_id, category_id, title, body, play_mode, intensity_level, tags_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    input.categoryId,
    title,
    input.body.trim(),
    playMode,
    intensityLevel,
    serializeTags(input.tags),
    now,
    now,
  );
  return getTile(userId, id)!;
}

export function updateTile(
  userId: string,
  tileId: string,
  input: TileWriteInput,
): TileRow | null {
  const existing = getTile(userId, tileId);
  if (!existing) return null;
  const cat = getCategory(userId, input.categoryId);
  if (!cat) throw new Error('分类不存在');
  const title = input.title.trim();
  if (!title) throw new Error('标题不能为空');
  if (title === '开始' || title === '结束') {
    throw new Error('请使用棋盘起点/终点，勿再建「开始」「结束」指令');
  }
  const playMode = normalizePlayMode(input.playMode, existing.play_mode);
  const intensityLevel =
    input.intensityLevel === undefined ? existing.intensity_level : input.intensityLevel;
  assertIntensityLevel(input.categoryId, intensityLevel);
  const now = Date.now();
  db.prepare(
    `UPDATE tiles SET category_id = ?, title = ?, body = ?, play_mode = ?,
      intensity_level = ?, tags_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(
    input.categoryId,
    title,
    input.body.trim(),
    playMode,
    intensityLevel,
    serializeTags(input.tags ?? existing.tags),
    now,
    tileId,
    userId,
  );
  return getTile(userId, tileId);
}

export function deleteTile(userId: string, tileId: string): boolean {
  const result = db.prepare('DELETE FROM tiles WHERE id = ? AND user_id = ?').run(tileId, userId);
  return result.changes > 0;
}

/** 按标题建指令并挂到同名分类（导入用；跳过开始/结束） */
export function createTileFromTitle(
  userId: string,
  title: string,
  body: string,
): TileRow | null {
  const t = title.trim();
  if (!t || t === '开始' || t === '结束') return null;
  const cat = findOrCreateCategory(userId, t);
  return createTile(userId, { categoryId: cat.id, title: t, body, playMode: 'multi' });
}

export function listBoards(userId: string): BoardSummary[] {
  const rows = db
    .prepare(
      `SELECT id, name, cols, rows, start_cell_id AS startCellId,
              visibility, play_mode AS playMode, updated_at AS updatedAt
       FROM boards WHERE user_id = ? ORDER BY updated_at DESC`,
    )
    .all(userId) as unknown as Array<{
    id: string;
    name: string;
    cols: number;
    rows: number;
    startCellId: string | null;
    visibility: string;
    playMode: string;
    updatedAt: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    cols: r.cols,
    rows: r.rows,
    startCellId: r.startCellId,
    visibility: normalizeVisibility(r.visibility, 'private'),
    playMode: normalizePlayMode(r.playMode),
    updatedAt: r.updatedAt,
  }));
}

/** 大厅：公开棋盘列表（不含单人盘） */
export function listPublicBoards(): PublicBoardSummary[] {
  const rows = db
    .prepare(
      `SELECT b.id, b.name, b.cols, b.rows, b.play_mode AS playMode,
              b.updated_at AS updatedAt, u.username AS ownerUsername
       FROM boards b
       JOIN users u ON u.id = b.user_id
       WHERE b.visibility = 'public' AND b.play_mode != 'solo'
       ORDER BY b.updated_at DESC
       LIMIT 100`,
    )
    .all() as Array<{
    id: string;
    name: string;
    cols: number;
    rows: number;
    playMode: string;
    updatedAt: number;
    ownerUsername: string;
  }>;
  return rows.map((r) => ({
    ...r,
    playMode: normalizePlayMode(r.playMode),
  }));
}

/** 读取棋盘 play_mode（任意所有者） */
export function getBoardPlayMode(boardId: string): PlayMode | null {
  const row = db
    .prepare(`SELECT play_mode FROM boards WHERE id = ?`)
    .get(boardId) as { play_mode: string } | undefined;
  return row ? normalizePlayMode(row.play_mode) : null;
}

export function setBoardVisibility(
  userId: string,
  boardId: string,
  visibility: BoardVisibility,
): BoardSummary | null {
  const mode = db
    .prepare(`SELECT play_mode FROM boards WHERE id = ? AND user_id = ?`)
    .get(boardId, userId) as { play_mode: string } | undefined;
  if (!mode) return null;
  if (normalizePlayMode(mode.play_mode) === 'solo' && visibility === 'public') {
    throw new Error('单人棋盘不能设为公开');
  }
  const result = db
    .prepare(
      `UPDATE boards SET visibility = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    )
    .run(visibility, Date.now(), boardId, userId);
  if (!result.changes) return null;
  return listBoards(userId).find((b) => b.id === boardId) ?? null;
}

export function loadBoardDocument(userId: string, boardId: string): BoardDocument | null {
  const board = db
    .prepare(
      `SELECT id, name, cols, rows, start_cell_id, visibility, play_mode, updated_at
       FROM boards WHERE id = ? AND user_id = ?`,
    )
    .get(boardId, userId) as
    | {
        id: string;
        name: string;
        cols: number;
        rows: number;
        start_cell_id: string | null;
        visibility: string;
        play_mode: string;
        updated_at: number;
      }
    | undefined;
  if (!board) return null;

  const cellRows = db
    .prepare(
      `SELECT id, col, row, fork_mode AS forkMode, seq, title, body,
              tile_category AS tileCategory, tile_category_color AS tileCategoryColor,
              is_start AS isStart, end_mode AS endMode, emphasized
       FROM cells WHERE board_id = ? ORDER BY row, col`,
    )
    .all(boardId) as Array<{
    id: string;
    col: number;
    row: number;
    forkMode: unknown;
    seq: number | null;
    title: string | null;
    body: string | null;
    tileCategory: string | null;
    tileCategoryColor: string | null;
    isStart: number | boolean | null;
    endMode: unknown;
    emphasized: number | boolean | null;
  }>;

  const filled = fillMissingSeqs(
    cellRows.map((c) => ({
      id: c.id,
      col: c.col,
      row: c.row,
      tileId: null as string | null,
      forkMode: normalizeForkMode(c.forkMode),
      seq: c.seq ?? undefined,
      title: c.title ?? '',
      body: c.body ?? '',
      tileCategory: c.tileCategory,
      tileCategoryColor: c.tileCategoryColor,
      isStart: Boolean(c.isStart),
      endMode: normalizeEndMode(c.endMode),
      emphasized: Boolean(c.emphasized),
    })),
  );

  const cells = filled.map((c) => ({
    id: c.id,
    col: c.col,
    row: c.row,
    tileId: null,
    forkMode: c.forkMode,
    seq: c.seq,
    title: c.title ?? '',
    body: c.body ?? '',
    tileCategory: c.tileCategory ?? null,
    tileCategoryColor: c.tileCategoryColor ?? null,
    isStart: Boolean(c.isStart),
    endMode: c.endMode ?? null,
    emphasized: Boolean(c.emphasized),
  }));

  const exitRows = db
    .prepare(
      `SELECT id, from_cell_id AS fromCellId, to_cell_id AS toCellId, label, faces_json AS facesJson
       FROM exits WHERE board_id = ?`,
    )
    .all(boardId) as Array<{
    id: string;
    fromCellId: string;
    toCellId: string;
    label: string;
    facesJson: unknown;
  }>;

  const exits = exitRows.map((e) => ({
    id: e.id,
    fromCellId: e.fromCellId,
    toCellId: e.toCellId,
    label: e.label,
    faces: parseFaces(e.facesJson),
  }));

  return {
    id: board.id,
    name: board.name,
    cols: board.cols,
    rows: board.rows,
    startCellId: board.start_cell_id,
    visibility: normalizeVisibility(board.visibility, 'private'),
    playMode: normalizePlayMode(board.play_mode),
    cells,
    exits,
    updatedAt: board.updated_at,
  };
}

/**
 * 整份保存棋盘（替换 cells / exits）。
 */
export function saveBoard(
  userId: string,
  boardId: string | null,
  input: BoardSaveInput,
): { ok: true; board: BoardDocument } | { ok: false; error: string } {
  if (!input.name?.trim()) return { ok: false, error: '棋盘名称不能为空' };
  if (input.cols < 1 || input.rows < 1 || input.cols > 20 || input.rows > 20) {
    return { ok: false, error: '网格尺寸须在 1–20 之间' };
  }

  const cellIds = new Set(input.cells.map((c) => c.id));
  if (input.startCellId && !cellIds.has(input.startCellId)) {
    return { ok: false, error: '默认起点格子不存在' };
  }
  for (const exit of input.exits) {
    if (!cellIds.has(exit.fromCellId) || !cellIds.has(exit.toCellId)) {
      return { ok: false, error: '出口引用了不存在的格子' };
    }
  }
  const playMode = normalizePlayMode(input.playMode);
  for (const cell of input.cells) {
    if (cell.forkMode != null && !FORK_MODES.includes(cell.forkMode)) {
      return { ok: false, error: `无效分叉模式: ${cell.forkMode}` };
    }
    if (cell.endMode != null && !END_MODES.includes(cell.endMode)) {
      return { ok: false, error: `无效结束模式: ${cell.endMode}` };
    }
  }

  // 默认起点自动视为起点
  const cellsWithSeq = fillMissingSeqs(
    input.cells.map((c) => ({
      ...c,
      isStart: Boolean(c.isStart) || c.id === input.startCellId,
      endMode: c.endMode ?? null,
      emphasized: Boolean(c.emphasized),
      seq: Number.isInteger(c.seq) && (c.seq as number) >= 1 ? c.seq : undefined,
    })),
  );
  const seqSeen = new Set<number>();
  for (const c of cellsWithSeq) {
    if (seqSeen.has(c.seq)) {
      return { ok: false, error: `序号重复: ${c.seq}` };
    }
    seqSeen.add(c.seq);
  }

  const now = Date.now();
  const id = boardId ?? newId('board');
  let visibility = normalizeVisibility(input.visibility, 'private');
  if (playMode === 'solo' && visibility === 'public') {
    return { ok: false, error: '单人棋盘不能设为公开' };
  }

  if (boardId) {
    const owned = db
      .prepare('SELECT id FROM boards WHERE id = ? AND user_id = ?')
      .get(boardId, userId);
    if (!owned) return { ok: false, error: '棋盘不存在' };
  }

  withTransaction(() => {
    if (boardId) {
      db.prepare(
        `UPDATE boards SET name = ?, cols = ?, rows = ?, start_cell_id = ?,
          visibility = ?, play_mode = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      ).run(
        input.name.trim(),
        input.cols,
        input.rows,
        input.startCellId,
        visibility,
        playMode,
        now,
        boardId,
        userId,
      );
      db.prepare('DELETE FROM exits WHERE board_id = ?').run(boardId);
      db.prepare('DELETE FROM cells WHERE board_id = ?').run(boardId);
    } else {
      db.prepare(
        `INSERT INTO boards (id, user_id, name, cols, rows, start_cell_id, visibility, play_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        userId,
        input.name.trim(),
        input.cols,
        input.rows,
        input.startCellId,
        visibility,
        playMode,
        now,
        now,
      );
    }

    const insertCell = db.prepare(
      `INSERT INTO cells (id, board_id, col, row, tile_id, fork_mode, seq, title, body,
        tile_category, tile_category_color, is_start, end_mode, emphasized)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const cell of cellsWithSeq) {
      insertCell.run(
        cell.id,
        id,
        cell.col,
        cell.row,
        cell.forkMode ?? null,
        cell.seq,
        cell.title?.trim() ?? '',
        cell.body?.trim() ?? '',
        cell.tileCategory?.trim() || null,
        cell.tileCategoryColor?.trim() || null,
        cell.isStart ? 1 : 0,
        cell.endMode ?? null,
        cell.emphasized ? 1 : 0,
      );
    }

    const insertExit = db.prepare(
      `INSERT INTO exits (id, board_id, from_cell_id, to_cell_id, label, faces_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const exit of input.exits) {
      const faces = (exit.faces ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= 6);
      insertExit.run(
        exit.id ?? newId('exit'),
        id,
        exit.fromCellId,
        exit.toCellId,
        exit.label || '出口',
        JSON.stringify(faces),
      );
    }
  });

  const board = loadBoardDocument(userId, id)!;
  return { ok: true, board };
}

export function deleteBoard(userId: string, boardId: string): boolean {
  const result = db.prepare('DELETE FROM boards WHERE id = ? AND user_id = ?').run(boardId, userId);
  return result.changes > 0;
}

/**
 * 组装可玩快照：本人棋盘，或任意公开棋盘（指令文案来自格子内嵌）。
 */
export function toPlayableBoard(
  actorUserId: string,
  boardId: string,
): { ok: true; board: BoardDefinition } | { ok: false; error: string } {
  const meta = db
    .prepare(`SELECT user_id AS ownerId, visibility FROM boards WHERE id = ?`)
    .get(boardId) as { ownerId: string; visibility: string } | undefined;
  if (!meta) return { ok: false, error: '棋盘不存在' };
  const isOwner = meta.ownerId === actorUserId;
  const isPublic = meta.visibility === 'public';
  if (!isOwner && !isPublic) return { ok: false, error: '棋盘不存在或未公开' };

  const doc = loadBoardDocument(meta.ownerId, boardId);
  if (!doc) return { ok: false, error: '棋盘不存在' };
  if (!doc.cells.length) return { ok: false, error: '棋盘至少需要一格' };

  let startCellIds = doc.cells.filter((c) => c.isStart).map((c) => c.id);
  if (doc.startCellId && !startCellIds.includes(doc.startCellId)) {
    startCellIds = [doc.startCellId, ...startCellIds];
  }
  if (!startCellIds.length) {
    return { ok: false, error: '请先设置起点' };
  }
  const startCellId = doc.startCellId && startCellIds.includes(doc.startCellId)
    ? doc.startCellId
    : startCellIds[0]!;

  const cells = doc.cells.map((c) => {
    const body = (c.body ?? '').trim();
    let tile: BoundTile | undefined;
    // 有正文才视为指令格（纯标题的小路/拐弯格不算）
    if (body) {
      tile = {
        id: c.id,
        category: c.tileCategory?.trim() || '未分类',
        categoryColor: c.tileCategoryColor ?? undefined,
        title: c.title.trim() || '指令',
        body,
      };
    }
    const exits = doc.exits
      .filter((e) => e.fromCellId === c.id)
      .map((e) => ({
        id: e.id,
        toCellId: e.toCellId,
        label: e.label,
        faces: e.faces.length ? e.faces : undefined,
      }));
    return {
      id: c.id,
      col: c.col,
      row: c.row,
      seq: c.seq,
      title: c.title || undefined,
      tile,
      exits,
      forkMode: c.forkMode ?? undefined,
      endMode: c.endMode ?? undefined,
      emphasized: c.emphasized || undefined,
    };
  });

  const board: BoardDefinition = {
    id: doc.id,
    name: doc.name,
    cols: doc.cols,
    rows: doc.rows,
    startCellId,
    startCellIds,
    cells,
  };

  const errors = validateBoard(board);
  if (errors.length) return { ok: false, error: errors.join('；') };
  return { ok: true, board };
}
