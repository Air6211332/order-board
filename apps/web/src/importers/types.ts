/** 可扩展的导入来源 */
export type ImportSourceId = 'blitzedout';

/** 解析后的单格内容（尚未落库） */
export interface ImportedTile {
  title: string;
  body: string;
}

export interface ImportSourceMeta {
  id: ImportSourceId;
  label: string;
}

export class ImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportParseError';
  }
}
