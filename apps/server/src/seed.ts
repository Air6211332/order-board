/**
 * 为演示账号写入中性示例指令与棋盘（可删除）。
 * 用法：npm run seed -w @order-board/server
 * 账号：demo / demo1234
 */
import { hashPassword, newId, newUserId } from './auth.js';
import { createTile, saveBoard } from './boards.js';
import { findOrCreateCategory } from './categories.js';
import { db } from './db.js';

const username = 'demo';
const password = 'demo1234';

let user = db
  .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
  .get(username) as { id: string } | undefined;

if (!user) {
  const id = newUserId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at, is_temp, last_active_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(id, username, hashPassword(password), now, now);
  user = { id };
  console.log(`已创建用户 ${username} / ${password}`);
} else {
  console.log(`用户 ${username} 已存在，继续写入示例内容`);
}

const existingBoards = db
  .prepare('SELECT id FROM boards WHERE user_id = ? AND name = ?')
  .get(user.id, '示例小径') as { id: string } | undefined;

if (existingBoards) {
  // 旧示例可能没有分叉模式：把双出口格升为模式一并补全 faces
  const forkCells = db
    .prepare(
      `SELECT c.id FROM cells c
       WHERE c.board_id = ?
         AND (SELECT COUNT(*) FROM exits e WHERE e.from_cell_id = c.id) >= 2`,
    )
    .all(existingBoards.id) as Array<{ id: string }>;
  for (const cell of forkCells) {
    db.prepare(`UPDATE cells SET fork_mode = 'advance_die' WHERE id = ?`).run(cell.id);
    const outs = db
      .prepare(`SELECT id FROM exits WHERE from_cell_id = ? ORDER BY id`)
      .all(cell.id) as Array<{ id: string }>;
    if (outs[0]) {
      db.prepare(`UPDATE exits SET faces_json = ? WHERE id = ?`).run(
        JSON.stringify([1, 2, 3]),
        outs[0].id,
      );
    }
    if (outs[1]) {
      db.prepare(`UPDATE exits SET faces_json = ? WHERE id = ?`).run(
        JSON.stringify([4, 5, 6]),
        outs[1].id,
      );
    }
  }
  // 补起点 / 结束格（会合格）
  const boardRow = db
    .prepare(`SELECT start_cell_id FROM boards WHERE id = ?`)
    .get(existingBoards.id) as { start_cell_id: string | null };
  if (boardRow.start_cell_id) {
    db.prepare(`UPDATE cells SET is_start = 1 WHERE id = ?`).run(boardRow.start_cell_id);
  }
  const meet = db
    .prepare(`SELECT id FROM cells WHERE board_id = ? AND title = '会合'`)
    .get(existingBoards.id) as { id: string } | undefined;
  if (meet) {
    db.prepare(`UPDATE cells SET end_mode = 'direct', title = '终点' WHERE id = ?`).run(meet.id);
  }
  console.log('示例棋盘已存在，已尝试补齐分叉/起点/终点配置');
  process.exit(0);
}

const catOrder = findOrCreateCategory(user.id, '指令');
const squat = createTile(user.id, {
  categoryId: catOrder.id,
  title: '深蹲',
  body: '做 10 个深蹲',
});
const stretch = createTile(user.id, {
  categoryId: catOrder.id,
  title: '拉伸',
  body: '拉伸大腿 30 秒',
});
const clap = createTile(user.id, {
  categoryId: catOrder.id,
  title: '击掌',
  body: '双手击掌 5 次',
});

const c0 = newId('cell');
const c1 = newId('cell');
const c2 = newId('cell');
const c3 = newId('cell');
const c4 = newId('cell');
const cFork = newId('cell');
const cLeft = newId('cell');
const cRight = newId('cell');

const result = saveBoard(user.id, null, {
  name: '示例小径',
  cols: 5,
  rows: 3,
  startCellId: c0,
  cells: [
    { id: c0, col: 0, row: 1, tileId: null, seq: 1, title: '起点', isStart: true },
    { id: c1, col: 1, row: 1, tileId: null, seq: 2, title: '小路' },
    // 分叉格：模式一，前进骰 1–3 走上、4–6 走下
    { id: cFork, col: 2, row: 1, tileId: null, forkMode: 'advance_die', seq: 3, title: '分叉' },
    { id: cLeft, col: 3, row: 0, tileId: squat.id, seq: 4, title: '上路' },
    { id: cRight, col: 3, row: 2, tileId: stretch.id, seq: 5, title: '下路' },
    { id: c2, col: 4, row: 0, tileId: clap.id, seq: 6, title: '击掌格' },
    { id: c3, col: 4, row: 1, tileId: null, seq: 7, title: '终点', endMode: 'direct' },
    { id: c4, col: 4, row: 2, tileId: null, seq: 8, title: '回廊' },
  ],
  exits: [
    { fromCellId: c0, toCellId: c1, label: '前进' },
    { fromCellId: c1, toCellId: cFork, label: '前进' },
    { fromCellId: cFork, toCellId: cLeft, label: '上', faces: [1, 2, 3] },
    { fromCellId: cFork, toCellId: cRight, label: '下', faces: [4, 5, 6] },
    { fromCellId: cLeft, toCellId: c2, label: '前进' },
    { fromCellId: cRight, toCellId: c4, label: '前进' },
    { fromCellId: c2, toCellId: c3, label: '会合' },
    { fromCellId: c4, toCellId: c3, label: '会合' },
  ],
});

if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}

console.log(`示例棋盘已写入: ${result.board.id}`);
console.log('登录 demo / demo1234 后即可编辑或开玩。');
