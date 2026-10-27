import { describe, expect, it } from 'vitest';
import {
  GAP,
  boardSize,
  cellRect,
  routeExit,
  segmentHitsAnyCard,
  type GeomCell,
} from './boardGeom';

function filled(col: number, row: number, emphasized = false): GeomCell {
  return { col, row, emphasized };
}

/** 折线段是否与任意卡片相交（端点可贴边，不计入该端点所属格） */
function pathHitsCards(
  points: Array<{ x: number; y: number }>,
  cells: GeomCell[],
  from: GeomCell,
  to: GeomCell,
): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (segmentHitsAnyCard(a, b, cells, from, to)) return true;
  }
  return false;
}

describe('boardGeom 槽位', () => {
  it('两格都突出时，卡片边缘间距等于 GAP', () => {
    const a = cellRect(0, 0, true);
    const b = cellRect(1, 0, true);
    expect(b.x - (a.x + a.w)).toBe(GAP);
  });

  it('普通格居中于突出尺寸槽位内', () => {
    const slot = cellRect(0, 0, true);
    const plain = cellRect(0, 0, false);
    expect(plain.w).toBeLessThan(slot.w);
    expect(plain.h).toBeLessThan(slot.h);
    expect(plain.x + plain.w / 2).toBeCloseTo(slot.x + slot.w / 2);
    expect(plain.y + plain.h / 2).toBeCloseTo(slot.y + slot.h / 2);
  });

  it('棋盘尺寸含外圈留白', () => {
    const { width, height } = boardSize(2, 2);
    const last = cellRect(1, 1, true);
    expect(width).toBeGreaterThan(last.x + last.w);
    expect(height).toBeGreaterThan(last.y + last.h);
  });
});

describe('boardGeom routeExit', () => {
  it('正交相邻用两点直线', () => {
    const cells = [filled(0, 0), filled(1, 0)];
    const path = routeExit(cells[0]!, cells[1]!, cells, 3, 2);
    expect(path).toHaveLength(2);
    expect(pathHitsCards(path, cells, cells[0]!, cells[1]!)).toBe(false);
  });

  it('斜向且中间无卡时保持直线', () => {
    const cells = [filled(0, 0), filled(1, 1)];
    const path = routeExit(cells[0]!, cells[1]!, cells, 3, 3);
    expect(path).toHaveLength(2);
    expect(pathHitsCards(path, cells, cells[0]!, cells[1]!)).toBe(false);
  });

  it('直线会穿过卡片时改折线，且不撞卡', () => {
    const cells = [filled(0, 0), filled(1, 0), filled(2, 0)];
    const from = cells[0]!;
    const to = cells[2]!;
    const path = routeExit(from, to, cells, 3, 2);
    expect(path.length).toBeGreaterThan(2);
    expect(pathHitsCards(path, cells, from, to)).toBe(false);
  });

  it('全部突出时被挡住的出口仍可在缝里绕开', () => {
    const cells: GeomCell[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        cells.push(filled(c, r, true));
      }
    }
    const from = cells.find((c) => c.col === 0 && c.row === 0)!;
    const to = cells.find((c) => c.col === 2 && c.row === 0)!;
    const path = routeExit(from, to, cells, 3, 3);
    expect(path.length).toBeGreaterThan(2);
    expect(pathHitsCards(path, cells, from, to)).toBe(false);
  });

  it('中间空槽的跨格可走直线', () => {
    const cells = [filled(0, 0), filled(2, 0)];
    const path = routeExit(cells[0]!, cells[1]!, cells, 3, 2);
    expect(path).toHaveLength(2);
  });
});
