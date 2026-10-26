/** 蛇形路径：偶数行左→右，奇数行右→左 */
export function serpentinePos(index: number, cols: number): { col: number; row: number } {
  if (cols < 1) throw new Error('列数须 ≥ 1');
  if (index < 0) throw new Error('序号无效');
  const row = Math.floor(index / cols);
  const x = index % cols;
  const col = row % 2 === 0 ? x : cols - 1 - x;
  return { col, row };
}

/** 校验网格能否容纳 N 格蛇形铺盘 */
export function checkGridCapacity(
  cols: number,
  rows: number,
  need: number,
): { ok: true } | { ok: false; error: string } {
  const capacity = cols * rows;
  if (need < 1) {
    return { ok: false, error: '导入内容为空' };
  }
  if (capacity < need) {
    return {
      ok: false,
      error: `当前网格 ${cols}×${rows}=${capacity}，导入需要 ${need} 格，请先加大行列`,
    };
  }
  return { ok: true };
}
