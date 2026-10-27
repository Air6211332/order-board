/**
 * 棋盘槽位几何与出口路径：能直连则直线，否则沿缝折线绕开卡片。
 */

/** 基准卡片宽（普通格） */
export const BASE_CELL_W = 96;
/** 基准卡片高 */
export const BASE_CELL_H = BASE_CELL_W * 1.05;
/** 突出倍率 */
export const EMPHASIS_SCALE = 1.5;
/** 槽位宽（按突出尺寸预留） */
export const SLOT_W = BASE_CELL_W * EMPHASIS_SCALE;
/** 槽位高 */
export const SLOT_H = BASE_CELL_H * EMPHASIS_SCALE;
/** 槽与槽之间的缝隙 */
export const GAP = 36;
/** 外圈留白（折线通道） */
export const PAD = GAP;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 参与布局/避障的格子 */
export interface GeomCell {
  col: number;
  row: number;
  emphasized?: boolean;
}

/** 槽位左上角（不含卡片内缩） */
export function slotOrigin(col: number, row: number): Point {
  return {
    x: PAD + col * (SLOT_W + GAP),
    y: PAD + row * (SLOT_H + GAP),
  };
}

/** 卡片矩形：突出铺满槽位，普通格居中 */
export function cellRect(col: number, row: number, emphasized = false): Rect {
  const origin = slotOrigin(col, row);
  if (emphasized) {
    return { x: origin.x, y: origin.y, w: SLOT_W, h: SLOT_H };
  }
  return {
    x: origin.x + (SLOT_W - BASE_CELL_W) / 2,
    y: origin.y + (SLOT_H - BASE_CELL_H) / 2,
    w: BASE_CELL_W,
    h: BASE_CELL_H,
  };
}

export function cellCenter(col: number, row: number): Point {
  const o = slotOrigin(col, row);
  return { x: o.x + SLOT_W / 2, y: o.y + SLOT_H / 2 };
}

export function boardSize(cols: number, rows: number): { width: number; height: number } {
  return {
    width: PAD * 2 + cols * SLOT_W + Math.max(0, cols - 1) * GAP,
    height: PAD * 2 + rows * SLOT_H + Math.max(0, rows - 1) * GAP,
  };
}

/** 线段与轴对齐矩形是否相交（含穿过内部；仅贴边不算） */
export function segmentHitsRect(a: Point, b: Point, r: Rect, epsilon = 0.5): boolean {
  const left = r.x + epsilon;
  const right = r.x + r.w - epsilon;
  const top = r.y + epsilon;
  const bottom = r.y + r.h - epsilon;
  if (right <= left || bottom <= top) return false;

  // 两端都在矩形外同一侧则不相交
  if (a.x < left && b.x < left) return false;
  if (a.x > right && b.x > right) return false;
  if (a.y < top && b.y < top) return false;
  if (a.y > bottom && b.y > bottom) return false;

  // Liang–Barsky
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-dx, a.x - left)) return false;
  if (!clip(dx, right - a.x)) return false;
  if (!clip(-dy, a.y - top)) return false;
  if (!clip(dy, bottom - a.y)) return false;
  // 交线段长度过短视为贴边掠过
  return t1 - t0 > 1e-4;
}

/**
 * 线段是否穿过「其他」卡片（排除 from/to）。
 * 空槽不算障碍。
 */
export function segmentHitsAnyCard(
  a: Point,
  b: Point,
  cells: GeomCell[],
  from: GeomCell,
  to: GeomCell,
): boolean {
  for (const c of cells) {
    if (c.col === from.col && c.row === from.row) continue;
    if (c.col === to.col && c.row === to.row) continue;
    const rect = cellRect(c.col, c.row, Boolean(c.emphasized));
    if (segmentHitsRect(a, b, rect)) return true;
  }
  return false;
}

/** 从中心指向目标时，卡片边缘上的交点（略向内缩，避免压描边） */
export function edgePointToward(rect: Rect, toward: Point, inset = 2): Point {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    return { x: cx, y: cy };
  }
  const hw = rect.w / 2 - inset;
  const hh = rect.h / 2 - inset;
  const sx = hw / Math.abs(dx);
  const sy = hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

function corridorXs(cols: number): number[] {
  const { width } = boardSize(cols, 1);
  const xs: number[] = [PAD / 2];
  for (let i = 1; i < cols; i++) {
    xs.push(PAD + i * (SLOT_W + GAP) - GAP / 2);
  }
  xs.push(width - PAD / 2);
  return xs;
}

function corridorYs(rows: number): number[] {
  const { height } = boardSize(1, rows);
  const ys: number[] = [PAD / 2];
  for (let i = 1; i < rows; i++) {
    ys.push(PAD + i * (SLOT_H + GAP) - GAP / 2);
  }
  ys.push(height - PAD / 2);
  return ys;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 找离目标点最近的通道交点下标 */
function nearestNode(
  p: Point,
  xs: number[],
  ys: number[],
): { i: number; j: number; point: Point } {
  let bestI = 0;
  let bestJ = 0;
  let bestD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < ys.length; j++) {
      const d = Math.hypot(xs[i]! - p.x, ys[j]! - p.y);
      if (d < bestD) {
        bestD = d;
        bestI = i;
        bestJ = j;
      }
    }
  }
  return { i: bestI, j: bestJ, point: { x: xs[bestI]!, y: ys[bestJ]! } };
}

/**
 * A*：在通道交点网格上走正交边，转弯略加代价。
 */
function astarCorridor(
  startI: number,
  startJ: number,
  goalI: number,
  goalJ: number,
  xs: number[],
  ys: number[],
): Point[] {
  const turnPenalty = GAP * 0.35;
  type State = { i: number; j: number; di: number; dj: number };
  const stateKey = (s: State) => `${s.i},${s.j},${s.di},${s.dj}`;
  const start: State = { i: startI, j: startJ, di: 0, dj: 0 };
  const open: Array<{ s: State; g: number; f: number }> = [];
  const came = new Map<string, { prev: string | null; point: Point }>();
  const gScore = new Map<string, number>();

  const h = (i: number, j: number) =>
    Math.abs(xs[i]! - xs[goalI]!) + Math.abs(ys[j]! - ys[goalJ]!);

  open.push({ s: start, g: 0, f: h(startI, startJ) });
  gScore.set(stateKey(start), 0);
  came.set(stateKey(start), {
    prev: null,
    point: { x: xs[startI]!, y: ys[startJ]! },
  });

  const dirs = [
    { di: 1, dj: 0 },
    { di: -1, dj: 0 },
    { di: 0, dj: 1 },
    { di: 0, dj: -1 },
  ];

  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift()!;
    const sk = stateKey(cur.s);
    if (cur.s.i === goalI && cur.s.j === goalJ) {
      const path: Point[] = [];
      let key: string | null = sk;
      while (key) {
        const node: { prev: string | null; point: Point } = came.get(key)!;
        path.push(node.point);
        key = node.prev;
      }
      path.reverse();
      return simplifyOrthogonal(path);
    }
    if ((gScore.get(sk) ?? Infinity) < cur.g - 1e-6) continue;

    for (const d of dirs) {
      const ni = cur.s.i + d.di;
      const nj = cur.s.j + d.dj;
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue;
      const step = Math.hypot(xs[ni]! - xs[cur.s.i]!, ys[nj]! - ys[cur.s.j]!);
      let turn = 0;
      if (cur.s.di !== 0 || cur.s.dj !== 0) {
        if (cur.s.di !== d.di || cur.s.dj !== d.dj) turn = turnPenalty;
      }
      const ng = cur.g + step + turn;
      const next: State = { i: ni, j: nj, di: d.di, dj: d.dj };
      const nk = stateKey(next);
      if (ng >= (gScore.get(nk) ?? Infinity) - 1e-6) continue;
      gScore.set(nk, ng);
      came.set(nk, {
        prev: sk,
        point: { x: xs[ni]!, y: ys[nj]! },
      });
      open.push({ s: next, g: ng, f: ng + h(ni, nj) });
    }
  }
  // 不可达时退回起终点直连通道点
  return [
    { x: xs[startI]!, y: ys[startJ]! },
    { x: xs[goalI]!, y: ys[goalJ]! },
  ];
}

/** 去掉共线中间点 */
function simplifyOrthogonal(points: Point[]): Point[] {
  if (points.length <= 2) return points;
  const out: Point[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;
    const colinear =
      (Math.abs(prev.x - cur.x) < 1e-6 && Math.abs(cur.x - next.x) < 1e-6) ||
      (Math.abs(prev.y - cur.y) < 1e-6 && Math.abs(cur.y - next.y) < 1e-6);
    if (!colinear) out.push(cur);
  }
  out.push(points[points.length - 1]!);
  return out;
}

/**
 * 出口路径：边缘到边缘。不撞其他卡则两点直线，否则沿缝折线。
 */
export function routeExit(
  from: GeomCell,
  to: GeomCell,
  cells: GeomCell[],
  cols: number,
  rows: number,
): Point[] {
  const fromRect = cellRect(from.col, from.row, Boolean(from.emphasized));
  const toRect = cellRect(to.col, to.row, Boolean(to.emphasized));
  const fromC = cellCenter(from.col, from.row);
  const toC = cellCenter(to.col, to.row);
  const p1 = edgePointToward(fromRect, toC);
  const p2 = edgePointToward(toRect, fromC);

  if (!segmentHitsAnyCard(p1, p2, cells, from, to)) {
    return [p1, p2];
  }

  const xs = corridorXs(cols);
  const ys = corridorYs(rows);
  const start = nearestNode(p1, xs, ys);
  const goal = nearestNode(p2, xs, ys);
  const mid = astarCorridor(start.i, start.j, goal.i, goal.j, xs, ys);

  const path = [p1, ...mid, p2];
  // 若首/尾与通道点几乎重合则去掉多余点
  return dedupeClose(path);
}

function dedupeClose(points: Point[], eps = 1.5): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && dist(last, p) < eps) continue;
    out.push(p);
  }
  return out.length >= 2 ? out : points;
}

/** 路径中点（标签用）：取最长一段的中点 */
export function pathLabelPoint(points: Point[]): Point {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < points.length - 1; i++) {
    const len = dist(points[i]!, points[i + 1]!);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  const a = points[best]!;
  const b = points[best + 1]!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
