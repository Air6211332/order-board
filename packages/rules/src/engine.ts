import type {
  BoardDefinition,
  Cell,
  DiceSpec,
  Exit,
  ForkMode,
  GameEvent,
  GameState,
  Player,
} from './types.js';

export class RulesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RulesError';
  }
}

/** 缺省全局骰：1d6 */
export const DEFAULT_DICE: DiceSpec = { count: 1, sides: 6 };

/** 校验骰子规格是否合法 */
export function isValidDiceSpec(spec: DiceSpec): boolean {
  return (
    Number.isInteger(spec.count) &&
    spec.count >= 1 &&
    spec.count <= 4 &&
    Number.isInteger(spec.sides) &&
    spec.sides >= 2 &&
    spec.sides <= 100
  );
}

/** 棋盘全局骰（非法或缺省 → 1d6） */
export function resolveBoardDice(board: BoardDefinition): DiceSpec {
  if (board.dice && isValidDiceSpec(board.dice)) return board.dice;
  return { ...DEFAULT_DICE };
}

/** 模式二分叉用骰：本格独立或全局 */
export function resolveForkDice(cell: Cell, board: BoardDefinition): DiceSpec {
  if (cell.forkDice && isValidDiceSpec(cell.forkDice)) return cell.forkDice;
  return resolveBoardDice(board);
}

/** 合计点数区间 [count, count×sides] */
export function diceRange(spec: DiceSpec): { min: number; max: number } {
  return { min: spec.count, max: spec.count * spec.sides };
}

/** 格式化为 NdS */
export function formatDiceSpec(spec: DiceSpec): string {
  return `${spec.count}d${spec.sides}`;
}

/**
 * 按规格掷骰并求和。
 * `rollFace` 每次返回一颗骰的点数（1…sides）；缺省均匀随机。
 */
export function rollDice(spec: DiceSpec, rollFace?: () => number): number {
  if (!isValidDiceSpec(spec)) {
    throw new RulesError(`无效骰子规格: ${spec.count}d${spec.sides}`);
  }
  const face =
    rollFace ?? (() => Math.floor(Math.random() * spec.sides) + 1);
  let sum = 0;
  for (let i = 0; i < spec.count; i++) {
    const f = face();
    if (!Number.isInteger(f) || f < 1 || f > spec.sides) {
      throw new RulesError(`骰面须为 1–${spec.sides}，收到 ${f}`);
    }
    sum += f;
  }
  return sum;
}

/** 深拷贝可序列化对局快照（兼容 Vue Proxy，不用 structuredClone） */
function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cellMap(board: BoardDefinition): Map<string, BoardDefinition['cells'][number]> {
  return new Map(board.cells.map((c) => [c.id, c]));
}

function requireCell(board: BoardDefinition, cellId: string) {
  const cell = cellMap(board).get(cellId);
  if (!cell) {
    throw new RulesError(`格子不存在: ${cellId}`);
  }
  return cell;
}

/** 解析起点列表（兼容旧盘只有 startCellId） */
export function resolveStartCellIds(board: BoardDefinition): string[] {
  if (board.startCellIds?.length) return [...board.startCellIds];
  if (board.startCellId) return [board.startCellId];
  return [];
}

export function resolveForkMode(cell: { forkMode?: ForkMode; exits: Exit[] }): ForkMode {
  if (cell.exits.length < 2) return 'player_choice';
  return cell.forkMode ?? 'player_choice';
}

/**
 * 按合计点数选出口：先命中 faces，否则走 isDefault；皆无则报错。
 */
export function pickExitByFace(exits: Exit[], face: number): Exit {
  const found = exits.find((e) => (e.faces ?? []).includes(face));
  if (found) return found;
  const fallback = exits.find((e) => e.isDefault);
  if (fallback) return fallback;
  throw new RulesError(`点数 ${face} 未映射到任何出口`);
}

/** 模式一/二点数映射校验（含默认出口） */
export function validateDieFaces(cellId: string, exits: Exit[], spec: DiceSpec): string[] {
  const errors: string[] = [];
  if (!isValidDiceSpec(spec)) {
    errors.push(`格子 ${cellId} 分叉骰规格无效: ${spec.count}d${spec.sides}`);
    return errors;
  }
  const { min, max } = diceRange(spec);
  const defaults = exits.filter((e) => e.isDefault);
  if (defaults.length > 1) {
    errors.push(
      `格子 ${cellId} 有多个默认出口：${defaults.map((e) => e.id).join(', ')}`,
    );
  }
  const owner = new Map<number, string>();
  for (const exit of exits) {
    for (const face of exit.faces ?? []) {
      if (!Number.isInteger(face) || face < min || face > max) {
        errors.push(
          `格子 ${cellId} 出口 ${exit.id} 含非法点数 ${face}（有效 ${min}–${max}）`,
        );
        continue;
      }
      const prev = owner.get(face);
      if (prev) {
        errors.push(`格子 ${cellId} 点数 ${face} 同时属于出口 ${prev} 与 ${exit.id}`);
      } else {
        owner.set(face, exit.id);
      }
    }
  }
  if (defaults.length === 0) {
    for (let f = min; f <= max; f++) {
      if (!owner.has(f)) {
        errors.push(`格子 ${cellId} 的点数映射未覆盖 ${f}`);
      }
    }
  }
  return errors;
}

/**
 * 校验棋盘定义是否可开局。
 * 须至少一格、≥1 起点、≥1 结束格；模式一/二多出口须覆盖有效点数或有默认。
 */
export function validateBoard(board: BoardDefinition): string[] {
  const errors: string[] = [];
  if (!board.cells.length) {
    errors.push('棋盘至少需要一格');
  }
  if (board.dice != null && !isValidDiceSpec(board.dice)) {
    errors.push(`棋盘全局骰无效: ${board.dice.count}d${board.dice.sides}`);
  }
  const boardDice = resolveBoardDice(board);
  const ids = new Set(board.cells.map((c) => c.id));
  const startIds = resolveStartCellIds(board);
  if (!startIds.length) {
    errors.push('请至少设置一个起点');
  } else {
    for (const sid of startIds) {
      if (!ids.has(sid)) {
        errors.push(`起点格子不存在: ${sid}`);
      }
    }
    if (board.startCellId && !startIds.includes(board.startCellId)) {
      errors.push(`默认起点 ${board.startCellId} 不在起点列表中`);
    } else if (!board.startCellId || !ids.has(board.startCellId)) {
      errors.push(`默认起点格子不存在: ${board.startCellId}`);
    }
  }

  let endCount = 0;
  const seqOwner = new Map<number, string>();
  for (const cell of board.cells) {
    if (cell.endMode === 'direct' || cell.endMode === 'bounce') {
      endCount += 1;
    } else if (cell.endMode != null) {
      errors.push(`格子 ${cell.id} 的结束模式无效: ${cell.endMode}`);
    }
    if (!Number.isInteger(cell.seq) || cell.seq < 1) {
      errors.push(`格子 ${cell.id} 的序号无效: ${cell.seq}`);
    } else {
      const prev = seqOwner.get(cell.seq);
      if (prev) {
        errors.push(`序号 ${cell.seq} 同时属于 ${prev} 与 ${cell.id}`);
      } else {
        seqOwner.set(cell.seq, cell.id);
      }
    }
    if (cell.forkDice != null && !isValidDiceSpec(cell.forkDice)) {
      errors.push(`格子 ${cell.id} 独立分叉骰无效: ${cell.forkDice.count}d${cell.forkDice.sides}`);
    }
    for (const exit of cell.exits) {
      if (!ids.has(exit.toCellId)) {
        errors.push(`格子 ${cell.id} 的出口 ${exit.id} 指向不存在的格子 ${exit.toCellId}`);
      }
    }
    if (cell.exits.length < 2) continue;
    const mode = resolveForkMode(cell);
    if (mode === 'status') {
      errors.push(`格子 ${cell.id} 使用状态分叉（尚未实现），请改用其他模式`);
    } else if (mode === 'advance_die') {
      errors.push(...validateDieFaces(cell.id, cell.exits, boardDice));
    } else if (mode === 'reroll_die') {
      errors.push(...validateDieFaces(cell.id, cell.exits, resolveForkDice(cell, board)));
    }
  }
  if (endCount < 1) {
    errors.push('请至少设置一个结束格');
  }
  return errors;
}

export interface StartGameOptions {
  board: BoardDefinition;
  /** 玩家显示名，1–6 人 */
  playerNames: string[];
  /** 可选：注入掷骰，便于测试（前进骰与分叉独立骰共用） */
  rollDie?: () => number;
}

/**
 * 创建一局。棋子放在默认起点；单起点直接进入掷骰，多起点进入选起点。
 */
export function startGame(options: StartGameOptions): { state: GameState; events: GameEvent[] } {
  const { board, playerNames } = options;
  if (playerNames.length < 1 || playerNames.length > 6) {
    throw new RulesError('玩家人数须为 1–6');
  }
  const errors = validateBoard(board);
  if (errors.length) {
    throw new RulesError(errors.join('；'));
  }

  const startIds = resolveStartCellIds(board);
  const normalizedBoard: BoardDefinition = {
    ...board,
    startCellIds: startIds,
  };

  const players: Player[] = playerNames.map((name, i) => ({
    id: `p${i + 1}`,
    name: name.trim() || `玩家${i + 1}`,
    cellId: normalizedBoard.startCellId,
    finished: false,
  }));

  const multiStart = startIds.length >= 2;
  const state: GameState = {
    board: normalizedBoard,
    players,
    currentPlayerIndex: 0,
    phase: multiStart ? 'pick_start' : 'roll',
    lastRoll: null,
    lastBranchRoll: null,
    pendingChoice: null,
    pendingOrder: null,
  };

  return { state, events: [{ type: 'started' }] };
}

/**
 * 多起点开局：当前玩家选择起点；全员选完后进入掷骰。
 */
export function pickStart(
  state: GameState,
  cellId: string,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'pick_start') {
    throw new RulesError(`当前阶段不能选起点: ${state.phase}`);
  }
  const startIds = resolveStartCellIds(state.board);
  if (!startIds.includes(cellId)) {
    throw new RulesError(`不是合法起点: ${cellId}`);
  }

  const next: GameState = cloneState(state);
  const player = currentPlayer(next);
  player.cellId = cellId;
  const events: GameEvent[] = [{ type: 'start_picked', playerId: player.id, cellId }];

  if (next.currentPlayerIndex >= next.players.length - 1) {
    next.currentPlayerIndex = 0;
    next.phase = 'roll';
  } else {
    next.currentPlayerIndex += 1;
  }
  return { state: next, events };
}

function currentPlayer(state: GameState): Player {
  return state.players[state.currentPlayerIndex]!;
}

function allFinished(state: GameState): boolean {
  return state.players.every((p) => p.finished);
}

function finishPlayer(state: GameState, events: GameEvent[]): void {
  const player = currentPlayer(state);
  player.finished = true;
  state.pendingChoice = null;
  state.pendingOrder = null;
  events.push({ type: 'player_finished', playerId: player.id, cellId: player.cellId });
  if (allFinished(state)) {
    state.phase = 'ended';
    state.lastRoll = null;
    state.lastBranchRoll = null;
    events.push({ type: 'ended' });
  } else {
    advanceTurn(state, events);
  }
}

/** 沿本回合轨迹后退；轨迹不足则停在出发格 */
function retreatAlongPath(
  state: GameState,
  pathStack: string[],
  steps: number,
  events: GameEvent[],
): void {
  const player = currentPlayer(state);
  let left = steps;
  while (left > 0 && pathStack.length > 0) {
    const prev = pathStack.pop()!;
    const fromCellId = player.cellId;
    player.cellId = prev;
    events.push({
      type: 'retreated',
      playerId: player.id,
      fromCellId,
      toCellId: prev,
    });
    left -= 1;
  }
}

/**
 * 沿出口走一步；若需要玩家选择则写入 pendingChoice 并停住。
 * 返回是否仍有剩余步数需要继续（且未进入选出口）。
 */
function advanceOneStep(
  state: GameState,
  stepsRemaining: number,
  events: GameEvent[],
  rollDie: (() => number) | undefined,
  pathStack: string[],
  chosenExitId?: string,
): { continueWalking: boolean } {
  const player = currentPlayer(state);
  if (player.finished) {
    return { continueWalking: false };
  }
  const cell = requireCell(state.board, player.cellId);
  const exits = cell.exits;

  if (exits.length === 0) {
    settleLanding(state, events);
    return { continueWalking: false };
  }

  let exit: Exit;
  if (exits.length === 1) {
    exit = exits[0]!;
  } else if (chosenExitId) {
    const found = exits.find((e) => e.id === chosenExitId);
    if (!found) {
      throw new RulesError(`无效出口: ${chosenExitId}`);
    }
    exit = found;
  } else {
    const mode = resolveForkMode(cell);
    if (mode === 'player_choice') {
      state.phase = 'choose_exit';
      state.pendingChoice = {
        stepsRemaining,
        exits: [...exits],
        pathStack: [...pathStack],
      };
      events.push({ type: 'need_choice', exits: [...exits], stepsRemaining });
      return { continueWalking: false };
    }
    if (mode === 'status') {
      throw new RulesError('状态分叉尚未实现');
    }
    if (mode === 'advance_die') {
      if (state.lastRoll == null) {
        throw new RulesError('缺少前进骰点数，无法按点数分叉');
      }
      exit = pickExitByFace(exits, state.lastRoll);
    } else {
      // reroll_die：用本格有效骰再掷一次（合计）
      const forkSpec = resolveForkDice(cell, state.board);
      const branch = rollOutcome(forkSpec, rollDie);
      const { min, max } = diceRange(forkSpec);
      if (!Number.isInteger(branch) || branch < min || branch > max) {
        throw new RulesError(
          `分叉骰须为 ${min}–${max}（${formatDiceSpec(forkSpec)}），收到 ${branch}`,
        );
      }
      state.lastBranchRoll = branch;
      events.push({ type: 'branch_rolled', value: branch, cellId: cell.id });
      exit = pickExitByFace(exits, branch);
    }
  }

  const fromCellId = player.cellId;
  pathStack.push(fromCellId);
  player.cellId = exit.toCellId;
  events.push({
    type: 'moved',
    playerId: player.id,
    fromCellId,
    toCellId: exit.toCellId,
    viaExitId: exit.id,
  });

  const remaining = stepsRemaining - 1;
  const landed = requireCell(state.board, player.cellId);

  if (landed.endMode === 'direct') {
    finishPlayer(state, events);
    return { continueWalking: false };
  }

  if (landed.endMode === 'bounce') {
    if (remaining > 0) {
      retreatAlongPath(state, pathStack, remaining, events);
      settleLanding(state, events);
      return { continueWalking: false };
    }
    finishPlayer(state, events);
    return { continueWalking: false };
  }

  if (remaining <= 0) {
    settleLanding(state, events);
    return { continueWalking: false };
  }

  state.pendingChoice = null;
  return { continueWalking: true };
}

function settleLanding(state: GameState, events: GameEvent[]): void {
  state.pendingChoice = null;
  const player = currentPlayer(state);
  if (player.finished || state.phase === 'ended') return;
  const cell = requireCell(state.board, player.cellId);
  if (cell.tile) {
    state.phase = 'order';
    state.pendingOrder = { tile: cell.tile, cellId: cell.id };
    events.push({ type: 'order', tile: cell.tile, cellId: cell.id });
  } else {
    advanceTurn(state, events);
  }
}

function advanceTurn(state: GameState, events: GameEvent[]): void {
  state.pendingOrder = null;
  state.pendingChoice = null;
  state.lastRoll = null;
  state.lastBranchRoll = null;

  if (allFinished(state)) {
    state.phase = 'ended';
    events.push({ type: 'ended' });
    return;
  }

  const n = state.players.length;
  let next = state.currentPlayerIndex;
  for (let i = 0; i < n; i++) {
    next = (next + 1) % n;
    if (!state.players[next]!.finished) {
      state.currentPlayerIndex = next;
      state.phase = 'roll';
      events.push({ type: 'turn_advanced', playerId: state.players[next]!.id });
      return;
    }
  }
  state.phase = 'ended';
  events.push({ type: 'ended' });
}

function walkRemaining(
  state: GameState,
  stepsRemaining: number,
  events: GameEvent[],
  rollDie: (() => number) | undefined,
  firstChosenExitId?: string,
  initialPathStack: string[] = [],
): void {
  let remaining = stepsRemaining;
  let chosen = firstChosenExitId;
  const pathStack = [...initialPathStack];
  while (remaining > 0) {
    const { continueWalking } = advanceOneStep(
      state,
      remaining,
      events,
      rollDie,
      pathStack,
      chosen,
    );
    chosen = undefined;
    if (!continueWalking) {
      return;
    }
    remaining -= 1;
  }
}

/**
 * 取得一次合计结果：有注入则用之，否则按规格逐面求和。
 * 注入函数返回的是整次合计（便于测试），不是单面。
 */
function rollOutcome(spec: DiceSpec, rollDie?: () => number): number {
  return rollDie ? rollDie() : rollDice(spec);
}

/**
 * 当前玩家按棋盘全局骰掷骰并开始走步。
 * `rollDie` 可选：注入合计点数（测试用）；缺省按 DiceSpec 随机求和。
 */
export function roll(
  state: GameState,
  rollDie?: () => number,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'roll') {
    throw new RulesError(`当前阶段不能掷骰: ${state.phase}`);
  }
  const player = currentPlayer(state);
  if (player.finished) {
    throw new RulesError('该玩家已结束，不能掷骰');
  }
  const spec = resolveBoardDice(state.board);
  const value = rollOutcome(spec, rollDie);
  const { min, max } = diceRange(spec);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RulesError(
      `骰子须为 ${min}–${max}（${formatDiceSpec(spec)}），收到 ${value}`,
    );
  }

  const next: GameState = cloneState(state);
  next.lastRoll = value;
  next.lastBranchRoll = null;
  const events: GameEvent[] = [{ type: 'rolled', value }];
  walkRemaining(next, value, events, rollDie);
  return { state: next, events };
}

/**
 * 分叉时选择出口，然后继续走完剩余步数。
 */
export function chooseExit(
  state: GameState,
  exitId: string,
  rollDie?: () => number,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'choose_exit' || !state.pendingChoice) {
    throw new RulesError('当前没有待选出口');
  }
  const { stepsRemaining, pathStack } = state.pendingChoice;
  const next: GameState = cloneState(state);
  next.pendingChoice = null;
  next.phase = 'roll';
  const events: GameEvent[] = [];
  walkRemaining(next, stepsRemaining, events, rollDie, exitId, pathStack);
  return { state: next, events };
}

/**
 * 确认落点指令已执行，换人。
 */
export function confirmOrder(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'order' || !state.pendingOrder) {
    throw new RulesError('当前没有待执行指令');
  }
  const next: GameState = cloneState(state);
  const events: GameEvent[] = [];
  advanceTurn(next, events);
  return { state: next, events };
}

/** 结束本局 */
export function endGame(state: GameState): { state: GameState; events: GameEvent[] } {
  const next: GameState = cloneState(state);
  next.phase = 'ended';
  next.pendingChoice = null;
  next.pendingOrder = null;
  return { state: next, events: [{ type: 'ended' }] };
}
