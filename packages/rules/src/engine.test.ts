import { describe, expect, it } from 'vitest';
import {
  chooseExit,
  confirmOrder,
  endGame,
  pickStart,
  roll,
  startGame,
  validateBoard,
} from './engine.js';
import type { BoardDefinition, BoundTile } from './types.js';

const squat: BoundTile = {
  id: 't-squat',
  category: '深蹲',
  title: '深蹲',
  body: '做 10 个深蹲',
};

const stretch: BoundTile = {
  id: 't-stretch',
  category: '拉伸',
  title: '拉伸',
  body: '拉伸 30 秒',
};

/**
 * 线性盘：start -> a -> b(指令) -> dead(结束)
 */
function linearBoard(): BoardDefinition {
  return {
    id: 'linear',
    name: '线性测试盘',
    cols: 4,
    rows: 1,
    startCellId: 'start',
    startCellIds: ['start'],
    cells: [
      {
        id: 'start',
        col: 0,
        row: 0,
        seq: 1,
        exits: [{ id: 'e0', toCellId: 'a', label: '前进' }],
      },
      {
        id: 'a',
        col: 1,
        row: 0,
        seq: 2,
        exits: [{ id: 'e1', toCellId: 'b', label: '前进' }],
      },
      {
        id: 'b',
        col: 2,
        row: 0,
        seq: 3,
        tile: squat,
        exits: [{ id: 'e2', toCellId: 'dead', label: '前进' }],
      },
      {
        id: 'dead',
        col: 3,
        row: 0,
        seq: 4,
        endMode: 'direct',
        exits: [],
      },
    ],
  };
}

function forkBoard(): BoardDefinition {
  return {
    id: 'fork',
    name: '分叉测试盘',
    cols: 3,
    rows: 2,
    startCellId: 'start',
    startCellIds: ['start'],
    cells: [
      {
        id: 'start',
        col: 0,
        row: 0,
        seq: 1,
        exits: [
          { id: 'left', toCellId: 'L', label: '左' },
          { id: 'right', toCellId: 'R', label: '右' },
        ],
      },
      {
        id: 'L',
        col: 1,
        row: 0,
        seq: 2,
        tile: squat,
        endMode: 'direct',
        exits: [],
      },
      {
        id: 'R',
        col: 1,
        row: 1,
        seq: 3,
        tile: stretch,
        endMode: 'direct',
        exits: [],
      },
    ],
  };
}

describe('validateBoard', () => {
  it('接受合法棋盘', () => {
    expect(validateBoard(linearBoard())).toEqual([]);
  });

  it('拒绝空棋盘与坏出口', () => {
    expect(validateBoard({ ...linearBoard(), cells: [] })).toContain('棋盘至少需要一格');
    const bad = linearBoard();
    bad.cells[0]!.exits[0]!.toCellId = 'missing';
    expect(validateBoard(bad).some((e) => e.includes('missing'))).toBe(true);
  });

  it('拒绝无结束格', () => {
    const board = linearBoard();
    board.cells.find((c) => c.id === 'dead')!.endMode = undefined;
    expect(validateBoard(board).some((e) => e.includes('结束格'))).toBe(true);
  });
});

describe('startGame', () => {
  it('所有棋子在起点且开局不触发指令', () => {
    const board = linearBoard();
    board.cells[0]!.tile = squat;
    const { state } = startGame({ board, playerNames: ['甲', '乙'] });
    expect(state.phase).toBe('roll');
    expect(state.pendingOrder).toBeNull();
    expect(state.players.every((p) => p.cellId === 'start')).toBe(true);
    expect(state.players.every((p) => !p.finished)).toBe(true);
    expect(state.currentPlayerIndex).toBe(0);
  });

  it('多起点进入 pick_start', () => {
    const board = linearBoard();
    board.startCellIds = ['start', 'a'];
    board.startCellId = 'start';
    const { state } = startGame({ board, playerNames: ['甲', '乙'] });
    expect(state.phase).toBe('pick_start');
    expect(state.players.every((p) => p.cellId === 'start')).toBe(true);
  });
});

describe('pickStart', () => {
  it('全员选完后进入 roll', () => {
    const board = linearBoard();
    board.startCellIds = ['start', 'a'];
    board.startCellId = 'start';
    let { state } = startGame({ board, playerNames: ['甲', '乙'] });
    ({ state } = pickStart(state, 'a'));
    expect(state.players[0]!.cellId).toBe('a');
    expect(state.phase).toBe('pick_start');
    expect(state.currentPlayerIndex).toBe(1);
    ({ state } = pickStart(state, 'start'));
    expect(state.players[1]!.cellId).toBe('start');
    expect(state.phase).toBe('roll');
    expect(state.currentPlayerIndex).toBe(0);
  });
});

describe('roll 与单出口', () => {
  it('掷 2 沿唯一出口走到 b 并弹出指令', () => {
    const { state: started } = startGame({
      board: linearBoard(),
      playerNames: ['甲'],
    });
    const { state, events } = roll(started, () => 2);
    expect(events.some((e) => e.type === 'rolled' && e.value === 2)).toBe(true);
    expect(state.players[0]!.cellId).toBe('b');
    expect(state.phase).toBe('order');
    expect(state.pendingOrder?.tile.title).toBe('深蹲');
  });

  it('路过格子不触发指令，只在落点触发', () => {
    const board = linearBoard();
    board.cells.find((c) => c.id === 'a')!.tile = stretch;
    board.cells.find((c) => c.id === 'b')!.tile = squat;
    const { state: started } = startGame({ board, playerNames: ['甲'] });
    const { state } = roll(started, () => 2);
    expect(state.players[0]!.cellId).toBe('b');
    expect(state.pendingOrder?.tile.id).toBe('t-squat');
  });

  it('落点无指令则直接换人', () => {
    const board = linearBoard();
    board.cells.find((c) => c.id === 'a')!.tile = undefined;
    board.cells.find((c) => c.id === 'b')!.tile = undefined;
    const { state: started } = startGame({
      board,
      playerNames: ['甲', '乙'],
    });
    const { state, events } = roll(started, () => 1);
    expect(state.players[0]!.cellId).toBe('a');
    expect(state.phase).toBe('roll');
    expect(state.currentPlayerIndex).toBe(1);
    expect(events.some((e) => e.type === 'turn_advanced')).toBe(true);
  });

  it('死路提前停在当前格', () => {
    const { state: started } = startGame({
      board: linearBoard(),
      playerNames: ['甲'],
    });
    // 掷 3 → start-a-b-dead，dead 为 direct → 结束
    const { state } = roll(started, () => 3);
    expect(state.players[0]!.cellId).toBe('dead');
    expect(state.players[0]!.finished).toBe(true);
    expect(state.phase).toBe('ended');
  });
});

describe('结束格 direct / bounce', () => {
  /** start -> mid -> end；end 可配模式 */
  function endBoard(endMode: 'direct' | 'bounce'): BoardDefinition {
    return {
      id: 'end-test',
      name: '结束测试',
      cols: 3,
      rows: 1,
      startCellId: 'start',
      startCellIds: ['start'],
      cells: [
        {
          id: 'start',
          col: 0,
          row: 0,
          seq: 1,
          exits: [{ id: 'e0', toCellId: 'mid', label: '前进' }],
        },
        {
          id: 'mid',
          col: 1,
          row: 0,
          seq: 2,
          exits: [{ id: 'e1', toCellId: 'end', label: '前进' }],
        },
        {
          id: 'end',
          col: 2,
          row: 0,
          seq: 3,
          endMode,
          exits: [],
        },
      ],
    };
  }

  it('direct：进入即结束，丢弃剩余步', () => {
    const { state: started } = startGame({
      board: endBoard('direct'),
      playerNames: ['甲'],
    });
    // 掷 6，两步到 end，剩余丢弃
    const { state, events } = roll(started, () => 6);
    expect(state.players[0]!.cellId).toBe('end');
    expect(state.players[0]!.finished).toBe(true);
    expect(state.phase).toBe('ended');
    expect(events.some((e) => e.type === 'player_finished')).toBe(true);
    expect(events.filter((e) => e.type === 'moved')).toHaveLength(2);
  });

  it('bounce：刚好落定则结束', () => {
    const { state: started } = startGame({
      board: endBoard('bounce'),
      playerNames: ['甲'],
    });
    const { state } = roll(started, () => 2);
    expect(state.players[0]!.cellId).toBe('end');
    expect(state.players[0]!.finished).toBe(true);
    expect(state.phase).toBe('ended');
  });

  it('bounce：残值沿轨迹后退且不结束', () => {
    const { state: started } = startGame({
      board: endBoard('bounce'),
      playerNames: ['甲', '乙'],
    });
    // 掷 6：2 步到 end，后退 4；轨迹只有 start,mid → 退到 start
    const { state, events } = roll(started, () => 6);
    expect(state.players[0]!.finished).toBe(false);
    expect(state.players[0]!.cellId).toBe('start');
    expect(events.some((e) => e.type === 'retreated')).toBe(true);
    expect(state.phase).toBe('roll');
    expect(state.currentPlayerIndex).toBe(1);
  });

  it('bounce：残值 1 则退一格到 mid', () => {
    const { state: started } = startGame({
      board: endBoard('bounce'),
      playerNames: ['甲', '乙'],
    });
    // 掷 3：start->mid->end，剩 1，退到 mid
    const { state } = roll(started, () => 3);
    expect(state.players[0]!.finished).toBe(false);
    expect(state.players[0]!.cellId).toBe('mid');
  });

  it('跳过已结束玩家；全员结束后 ended', () => {
    const board = endBoard('direct');
    let { state } = startGame({ board, playerNames: ['甲', '乙'] });
    ({ state } = roll(state, () => 2)); // 甲结束
    expect(state.players[0]!.finished).toBe(true);
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.phase).toBe('roll');
    ({ state } = roll(state, () => 2)); // 乙结束
    expect(state.players[1]!.finished).toBe(true);
    expect(state.phase).toBe('ended');
  });
});

describe('分叉 chooseExit', () => {
  it('多出口时暂停等待选择', () => {
    const { state: started } = startGame({
      board: forkBoard(),
      playerNames: ['甲'],
    });
    const { state, events } = roll(started, () => 1);
    expect(state.phase).toBe('choose_exit');
    expect(state.pendingChoice?.exits.map((e) => e.id).sort()).toEqual(['left', 'right']);
    expect(events.some((e) => e.type === 'need_choice')).toBe(true);
  });

  it('选择后走到对应格并结束（终点不触发指令）', () => {
    const { state: started } = startGame({
      board: forkBoard(),
      playerNames: ['甲'],
    });
    const mid = roll(started, () => 1).state;
    const { state } = chooseExit(mid, 'left');
    expect(state.players[0]!.cellId).toBe('L');
    expect(state.players[0]!.finished).toBe(true);
    expect(state.phase).toBe('ended');
    expect(state.pendingOrder).toBeNull();
  });

  it('中途分叉：掷 2 时第一步需选择', () => {
    const board: BoardDefinition = {
      id: 'mid-fork',
      name: '中途分叉',
      cols: 3,
      rows: 2,
      startCellId: 'start',
      startCellIds: ['start'],
      cells: [
        {
          id: 'start',
          col: 0,
          row: 0,
          seq: 1,
          exits: [{ id: 'to-fork', toCellId: 'fork', label: '到分叉' }],
        },
        {
          id: 'fork',
          col: 1,
          row: 0,
          seq: 2,
          exits: [
            { id: 'up', toCellId: 'endA', label: '上' },
            { id: 'down', toCellId: 'endB', label: '下' },
          ],
        },
        { id: 'endA', col: 2, row: 0, seq: 3, tile: squat, endMode: 'direct', exits: [] },
        { id: 'endB', col: 2, row: 1, seq: 4, tile: stretch, endMode: 'direct', exits: [] },
      ],
    };
    const { state: started } = startGame({ board, playerNames: ['甲'] });
    const afterRoll = roll(started, () => 2).state;
    expect(afterRoll.players[0]!.cellId).toBe('fork');
    expect(afterRoll.phase).toBe('choose_exit');
    expect(afterRoll.pendingChoice?.stepsRemaining).toBe(1);

    const { state } = chooseExit(afterRoll, 'down');
    expect(state.players[0]!.cellId).toBe('endB');
    expect(state.players[0]!.finished).toBe(true);
  });
});

describe('分叉模式 advance_die / reroll_die', () => {
  function dieForkBoard(
    mode: 'advance_die' | 'reroll_die',
  ): BoardDefinition {
    return {
      id: 'die-fork',
      name: '点数分叉',
      cols: 3,
      rows: 2,
      startCellId: 'start',
      startCellIds: ['start'],
      cells: [
        {
          id: 'start',
          col: 0,
          row: 0,
          seq: 1,
          forkMode: mode,
          exits: [
            { id: 'left', toCellId: 'L', label: '左', faces: [1, 2, 3] },
            { id: 'right', toCellId: 'R', label: '右', faces: [4, 5, 6] },
          ],
        },
        { id: 'L', col: 1, row: 0, seq: 2, tile: squat, endMode: 'direct', exits: [] },
        { id: 'R', col: 1, row: 1, seq: 3, tile: stretch, endMode: 'direct', exits: [] },
      ],
    };
  }

  it('validateBoard：模式一/二要求 1–6 完整无重叠', () => {
    const board = dieForkBoard('advance_die');
    expect(validateBoard(board)).toEqual([]);
    board.cells[0]!.exits[0]!.faces = [1, 2];
    expect(validateBoard(board).some((e) => e.includes('未覆盖'))).toBe(true);
  });

  it('validateBoard：模式三多出口不可开局', () => {
    const board = forkBoard();
    board.cells[0]!.forkMode = 'status';
    expect(validateBoard(board).some((e) => e.includes('尚未实现'))).toBe(true);
  });

  it('模式一：用前进骰原点数自动选出口', () => {
    const { state: started } = startGame({
      board: dieForkBoard('advance_die'),
      playerNames: ['甲'],
    });
    const { state, events } = roll(started, () => 5);
    expect(state.players[0]!.cellId).toBe('R');
    expect(state.players[0]!.finished).toBe(true);
    expect(events.some((e) => e.type === 'need_choice')).toBe(false);
  });

  it('模式一：中途分叉仍用原前进骰点数', () => {
    const board: BoardDefinition = {
      id: 'mid-die',
      name: '中途点数分叉',
      cols: 3,
      rows: 2,
      startCellId: 'start',
      startCellIds: ['start'],
      cells: [
        {
          id: 'start',
          col: 0,
          row: 0,
          seq: 1,
          exits: [{ id: 'to-fork', toCellId: 'fork', label: '到分叉' }],
        },
        {
          id: 'fork',
          col: 1,
          row: 0,
          seq: 2,
          forkMode: 'advance_die',
          exits: [
            { id: 'up', toCellId: 'endA', label: '上', faces: [1, 2, 3] },
            { id: 'down', toCellId: 'endB', label: '下', faces: [4, 5, 6] },
          ],
        },
        { id: 'endA', col: 2, row: 0, seq: 3, tile: squat, endMode: 'direct', exits: [] },
        { id: 'endB', col: 2, row: 1, seq: 4, tile: stretch, endMode: 'direct', exits: [] },
      ],
    };
    const { state } = roll(startGame({ board, playerNames: ['甲'] }).state, () => 2);
    expect(state.players[0]!.cellId).toBe('endA');
    expect(state.players[0]!.finished).toBe(true);
  });

  it('模式二：另掷独立骰选出口', () => {
    const rolls = [1, 6]; // 前进 1，分叉骰 6 → 右
    const { state: started } = startGame({
      board: dieForkBoard('reroll_die'),
      playerNames: ['甲'],
    });
    const { state, events } = roll(started, () => rolls.shift()!);
    expect(state.players[0]!.cellId).toBe('R');
    expect(events.some((e) => e.type === 'branch_rolled' && e.value === 6)).toBe(true);
    expect(state.players[0]!.finished).toBe(true);
  });
});

describe('confirmOrder 与 endGame', () => {
  it('确认指令后换人', () => {
    const { state: started } = startGame({
      board: linearBoard(),
      playerNames: ['甲', '乙'],
    });
    const withOrder = roll(started, () => 2).state;
    expect(withOrder.phase).toBe('order');
    const { state } = confirmOrder(withOrder);
    expect(state.phase).toBe('roll');
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.pendingOrder).toBeNull();
  });

  it('结束本局', () => {
    const { state: started } = startGame({
      board: linearBoard(),
      playerNames: ['甲'],
    });
    const { state } = endGame(started);
    expect(state.phase).toBe('ended');
  });
});
