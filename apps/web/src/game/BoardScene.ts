import Phaser from 'phaser';
import type { BoardDefinition, Exit, GameState, Player } from '@order-board/rules';

const CELL = 72;
const PAD = 24;
const COLORS = [0xff6b9d, 0x6dffa8, 0x9ad0ff, 0xffd166, 0xc9a0ff, 0xff8c42];

export interface BoardSceneCallbacks {
  onExitChosen: (exitId: string) => void;
  /** 多起点开局时点选起点格 */
  onStartCellChosen?: (cellId: string) => void;
}

/**
 * Phaser 棋盘场景：绘制格子、出口箭头、棋子；分叉时高亮可点出口。
 */
export class BoardScene extends Phaser.Scene {
  private board!: BoardDefinition;
  private callbacks!: BoardSceneCallbacks;
  private pieceSprites = new Map<string, Phaser.GameObjects.Container>();
  private exitHighlights: Phaser.GameObjects.GameObject[] = [];
  private startHighlights: Phaser.GameObjects.GameObject[] = [];
  private diceText?: Phaser.GameObjects.Text;

  constructor() {
    super('BoardScene');
  }

  init(data: { board: BoardDefinition; callbacks: BoardSceneCallbacks }) {
    this.board = data.board;
    this.callbacks = data.callbacks;
  }

  create() {
    this.cameras.main.setBackgroundColor('#1a1220');
    this.drawBoard();
    this.diceText = this.add
      .text(PAD, 8, '', {
        fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
        fontSize: '18px',
        color: '#f4eaf8',
      })
      .setDepth(20);
  }

  private cellCenter(cellId: string): { x: number; y: number } {
    const cell = this.board.cells.find((c) => c.id === cellId);
    if (!cell) return { x: PAD, y: PAD };
    return {
      x: PAD + cell.col * CELL + CELL / 2,
      y: PAD + cell.row * CELL + CELL / 2 + 28,
    };
  }

  private drawBoard() {
    const startIds = new Set(this.board.startCellIds ?? [this.board.startCellId]);
    for (const cell of this.board.cells) {
      const { x, y } = this.cellCenter(cell.id);
      const isDefaultStart = cell.id === this.board.startCellId;
      const isStart = startIds.has(cell.id);
      const isEnd = cell.endMode === 'direct' || cell.endMode === 'bounce';
      let fill = 0x3a2748;
      if (isDefaultStart) fill = 0x2d5a3d;
      else if (isStart) fill = 0x244a38;
      else if (isEnd) fill = 0x5a2740;
      let stroke = cell.tile ? 0xc45cff : 0x5a4668;
      if (isEnd) stroke = 0xff6b9d;
      else if (isStart) stroke = 0x6dffa8;
      this.add.rectangle(x, y, CELL - 8, CELL - 8, fill).setStrokeStyle(2, stroke);
      this.add
        .text(x, y - (cell.title || isEnd ? 10 : 0), String(cell.seq ?? ''), {
          fontSize: '18px',
          color: '#f4eaf8',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      if (cell.title) {
        this.add
          .text(x, y + 12, cell.title.slice(0, 6), {
            fontSize: '10px',
            color: '#cbb8d8',
          })
          .setOrigin(0.5);
      } else if (isEnd) {
        this.add
          .text(x, y + 14, cell.endMode === 'bounce' ? '终·退' : '终', {
            fontSize: '11px',
            color: '#ffb0c8',
          })
          .setOrigin(0.5);
      } else if (cell.tile) {
        this.add
          .text(x, y + 16, '令', {
            fontSize: '11px',
            color: '#e8c4ff',
          })
          .setOrigin(0.5);
      }

      for (const exit of cell.exits) {
        this.drawExitArrow(cell.id, exit, false);
      }
    }
  }

  private drawExitArrow(fromId: string, exit: Exit, interactive: boolean) {
    const from = this.cellCenter(fromId);
    const to = this.cellCenter(exit.toCellId);
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const color = interactive ? 0xff6b9d : 0x7a6a88;
    const line = this.add.line(0, 0, from.x, from.y, to.x, to.y, color, interactive ? 1 : 0.55);
    line.setLineWidth(interactive ? 4 : 2);
    line.setOrigin(0, 0);
    const fromCell = this.board.cells.find((c) => c.id === fromId);
    // 单出口无分叉，箭头上不显示标签
    const showLabel = interactive || (fromCell?.exits.length ?? 0) >= 2;
    if (!showLabel) {
      if (interactive) this.exitHighlights.push(line);
      return;
    }
    const label = this.add
      .text(midX, midY, exit.label, {
        fontSize: '12px',
        color: interactive ? '#ffffff' : '#cbb8d8',
        backgroundColor: interactive ? '#c45cff' : '#00000088',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5);

    if (interactive) {
      label.setInteractive({ useHandCursor: true });
      const pick = () => this.callbacks.onExitChosen(exit.id);
      label.on('pointerdown', pick);
      this.exitHighlights.push(line, label);
    }
  }

  /** 根据对局状态同步棋子与高亮 */
  syncState(state: GameState) {
    this.clearExitHighlights();
    this.clearStartHighlights();
    for (const player of state.players) {
      this.ensurePiece(player);
      const sprite = this.pieceSprites.get(player.id);
      if (!sprite) continue;
      const pos = this.cellCenter(player.cellId);
      const offset = this.pieceOffset(state.players, player.id, player.cellId);
      sprite.setPosition(pos.x + offset.x, pos.y + offset.y);
      sprite.setAlpha(player.finished ? 0.35 : 1);
      const ring = sprite.getByName('ring') as Phaser.GameObjects.Arc | null;
      if (ring) {
        ring.setVisible(
          !player.finished && state.players[state.currentPlayerIndex]?.id === player.id,
        );
      }
    }
    if (this.diceText) {
      const parts: string[] = [];
      if (state.phase === 'pick_start') parts.push('选择起点');
      if (state.phase === 'ended') parts.push('全员已结束');
      if (state.lastRoll != null) parts.push(`前进：${state.lastRoll}`);
      if (state.lastBranchRoll != null) parts.push(`分叉：${state.lastBranchRoll}`);
      this.diceText.setText(parts.join('  '));
    }
    if (state.phase === 'choose_exit' && state.pendingChoice) {
      const player = state.players[state.currentPlayerIndex]!;
      for (const exit of state.pendingChoice.exits) {
        this.drawExitArrow(player.cellId, exit, true);
      }
    }
    if (state.phase === 'pick_start') {
      this.highlightStartCells();
    }
  }

  private highlightStartCells() {
    const ids = this.board.startCellIds ?? [this.board.startCellId];
    for (const id of ids) {
      const { x, y } = this.cellCenter(id);
      const hit = this.add
        .rectangle(x, y, CELL - 4, CELL - 4)
        .setStrokeStyle(3, 0x6dffa8, 1)
        .setFillStyle(0x6dffa8, 0.12)
        .setInteractive({ useHandCursor: true })
        .setDepth(5);
      hit.on('pointerdown', () => this.callbacks.onStartCellChosen?.(id));
      this.startHighlights.push(hit);
    }
  }

  private pieceOffset(players: Player[], playerId: string, cellId: string) {
    const same = players.filter((p) => p.cellId === cellId);
    const idx = same.findIndex((p) => p.id === playerId);
    const angle = (idx / Math.max(same.length, 1)) * Math.PI * 2;
    const r = same.length > 1 ? 14 : 0;
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  }

  private ensurePiece(player: Player) {
    if (this.pieceSprites.has(player.id)) return;
    const idx = Number(player.id.replace(/\D/g, '')) - 1;
    const color = COLORS[((idx % COLORS.length) + COLORS.length) % COLORS.length]!;
    const container = this.add.container(0, 0);
    const circle = this.add.circle(0, 0, 14, color);
    const ring = this.add.circle(0, 0, 18).setStrokeStyle(2, 0xffffff).setName('ring');
    ring.setVisible(false);
    const label = this.add
      .text(0, 0, player.name.slice(0, 1), {
        fontSize: '12px',
        color: '#1a0f1f',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    container.add([ring, circle, label]);
    container.setDepth(10);
    this.pieceSprites.set(player.id, container);
  }

  private clearExitHighlights() {
    for (const obj of this.exitHighlights) obj.destroy();
    this.exitHighlights = [];
  }

  private clearStartHighlights() {
    for (const obj of this.startHighlights) obj.destroy();
    this.startHighlights = [];
  }
}

export function createGame(
  parent: HTMLElement,
  board: BoardDefinition,
  callbacks: BoardSceneCallbacks,
): Phaser.Game {
  const width = PAD * 2 + board.cols * CELL;
  const height = PAD * 2 + board.rows * CELL + 40;
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: Math.max(width, 320),
    height: Math.max(height, 240),
    backgroundColor: '#1a1220',
    scene: [],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });
  game.scene.add('BoardScene', BoardScene, true, { board, callbacks });
  return game;
}
