import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBlitzedOut } from './blitzedout.js';
import { checkGridCapacity, serpentinePos } from './layout.js';
import { ImportParseError } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));

const SAMPLE = `[開始]
開始
~~
[喉部训练]
2次吸入。. 用舌头描绘玩具头的轮廓
~~
[完成]
無高潮 30%
毀掉的高潮 40%
正常高潮 30%
`;

describe('parseBlitzedOut', () => {
  it('解析块数与首末标题', () => {
    const tiles = parseBlitzedOut(SAMPLE);
    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toEqual({ title: '開始', body: '開始' });
    expect(tiles[1]!.title).toBe('喉部训练');
    expect(tiles[2]!.title).toBe('完成');
    expect(tiles[2]!.body).toContain('無高潮');
  });

  it('支持 \\r\\n 与首尾空白', () => {
    const tiles = parseBlitzedOut(`\r\n[A]\r\nbody\r\n~~\r\n[B]\r\nx\r\n`);
    expect(tiles.map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('缺标题报错', () => {
    expect(() => parseBlitzedOut('没有方括号\n~~\n[ok]\nx')).toThrow(ImportParseError);
  });

  it('空内容报错', () => {
    expect(() => parseBlitzedOut('   ')).toThrow(/为空/);
  });

  it('解析仓库内样例文件', () => {
    const path = resolve(here, '../../../../_tmp_/blitzedout_001.txt');
    const tiles = parseBlitzedOut(readFileSync(path, 'utf8'));
    expect(tiles.length).toBeGreaterThan(50);
    expect(tiles[0]!.title).toMatch(/開始|开始/);
    expect(tiles.at(-1)!.title).toMatch(/完成/);
  });
});

describe('serpentinePos / checkGridCapacity', () => {
  it('C=3 蛇形坐标', () => {
    expect(serpentinePos(0, 3)).toEqual({ col: 0, row: 0 });
    expect(serpentinePos(2, 3)).toEqual({ col: 2, row: 0 });
    expect(serpentinePos(3, 3)).toEqual({ col: 2, row: 1 });
    expect(serpentinePos(5, 3)).toEqual({ col: 0, row: 1 });
    expect(serpentinePos(6, 3)).toEqual({ col: 0, row: 2 });
  });

  it('容量不足时拒绝', () => {
    const r = checkGridCapacity(5, 10, 82);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('82');
  });

  it('容量足够时通过', () => {
    expect(checkGridCapacity(10, 9, 82).ok).toBe(true);
  });
});
