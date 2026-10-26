/**
 * 取最小空缺正整数序号；无空缺则返回 max+1。
 * 例：[] → 1；[1,4] → 2；[1,2,3] → 4
 */
export function nextSeq(seqs: number[]): number {
  const used = new Set(seqs.filter((n) => Number.isInteger(n) && n >= 1));
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

export interface SeqCell {
  id: string;
  seq: number;
}

/**
 * 将指定格子序号改为 newSeq；若冲突则区间顺延。
 * - 改小且占用：`[new, old)` 整体 +1，再设目标为 new
 * - 改大且占用：`(old, new]` 整体 -1，再设目标为 new
 * - 无占用：直接改
 * 返回新的 id→seq 映射（含未改动的格子）。
 */
export function reassignSeq(
  cells: SeqCell[],
  cellId: string,
  newSeq: number,
): Map<string, number> | { error: string } {
  if (!Number.isInteger(newSeq) || newSeq < 1) {
    return { error: '序号须为 ≥1 的整数' };
  }
  const target = cells.find((c) => c.id === cellId);
  if (!target) {
    return { error: `格子不存在: ${cellId}` };
  }
  const old = target.seq;
  const result = new Map(cells.map((c) => [c.id, c.seq]));
  if (old === newSeq) return result;

  const occupiedByOther = cells.some((c) => c.id !== cellId && c.seq === newSeq);

  if (!occupiedByOther) {
    result.set(cellId, newSeq);
    return result;
  }

  if (newSeq < old) {
    // [new, old) +1
    for (const c of cells) {
      if (c.id === cellId) continue;
      if (c.seq >= newSeq && c.seq < old) {
        result.set(c.id, c.seq + 1);
      }
    }
    result.set(cellId, newSeq);
  } else {
    // (old, new] -1
    for (const c of cells) {
      if (c.id === cellId) continue;
      if (c.seq > old && c.seq <= newSeq) {
        result.set(c.id, c.seq - 1);
      }
    }
    result.set(cellId, newSeq);
  }
  return result;
}

/** 为缺少合法 seq 的格子按当前顺序补 1..n（迁移用） */
export function fillMissingSeqs<T extends { id: string; seq?: number }>(
  cells: T[],
): Array<T & { seq: number }> {
  const used = new Set<number>();
  const out: Array<T & { seq: number }> = [];
  for (const c of cells) {
    if (Number.isInteger(c.seq) && (c.seq as number) >= 1 && !used.has(c.seq as number)) {
      used.add(c.seq as number);
      out.push({ ...c, seq: c.seq as number });
    } else {
      out.push({ ...c, seq: 0 }); // 占位，第二遍分配
    }
  }
  for (const c of out) {
    if (c.seq === 0) {
      const n = nextSeq([...used]);
      c.seq = n;
      used.add(n);
    }
  }
  return out;
}
