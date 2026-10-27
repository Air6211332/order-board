import Phaser from 'phaser';
import type { BoardDefinition, Exit, GameState, Player } from '@order-board/rules';
import { formatDiceSpec, resolveBoardDice } from '@order-board/rules';
import { avatarPngUrl, avatarTextureKey } from '../avatar';
import {
  PAD,
  boardSize,
  cellCenter as geomCellCenter,
  cellRect,
  pathLabelPoint,
  routeExit,
  type GeomCell,
  type Point,
} from './boardGeom';

const PIECE_R = 14;
const COLORS = [0xff6b9d, 0x6dffa8, 0x9ad0ff, 0xffd166, 0xc9a0ff, 0xff8c42];
/** 骰子文案区额外高度 */
const HEADER = 28;

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
      .text(PAD, 6, '', {
        fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
        fontSize: '18px',
        color: '#f4eaf8',
      })
      .setDepth(20);
  }

  private geomCells(): GeomCell[] {
    return this.board.cells.map((c) => ({
      col: c.col,
      row: c.row,
      emphasized: Boolean(c.emphasized),
    }));
  }

  private cellCenter(cellId: string): Point {
    const cell = this.board.cells.find((c) => c.id === cellId);
    if (!cell) return { x: PAD, y: PAD + HEADER };
    const p = geomCellCenter(cell.col, cell.row);
    return { x: p.x, y: p.y + HEADER };
  }

  private cellGeom(cellId: string): GeomCell | null {
    const cell = this.board.cells.find((c) => c.id === cellId);
    if (!cell) return null;
    return { col: cell.col, row: cell.row, emphasized: Boolean(cell.emphasized) };
  }

  /** 几何坐标 → 场景坐标（下移 HEADER） */
  private shiftPoints(points: Point[]): Point[] {
    return points.map((p) => ({ x: p.x, y: p.y + HEADER }));
  }

  private drawBoard() {
    const startIds = new Set(this.board.startCellIds ?? [this.board.startCellId]);
    for (const cell of this.board.cells) {
      const center = this.cellCenter(cell.id);
      const rect = cellRect(cell.col, cell.row, Boolean(cell.emphasized));
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
      this.add
        .rectangle(center.x, center.y, rect.w - 4, rect.h - 4, fill)
        .setStrokeStyle(2, stroke);
      this.add
        .text(center.x, center.y - (cell.title || isEnd ? 10 : 0), String(cell.seq ?? ''), {
          fontSize: cell.emphasized ? '22px' : '18px',
          color: '#f4eaf8',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      if (cell.title) {
        this.add
          .text(center.x, center.y + 12, cell.title.slice(0, 6), {
            fontSize: '10px',
            color: '#cbb8d8',
          })
          .setOrigin(0.5);
      } else if (isEnd) {
        this.add
          .text(center.x, center.y + 14, cell.endMode === 'bounce' ? '终·退' : '终', {
            fontSize: '11px',
            color: '#ffb0c8',
          })
          .setOrigin(0.5);
      } else if (cell.tile) {
        this.add
          .text(center.x, center.y + 16, '令', {
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
    const from = this.cellGeom(fromId);
    const to = this.cellGeom(exit.toCellId);
    if (!from || !to) return;

    const raw = routeExit(from, to, this.geomCells(), this.board.cols, this.board.rows);
    const points = this.shiftPoints(raw);
    if (points.length < 2) return;

    const color = interactive ? 0xff6b9d : 0x7a6a88;
    const alpha = interactive ? 1 : 0.55;
    const width = interactive ? 4 : 2;
    const g = this.add.graphics();
    g.lineStyle(width, color, alpha);
    g.beginPath();
    g.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) {
      g.lineTo(points[i]!.x, points[i]!.y);
    }
    g.strokePath();
    this.drawArrowHead(g, points, color, alpha, interactive ? 12 : 9);

    const fromCell = this.board.cells.find((c) => c.id === fromId);
    const showLabel = interactive || (fromCell?.exits.length ?? 0) >= 2;
    if (!showLabel) {
      if (interactive) this.exitHighlights.push(g);
      return;
    }
    const mid = pathLabelPoint(points);
    const label = this.add
      .text(mid.x, mid.y, exit.label, {
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
      this.exitHighlights.push(g, label);
    }
  }

  /** 在路径终点画箭头 */
  private drawArrowHead(
    g: Phaser.GameObjects.Graphics,
    points: Point[],
    color: number,
    alpha: number,
    size: number,
  ) {
    const a = points[points.length - 2]!;
    const b = points[points.length - 1]!;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const left = ang + Math.PI * 0.82;
    const right = ang - Math.PI * 0.82;
    g.fillStyle(color, alpha);
    g.beginPath();
    g.moveTo(b.x, b.y);
    g.lineTo(b.x + Math.cos(left) * size, b.y + Math.sin(left) * size);
    g.lineTo(b.x + Math.cos(right) * size, b.y + Math.sin(right) * size);
    g.closePath();
    g.fillPath();
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
      const diceLabel = formatDiceSpec(resolveBoardDice(state.board));
      if (state.lastRoll != null) parts.push(`前进：${state.lastRoll}（${diceLabel}）`);
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
      const cell = this.board.cells.find((c) => c.id === id);
      if (!cell) continue;
      const { x, y } = this.cellCenter(id);
      const rect = cellRect(cell.col, cell.row, Boolean(cell.emphasized));
      const hit = this.add
        .rectangle(x, y, rect.w - 2, rect.h - 2)
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
    const ring = this.add.circle(0, 0, PIECE_R + 4).setStrokeStyle(2, 0xffffff).setName('ring');
    ring.setVisible(false);

    const circle = this.add.circle(0, 0, PIECE_R, color).setName('fallback');
    const label = this.add
      .text(0, 0, player.name.slice(0, 1), {
        fontSize: '12px',
        color: '#1a0f1f',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setName('label');
    container.add([ring, circle, label]);
    container.setDepth(10);
    this.pieceSprites.set(player.id, container);

    const seed = player.avatarSeed?.trim();
    if (seed) this.applyAvatarTexture(container, seed);
  }

  /** 异步加载 DiceBear 头像并替换色圆 */
  private applyAvatarTexture(container: Phaser.GameObjects.Container, seed: string) {
    const key = avatarTextureKey(seed);
    const mount = () => {
      if (!this.textures.exists(key) || !container.active) return;
      const fallback = container.getByName('fallback');
      const label = container.getByName('label');
      if (fallback) {
        container.remove(fallback, true);
      }
      if (label) {
        container.remove(label, true);
      }
      const existing = container.getByName('avatar');
      if (existing) return;
      const img = this.add
        .image(0, 0, key)
        .setDisplaySize(PIECE_R * 2, PIECE_R * 2)
        .setName('avatar');
      // ring 在索引 0，头像插在其后
      container.addAt(img, 1);
    };

    if (this.textures.exists(key)) {
      mount();
      return;
    }

    this.load.crossOrigin = 'anonymous';
    this.load.image(key, avatarPngUrl(seed, 64));
    this.load.once(`filecomplete-image-${key}`, mount);
    if (!this.load.isLoading()) this.load.start();
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
  const size = boardSize(board.cols, board.rows);
  const width = size.width;
  const height = size.height + HEADER;
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
