/** 角色占位符解析上下文 */
export interface RolePlaceholderContext {
  /** 当前执行者 */
  player: string;
  /** 支配者显示名 */
  dominant?: string;
  /** 顺从者显示名 */
  submissive?: string;
}

const ROLE_PLACEHOLDERS = [
  { key: '{玩家}', field: 'player' as const },
  { key: '{支配者}', field: 'dominant' as const },
  { key: '{顺从者}', field: 'submissive' as const },
];

/**
 * 将正文中的角色占位符替换为显示名；缺省对应角色时保留原文。
 */
export function resolveRolePlaceholders(
  body: string,
  ctx: RolePlaceholderContext,
): string {
  let out = body;
  for (const { key, field } of ROLE_PLACEHOLDERS) {
    const value = ctx[field];
    if (value != null && value !== '') {
      out = out.split(key).join(value);
    }
  }
  return out;
}

/** 可点选插入的角色占位符（编辑器用） */
export const ROLE_PLACEHOLDER_CHIPS = [
  { token: '{玩家}', label: '玩家' },
  { token: '{支配者}', label: '支配者' },
  { token: '{顺从者}', label: '顺从者' },
] as const;
