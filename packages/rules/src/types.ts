/**
 * 多出口分叉模式（仅 exits.length >= 2 时生效）
 * - advance_die：用本回合前进骰原点数查 faces
 * - reroll_die：另掷一颗骰再查 faces
 * - status：状态栏指定（本版未实现）
 * - player_choice：玩家自选（默认）
 */
export type ForkMode = 'advance_die' | 'reroll_die' | 'status' | 'player_choice';

/**
 * 结束格模式
 * - direct：进入即结束该玩家
 * - bounce：有残值则沿本回合轨迹后退；刚好落定则结束
 */
export type EndMode = 'direct' | 'bounce';

/** 棋盘/指令的游戏模式 */
export type PlayMode = 'solo' | 'multi';

/** 格子上绑定的指令（可序列化快照；分类由用户自定义） */
export interface BoundTile {
  id: string;
  /** 分类显示名 */
  category: string;
  /** 可选分类色（CSS 色值） */
  categoryColor?: string;
  title: string;
  /** 含占位符的原文；展示时用 resolveRolePlaceholders 解析 */
  body: string;
  playMode?: PlayMode;
  /** 强度标签文案（快照时解析） */
  intensityLabel?: string;
  tags?: string[];
}

/** @deprecated 旧版固定种类，仅兼容旧快照解析 */
export type TileKind = 'order' | 'punishment' | 'training';

/** 从一个格指向另一个格的出口 */
export interface Exit {
  id: string;
  toCellId: string;
  /** 显示名，分叉时展示给玩家 */
  label: string;
  /** 模式一/二：该出口对应的骰子点数（1–6） */
  faces?: number[];
}

/** 棋盘上的一格 */
export interface Cell {
  id: string;
  /** 网格列（0 起） */
  col: number;
  /** 网格行（0 起） */
  row: number;
  /** 本盘序号（≥1，唯一；可有空缺） */
  seq: number;
  /** 格子标题（可空） */
  title?: string;
  /** 绑定指令；空格可为拐弯用 */
  tile?: BoundTile;
  exits: Exit[];
  /** 多出口时的分叉模式；缺省为 player_choice */
  forkMode?: ForkMode;
  /** 结束格模式；缺省表示非结束格 */
  endMode?: EndMode;
}

/** 开局用的棋盘定义 */
export interface BoardDefinition {
  id: string;
  name: string;
  cols: number;
  rows: number;
  /** 默认起点（须属于 startCellIds） */
  startCellId: string;
  /** 全部起点（至少 1 个） */
  startCellIds: string[];
  cells: Cell[];
}

/** 桌上玩家（本局内存） */
export interface Player {
  id: string;
  name: string;
  /** 当前所在格子 */
  cellId: string;
  /** 已到达终点，不再行动 */
  finished: boolean;
}

/** 回合阶段 */
export type Phase =
  | 'pick_start'
  | 'roll'
  | 'choose_exit'
  | 'order'
  | 'ended';

export interface PendingChoice {
  /** 还有多少步要走（含当前这一步） */
  stepsRemaining: number;
  /** 当前格给出的可选出口 */
  exits: Exit[];
  /** 本回合已走过的轨迹（供残值后退） */
  pathStack: string[];
}

export interface PendingOrder {
  tile: BoundTile;
  cellId: string;
}

/** 可序列化的对局快照 */
export interface GameState {
  board: BoardDefinition;
  players: Player[];
  /** 当前行动玩家下标 */
  currentPlayerIndex: number;
  phase: Phase;
  /** 最近一次前进掷骰结果（整段行走不变） */
  lastRoll: number | null;
  /** 最近一次分叉独立骰结果（模式二） */
  lastBranchRoll: number | null;
  pendingChoice: PendingChoice | null;
  pendingOrder: PendingOrder | null;
}

export type GameEvent =
  | { type: 'started' }
  | { type: 'start_picked'; playerId: string; cellId: string }
  | { type: 'rolled'; value: number }
  | { type: 'branch_rolled'; value: number; cellId: string }
  | { type: 'moved'; playerId: string; fromCellId: string; toCellId: string; viaExitId: string }
  | { type: 'retreated'; playerId: string; fromCellId: string; toCellId: string }
  | { type: 'need_choice'; exits: Exit[]; stepsRemaining: number }
  | { type: 'order'; tile: BoundTile; cellId: string }
  | { type: 'player_finished'; playerId: string; cellId: string }
  | { type: 'turn_advanced'; playerId: string }
  | { type: 'ended' };
