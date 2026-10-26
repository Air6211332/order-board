import type {
  BoardDefinition,
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
 * 按骰面从出口中选取；faces 未命中则报错。
 */
export function pickExitByFace(exits: Exit[], face: number): Exit {
  const found = exits.find((e) => (e.faces ?? []).includes(face));
  if (!found) {
    throw new RulesError(`点数 ${face} 未映射到任何出口`);
  }
  return found;
}

function validateDieFaces(cellId: string, exits: Exit[]): string[] {
  const errors: string[] = [];
  const owner = new Map<number, string>();
  for (const exit of exits) {
    for (const face of exit.faces ?? []) {
      if (!Number.isInteger(face) || face < 1 || face > 6) {
        errors.push(`格子 ${cellId} 出口 ${exit.id} 含非法点数 ${face}`);
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
  for (let f = 1; f <= 6; f++) {
    if (!owner.has(f)) {
      errors.push(`格子 ${cellId} 的点数映射未覆盖 ${f}`);
    }
  }
  return errors;
}

/**
 * 校验棋盘定义是否可开局。
 * 须至少一格、≥1 起点、≥1 结束格；模式一/二多出口须覆盖 1–6。
 */
export function validateBoard(board: BoardDefinition): string[] {
  const errors: string[] = [];
  if (!board.cells.length) {
    errors.push('棋盘至少需要一格');
  }
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
    for (const exit of cell.exits) {
      if (!ids.has(exit.toCellId)) {
        errors.push(`格子 ${cell.id} 的出口 ${exit.id} 指向不存在的格子 ${exit.toCellId}`);
      }
    }
    if (cell.exits.length < 2) continue;
    const mode = resolveForkMode(cell);
    if (mode === 'status') {
      errors.push(`格子 ${cell.id} 使用状态分叉（尚未实现），请改用其他模式`);
    } else if (mode === 'advance_die' || mode === 'reroll_die') {
      errors.push(...validateDieFaces(cell.id, cell.exits));
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
  rollDie: () => number,
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
      // reroll_die
      const branch = rollDie();
      if (!Number.isInteger(branch) || branch < 1 || branch > 6) {
        throw new RulesError(`分叉骰须为 1–6，收到 ${branch}`);
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
  rollDie: () => number,
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
 * 当前玩家掷骰并开始走步。
 */
export function roll(
  state: GameState,
  rollDie: () => number = defaultRoll,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'roll') {
    throw new RulesError(`当前阶段不能掷骰: ${state.phase}`);
  }
  const player = currentPlayer(state);
  if (player.finished) {
    throw new RulesError('该玩家已结束，不能掷骰');
  }
  const value = rollDie();
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new RulesError(`骰子须为 1–6，收到 ${value}`);
  }

  const next: GameState = cloneState(state);
  next.lastRoll = value;
  next.lastBranchRoll = null;
  const events: GameEvent[] = [{ type: 'rolled', value }];
  walkRemaining(next, value, events, rollDie);
  return { state: next, events };
}

function defaultRoll(): number {
  return Math.floor(Math.random() * 6) + 1;
}

/**
 * 分叉时选择出口，然后继续走完剩余步数。
 */
export function chooseExit(
  state: GameState,
  exitId: string,
  rollDie: () => number = defaultRoll,
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
