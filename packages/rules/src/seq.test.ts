import { describe, expect, it } from 'vitest';
import { fillMissingSeqs, nextSeq, reassignSeq } from './seq.js';

describe('nextSeq', () => {
  it('空列表从 1 起', () => {
    expect(nextSeq([])).toBe(1);
  });

  it('有空缺则补最小空缺', () => {
    expect(nextSeq([1, 4])).toBe(2);
    expect(nextSeq([1, 2, 4])).toBe(3);
  });

  it('连续则取 max+1', () => {
    expect(nextSeq([1, 2, 3])).toBe(4);
  });
});

describe('reassignSeq', () => {
  const cells = [
    { id: 'a', seq: 1 },
    { id: 'b', seq: 2 },
    { id: 'c', seq: 3 },
    { id: 'd', seq: 4 },
  ];

  it('把 4 改成 2：顺延', () => {
    const r = reassignSeq(cells, 'd', 2);
    expect('error' in r).toBe(false);
    const m = r as Map<string, number>;
    expect(m.get('a')).toBe(1);
    expect(m.get('d')).toBe(2);
    expect(m.get('b')).toBe(3);
    expect(m.get('c')).toBe(4);
  });

  it('把 2 改成 4：向前顺延', () => {
    const r = reassignSeq(cells, 'b', 4);
    expect('error' in r).toBe(false);
    const m = r as Map<string, number>;
    expect(m.get('a')).toBe(1);
    expect(m.get('c')).toBe(2);
    expect(m.get('d')).toBe(3);
    expect(m.get('b')).toBe(4);
  });

  it('改到空缺号：直接改', () => {
    const sparse = [
      { id: 'a', seq: 1 },
      { id: 'b', seq: 4 },
    ];
    const r = reassignSeq(sparse, 'b', 2);
    expect('error' in r).toBe(false);
    const m = r as Map<string, number>;
    expect(m.get('a')).toBe(1);
    expect(m.get('b')).toBe(2);
  });

  it('非法序号报错', () => {
    const r = reassignSeq(cells, 'a', 0);
    expect(r).toEqual({ error: '序号须为 ≥1 的整数' });
  });
});

describe('fillMissingSeqs', () => {
  it('为缺号格子补齐且不撞号', () => {
    const filled = fillMissingSeqs([
      { id: 'a', seq: 1 },
      { id: 'b' },
      { id: 'c', seq: 4 },
    ]);
    expect(filled.map((c) => c.seq).sort((x, y) => x - y)).toEqual([1, 2, 4]);
  });
});
