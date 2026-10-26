import { describe, expect, it } from 'vitest';
import { resolveRolePlaceholders } from './placeholders.js';

describe('resolveRolePlaceholders', () => {
  it('替换全部角色占位符', () => {
    const text = '{支配者} 指挥 {顺从者}，当前轮到 {玩家}';
    expect(
      resolveRolePlaceholders(text, {
        player: '阿明',
        dominant: '小王',
        submissive: '小李',
      }),
    ).toBe('小王 指挥 小李，当前轮到 阿明');
  });

  it('缺角色时保留原文', () => {
    expect(
      resolveRolePlaceholders('{支配者}看{玩家}', { player: '阿明' }),
    ).toBe('{支配者}看阿明');
  });
});
