import { db, withTransaction } from './db.js';
import { newId } from './auth.js';

export const MAX_INTENSITY_LEVELS = 10;

export interface IntensityLevel {
  level: number;
  label: string;
}

export interface TileCategoryRow {
  id: string;
  userId: string;
  name: string;
  color: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  intensities: IntensityLevel[];
}

function mapCategory(row: {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}): TileCategoryRow {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    color: row.color,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    intensities: listIntensities(row.id),
  };
}

export function listIntensities(categoryId: string): IntensityLevel[] {
  const rows = db
    .prepare(
      `SELECT level, label FROM tile_category_intensities
       WHERE category_id = ? ORDER BY level`,
    )
    .all(categoryId) as unknown as Array<{ level: number; label: string }>;
  return rows.map((r) => ({ level: r.level, label: r.label }));
}

export function getIntensityLabel(
  categoryId: string,
  level: number | null | undefined,
): string | undefined {
  if (level == null || !Number.isInteger(level)) return undefined;
  const row = db
    .prepare(
      `SELECT label FROM tile_category_intensities
       WHERE category_id = ? AND level = ?`,
    )
    .get(categoryId, level) as { label: string } | undefined;
  return row?.label;
}

/** 校验强度等级属于该分类 */
export function assertIntensityLevel(
  categoryId: string,
  level: number | null | undefined,
): void {
  if (level == null) return;
  if (!Number.isInteger(level) || level < 1) {
    throw new Error('强度等级无效');
  }
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM tile_category_intensities WHERE category_id = ? AND level = ?`,
    )
    .get(categoryId, level) as { ok: number } | undefined;
  if (!row) throw new Error('强度等级不属于该分类');
}

/**
 * 用有序标签列表覆盖分类强度（自动编号 1..n，最多 10）。
 */
export function setCategoryIntensities(
  categoryId: string,
  labels: string[],
): IntensityLevel[] {
  const cleaned = labels
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_INTENSITY_LEVELS);
  withTransaction(() => {
    db.prepare(`DELETE FROM tile_category_intensities WHERE category_id = ?`).run(categoryId);
    const insert = db.prepare(
      `INSERT INTO tile_category_intensities (category_id, level, label) VALUES (?, ?, ?)`,
    );
    cleaned.forEach((label, i) => {
      insert.run(categoryId, i + 1, label);
    });
    // 指令上超出范围的强度清空
    db.prepare(
      `UPDATE tiles SET intensity_level = NULL
       WHERE category_id = ?
         AND intensity_level IS NOT NULL
         AND intensity_level > ?`,
    ).run(categoryId, cleaned.length);
  });
  return listIntensities(categoryId);
}

export function listCategories(userId: string): TileCategoryRow[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, name, color, sort_order, created_at, updated_at
       FROM tile_categories WHERE user_id = ?
       ORDER BY sort_order, name COLLATE NOCASE`,
    )
    .all(userId) as Array<{
    id: string;
    user_id: string;
    name: string;
    color: string | null;
    sort_order: number;
    created_at: number;
    updated_at: number;
  }>;
  return rows.map(mapCategory);
}

export function getCategory(userId: string, categoryId: string): TileCategoryRow | null {
  const row = db
    .prepare(
      `SELECT id, user_id, name, color, sort_order, created_at, updated_at
       FROM tile_categories WHERE id = ? AND user_id = ?`,
    )
    .get(categoryId, userId) as
    | {
        id: string;
        user_id: string;
        name: string;
        color: string | null;
        sort_order: number;
        created_at: number;
        updated_at: number;
      }
    | undefined;
  return row ? mapCategory(row) : null;
}

/** 按名称查找或创建分类（同名不区分大小写） */
export function findOrCreateCategory(
  userId: string,
  name: string,
  color: string | null = null,
): TileCategoryRow {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('分类名不能为空');
  const existing = db
    .prepare(
      `SELECT id, user_id, name, color, sort_order, created_at, updated_at
       FROM tile_categories WHERE user_id = ? AND name = ? COLLATE NOCASE`,
    )
    .get(userId, trimmed) as
    | {
        id: string;
        user_id: string;
        name: string;
        color: string | null;
        sort_order: number;
        created_at: number;
        updated_at: number;
      }
    | undefined;
  if (existing) return mapCategory(existing);

  const now = Date.now();
  const id = newId('tcat');
  const maxSort = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM tile_categories WHERE user_id = ?`)
    .get(userId) as { m: number };
  db.prepare(
    `INSERT INTO tile_categories (id, user_id, name, color, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, trimmed, color, (maxSort.m ?? -1) + 1, now, now);
  return getCategory(userId, id)!;
}

export function createCategory(
  userId: string,
  input: { name: string; color?: string | null; intensities?: string[] },
): TileCategoryRow {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error('分类名不能为空');
  const existing = db
    .prepare(
      `SELECT id FROM tile_categories WHERE user_id = ? AND name = ? COLLATE NOCASE`,
    )
    .get(userId, trimmed) as { id: string } | undefined;
  if (existing) throw new Error('分类名已存在');
  const now = Date.now();
  const id = newId('tcat');
  const maxSort = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM tile_categories WHERE user_id = ?`)
    .get(userId) as { m: number };
  db.prepare(
    `INSERT INTO tile_categories (id, user_id, name, color, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, trimmed, input.color ?? null, (maxSort.m ?? -1) + 1, now, now);
  if (input.intensities?.length) {
    setCategoryIntensities(id, input.intensities);
  }
  return getCategory(userId, id)!;
}

export function updateCategory(
  userId: string,
  categoryId: string,
  input: {
    name?: string;
    color?: string | null;
    sortOrder?: number;
    intensities?: string[];
  },
): TileCategoryRow | null {
  const existing = getCategory(userId, categoryId);
  if (!existing) return null;
  const name = input.name?.trim() ?? existing.name;
  if (!name) throw new Error('分类名不能为空');
  const color = input.color !== undefined ? input.color : existing.color;
  const sortOrder = input.sortOrder ?? existing.sortOrder;
  const clash = db
    .prepare(
      `SELECT id FROM tile_categories
       WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?`,
    )
    .get(userId, name, categoryId) as { id: string } | undefined;
  if (clash) throw new Error('分类名已存在');
  db.prepare(
    `UPDATE tile_categories SET name = ?, color = ?, sort_order = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(name, color, sortOrder, Date.now(), categoryId, userId);
  if (input.intensities !== undefined) {
    setCategoryIntensities(categoryId, input.intensities);
  }
  return getCategory(userId, categoryId);
}

export function deleteCategory(userId: string, categoryId: string): boolean {
  // 解绑指令后再删分类（强度表 CASCADE）
  db.prepare(`UPDATE tiles SET category_id = NULL, intensity_level = NULL WHERE category_id = ? AND user_id = ?`).run(
    categoryId,
    userId,
  );
  const result = db
    .prepare(`DELETE FROM tile_categories WHERE id = ? AND user_id = ?`)
    .run(categoryId, userId);
  return Number(result.changes ?? 0) > 0;
}

/** 用户尚无分类时注入默认三项 */
export function ensureDefaultCategories(userId: string): void {
  const count = db
    .prepare(`SELECT COUNT(*) AS c FROM tile_categories WHERE user_id = ?`)
    .get(userId) as { c: number };
  if (count.c > 0) return;
  for (const name of ['指令', '惩罚', '调教']) {
    findOrCreateCategory(userId, name);
  }
}

function tableHasColumn(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

/**
 * 迁移：建分类表；删「开始/结束」指令；标题→分类；去掉 tiles.kind。
 */
export function migrateTilesToCategories(): void {
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_tile_categories_user ON tile_categories(user_id);
  `);

  const tilesExist = (
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='tiles'`).get() as
      | { name: string }
      | undefined
  )?.name;
  if (!tilesExist) return;

  withTransaction(() => {
    db.prepare(`DELETE FROM tiles WHERE title IN ('开始', '结束')`).run();

    if (!tableHasColumn('tiles', 'category_id')) {
      db.exec(`ALTER TABLE tiles ADD COLUMN category_id TEXT`);
    }

    const pending = db
      .prepare(
        `SELECT id, user_id AS userId, title FROM tiles
         WHERE category_id IS NULL OR category_id = ''`,
      )
      .all() as Array<{ id: string; userId: string; title: string }>;

    for (const t of pending) {
      const cat = findOrCreateCategory(t.userId, t.title.trim() || '未分类');
      db.prepare(`UPDATE tiles SET category_id = ? WHERE id = ?`).run(cat.id, t.id);
    }

    if (tableHasColumn('tiles', 'kind')) {
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`
        CREATE TABLE tiles_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          category_id TEXT REFERENCES tile_categories(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          play_mode TEXT NOT NULL DEFAULT 'multi',
          intensity_level INTEGER,
          tags_json TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO tiles_new (id, user_id, category_id, title, body, created_at, updated_at)
        SELECT id, user_id, category_id, title, body, created_at, updated_at FROM tiles;
        DROP TABLE tiles;
        ALTER TABLE tiles_new RENAME TO tiles;
        CREATE INDEX IF NOT EXISTS idx_tiles_user ON tiles(user_id);
        CREATE INDEX IF NOT EXISTS idx_tiles_category ON tiles(category_id);
      `);
      db.exec('PRAGMA foreign_keys = ON');
    }
  });
}
