import { parseBlitzedOut } from './blitzedout.js';
import { ImportParseError, type ImportSourceId, type ImportSourceMeta, type ImportedTile } from './types.js';

export type { ImportSourceId, ImportSourceMeta, ImportedTile } from './types.js';
export { ImportParseError } from './types.js';
export { serpentinePos, checkGridCapacity } from './layout.js';
export { parseBlitzedOut } from './blitzedout.js';

export const IMPORT_SOURCES: ImportSourceMeta[] = [
  { id: 'blitzedout', label: 'BlitzedOut' },
];

/** 按来源解析导入文本 */
export function parseImport(source: ImportSourceId, text: string): ImportedTile[] {
  switch (source) {
    case 'blitzedout':
      return parseBlitzedOut(text);
    default: {
      const _exhaustive: never = source;
      throw new ImportParseError(`未知导入来源: ${_exhaustive}`);
    }
  }
}
