import { ImportParseError, type ImportedTile } from './types.js';

/**
 * 解析 BlitzedOut 导出文本。
 * 块以单独一行的 ~~ 分隔；每块首行为 [标题]，其后为正文。
 */
export function parseBlitzedOut(text: string): ImportedTile[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) {
    throw new ImportParseError('导入内容为空');
  }

  const parts = normalized
    .split(/\n~~\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (!parts.length) {
    throw new ImportParseError('未解析到任何格子块');
  }

  const tiles: ImportedTile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const lines = part.split('\n');
    const head = lines[0]?.trim() ?? '';
    const match = /^\[(.+)\]$/.exec(head);
    if (!match) {
      throw new ImportParseError(`第 ${i + 1} 块缺少 [标题] 行（得到：${head.slice(0, 40) || '空'}）`);
    }
    const title = match[1]!.trim();
    if (!title) {
      throw new ImportParseError(`第 ${i + 1} 块标题为空`);
    }
    const body = lines.slice(1).join('\n').trim();
    tiles.push({ title, body });
  }
  return tiles;
}
