import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../../data');
const dbPath = process.env.ORDER_BOARD_DB ?? path.join(dataDir, 'order-board.sqlite');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tile_categories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_id, name COLLATE NOCASE)
  );

  CREATE TABLE IF NOT EXISTS tiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id TEXT REFERENCES tile_categories(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    cols INTEGER NOT NULL,
    rows INTEGER NOT NULL,
    start_cell_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cells (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    col INTEGER NOT NULL,
    row INTEGER NOT NULL,
    tile_id TEXT REFERENCES tiles(id) ON DELETE SET NULL,
    fork_mode TEXT,
    seq INTEGER,
    title TEXT,
    UNIQUE(board_id, col, row)
  );

  CREATE TABLE IF NOT EXISTS exits (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    from_cell_id TEXT NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
    to_cell_id TEXT NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    faces_json TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tile_categories_user ON tile_categories(user_id);
  CREATE INDEX IF NOT EXISTS idx_tiles_user ON tiles(user_id);
  CREATE INDEX IF NOT EXISTS idx_tiles_category ON tiles(category_id);
  CREATE INDEX IF NOT EXISTS idx_boards_user ON boards(user_id);
  CREATE INDEX IF NOT EXISTS idx_cells_board ON cells(board_id);
  CREATE INDEX IF NOT EXISTS idx_exits_board ON exits(board_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

/** 为已有库补列（CREATE TABLE IF NOT EXISTS 不会改旧表） */
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn('cells', 'fork_mode', 'fork_mode TEXT');
ensureColumn('cells', 'seq', 'seq INTEGER');
ensureColumn('cells', 'title', 'title TEXT');
ensureColumn('cells', 'is_start', 'is_start INTEGER NOT NULL DEFAULT 0');
ensureColumn('cells', 'end_mode', 'end_mode TEXT');
ensureColumn('exits', 'faces_json', 'faces_json TEXT');
ensureColumn('users', 'is_temp', 'is_temp INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'last_active_at', 'last_active_at INTEGER');

db.exec(`
  UPDATE users SET last_active_at = created_at WHERE last_active_at IS NULL;

  CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY,
    host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board_id TEXT,
    board_snapshot TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('lobby', 'playing', 'ended')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS room_seats (
    id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rooms_host ON rooms(host_user_id);
  CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
  CREATE INDEX IF NOT EXISTS idx_room_seats_room ON room_seats(room_code);
  CREATE INDEX IF NOT EXISTS idx_users_temp_active ON users(is_temp, last_active_at);
`);

ensureColumn('rooms', 'game_state', 'game_state TEXT');
ensureColumn('rooms', 'visibility', `visibility TEXT NOT NULL DEFAULT 'public'`);
ensureColumn('boards', 'visibility', `visibility TEXT NOT NULL DEFAULT 'private'`);
ensureColumn('boards', 'play_mode', `play_mode TEXT NOT NULL DEFAULT 'multi'`);
ensureColumn('tiles', 'play_mode', `play_mode TEXT NOT NULL DEFAULT 'multi'`);
ensureColumn('tiles', 'intensity_level', 'intensity_level INTEGER');
ensureColumn('tiles', 'tags_json', `tags_json TEXT NOT NULL DEFAULT '[]'`);
ensureColumn('room_seats', 'role', 'role TEXT');

db.exec(`
  UPDATE rooms SET visibility = 'public' WHERE visibility IS NULL OR visibility = '';
  UPDATE boards SET visibility = 'private' WHERE visibility IS NULL OR visibility = '';
  UPDATE boards SET play_mode = 'multi' WHERE play_mode IS NULL OR play_mode = '';
  UPDATE tiles SET play_mode = 'multi' WHERE play_mode IS NULL OR play_mode = '';
  UPDATE tiles SET tags_json = '[]' WHERE tags_json IS NULL OR tags_json = '';
  -- 单人棋盘不得公开
  UPDATE boards SET visibility = 'private' WHERE play_mode = 'solo' AND visibility = 'public';

  CREATE TABLE IF NOT EXISTS tile_category_intensities (
    category_id TEXT NOT NULL REFERENCES tile_categories(id) ON DELETE CASCADE,
    level INTEGER NOT NULL,
    label TEXT NOT NULL,
    PRIMARY KEY (category_id, level)
  );
  CREATE INDEX IF NOT EXISTS idx_cat_intensities_cat ON tile_category_intensities(category_id);
  CREATE INDEX IF NOT EXISTS idx_rooms_visibility_status ON rooms(visibility, status);
  CREATE INDEX IF NOT EXISTS idx_boards_visibility ON boards(visibility);
`);

/** 旧库：把 boards.start_cell_id 对应格标为起点 */
{
  const unmarked = db
    .prepare(
      `SELECT b.id AS boardId, b.start_cell_id AS startCellId
       FROM boards b
       WHERE b.start_cell_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM cells c WHERE c.board_id = b.id AND c.is_start = 1
         )`,
    )
    .all() as Array<{ boardId: string; startCellId: string }>;
  const mark = db.prepare(`UPDATE cells SET is_start = 1 WHERE id = ? AND board_id = ?`);
  for (const row of unmarked) {
    mark.run(row.startCellId, row.boardId);
  }
}

/** 在事务中执行；失败则回滚 */
export function withTransaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// 指令 kind → 自定义分类（幂等）
const { migrateTilesToCategories } = await import('./categories.js');
migrateTilesToCategories();
