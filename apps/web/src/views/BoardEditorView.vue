<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { DiceSpec, EndMode, ForkMode, PlayMode } from '@order-board/rules';
import { diceRange, formatDiceSpec, isValidDiceSpec, nextSeq, reassignSeq } from '@order-board/rules';
import {
  api,
  type BoardDocument,
  type TileCategoryDto,
  type TileDto,
  type Visibility,
} from '../api';
import CellSearchSelect from '../components/CellSearchSelect.vue';
import TileLibraryPickerModal from '../components/TileLibraryPickerModal.vue';
import {
  IMPORT_SOURCES,
  checkGridCapacity,
  parseImport,
  serpentinePos,
  type ImportSourceId,
} from '../importers';
import {
  BASE_CELL_H,
  BASE_CELL_W,
  GAP,
  PAD,
  SLOT_H,
  SLOT_W,
  boardSize as geomBoardSize,
  pathLabelPoint,
  routeExit,
  type GeomCell,
} from '../game/boardGeom';

const DICE_PRESETS: Array<{ label: string; spec: DiceSpec }> = [
  { label: '1d4', spec: { count: 1, sides: 4 } },
  { label: '1d6', spec: { count: 1, sides: 6 } },
  { label: '1d8', spec: { count: 1, sides: 8 } },
  { label: '2d6', spec: { count: 2, sides: 6 } },
];

const DEFAULT_DICE: DiceSpec = { count: 1, sides: 6 };

const FORK_OPTIONS: Array<{ value: ForkMode; label: string }> = [
  { value: 'player_choice', label: '模式四：玩家自选' },
  { value: 'advance_die', label: '模式一：前进骰点数' },
  { value: 'reroll_die', label: '模式二：独立分叉骰' },
  { value: 'status', label: '模式三：状态栏（预留）' },
];

const END_OPTIONS: Array<{ value: EndMode; label: string }> = [
  { value: 'direct', label: '模式一：直接结束' },
  { value: 'bounce', label: '模式二：残值后退' },
];

const route = useRoute();
const router = useRouter();
const boardId = computed(() => String(route.params.id));

const name = ref('');
const cols = ref(6);
const rows = ref(4);
const visibility = ref<Visibility>('private');
const playMode = ref<PlayMode>('multi');
const startCellId = ref<string | null>(null);
/** 棋盘全局前进骰 */
const boardDice = ref<DiceSpec>({ ...DEFAULT_DICE });
const cells = ref<BoardDocument['cells']>([]);
const exits = ref<BoardDocument['exits']>([]);
const tiles = ref<TileDto[]>([]);
const categories = ref<TileCategoryDto[]>([]);
const showTilePicker = ref(false);
const selectedCellId = ref<string | null>(null);
const linkFromId = ref<string | null>(null);
const error = ref('');
const message = ref('');
const saving = ref(false);
const seqDraft = ref('');
const boardStage = ref<HTMLElement | null>(null);
const dragCellId = ref<string | null>(null);
const dragOverKey = ref<string | null>(null);
/** 本次指针是否发生过拖拽，避免拖完误触发 click */
const didDrag = ref(false);
/** 右侧配置 Tab */
const configTab = ref<'global' | 'cell'>('global');
/** 全局页：添加起点/结束格的临时选择 */
const addStartPick = ref('');
const addEndPick = ref('');

/** 导入弹层 */
const showImport = ref(false);
const importSource = ref<ImportSourceId>('blitzedout');
const importText = ref('');
const importing = ref(false);

/** 棋盘像素尺寸（含外圈留白，供 SVG viewBox） */
const boardPixelSize = computed(() => geomBoardSize(cols.value, rows.value));

const boardCssVars = computed(() => ({
  '--cols': String(cols.value),
  '--slot-w': `${SLOT_W}px`,
  '--slot-h': `${SLOT_H}px`,
  '--cell-w': `${BASE_CELL_W}px`,
  '--cell-h': `${BASE_CELL_H}px`,
  '--gap': `${GAP}px`,
  '--pad': `${PAD}px`,
}));

const cellByPos = computed(() => {
  const map = new Map<string, BoardDocument['cells'][number]>();
  for (const c of cells.value) map.set(`${c.col},${c.row}`, c);
  return map;
});

const selectedCell = computed(() => cells.value.find((c) => c.id === selectedCellId.value) ?? null);

const selectedExitCount = computed(() =>
  selectedCell.value ? exitsFrom(selectedCell.value.id).length : 0,
);

const needsFaceMap = computed(() => {
  const mode = selectedCell.value?.forkMode ?? 'player_choice';
  return selectedExitCount.value >= 2 && (mode === 'advance_die' || mode === 'reroll_die');
});

/** 当前选中格用于点数映射的有效骰 */
const activeFaceDice = computed((): DiceSpec => {
  const cell = selectedCell.value;
  if (!cell) return boardDice.value;
  const mode = cell.forkMode ?? 'player_choice';
  if (mode === 'reroll_die' && cell.forkDice && isValidDiceSpec(cell.forkDice)) {
    return cell.forkDice;
  }
  return isValidDiceSpec(boardDice.value) ? boardDice.value : DEFAULT_DICE;
});

const faceChoices = computed(() => {
  const { min, max } = diceRange(activeFaceDice.value);
  const list: number[] = [];
  for (let f = min; f <= max; f++) list.push(f);
  return list;
});

const boardDiceRangeLabel = computed(() => {
  const spec = isValidDiceSpec(boardDice.value) ? boardDice.value : DEFAULT_DICE;
  const { min, max } = diceRange(spec);
  return `${formatDiceSpec(spec)} · 可能点数 ${min}–${max}`;
});

function dicePresetKey(spec: DiceSpec): string {
  return `${spec.count}d${spec.sides}`;
}

const boardDicePreset = computed({
  get() {
    const key = dicePresetKey(boardDice.value);
    return DICE_PRESETS.some((p) => dicePresetKey(p.spec) === key) ? key : 'custom';
  },
  set(v: string) {
    if (v === 'custom') return;
    const found = DICE_PRESETS.find((p) => dicePresetKey(p.spec) === v);
    if (found) boardDice.value = { ...found.spec };
  },
});

const startCells = computed(() =>
  cells.value.filter((c) => c.isStart).slice().sort((a, b) => a.seq - b.seq),
);
const endCells = computed(() =>
  cells.value.filter((c) => c.endMode).slice().sort((a, b) => a.seq - b.seq),
);

const tileById = computed(() => new Map(tiles.value.map((t) => [t.id, t])));

watch(playMode, (mode) => {
  if (mode === 'solo' && visibility.value === 'public') {
    visibility.value = 'private';
  }
});

/** 格子卡片配色：起点 / 终点 / 有指令 / 普通格 */
type CellTone = 'start' | 'end' | 'tile' | 'plain';

function cellHasOrder(cell: BoardDocument['cells'][number]): boolean {
  return Boolean(cell.body?.trim());
}

function cellTone(cell: BoardDocument['cells'][number]): CellTone {
  if (cell.endMode) return 'end';
  if (cell.isStart || cell.id === startCellId.value) return 'start';
  if (cellHasOrder(cell)) return 'tile';
  return 'plain';
}

function cellTileColor(cell: BoardDocument['cells'][number] | undefined): string | undefined {
  return cell?.tileCategoryColor ?? undefined;
}

function cellHeadText(cell: BoardDocument['cells'][number]) {
  const title = cell.title?.trim();
  return title ? `#${cell.seq}: ${title}` : `#${cell.seq}`;
}

function cellBodyText(cell: BoardDocument['cells'][number]) {
  const body = cell.body?.trim() ?? '';
  if (!body) return '';
  return body.length > 36 ? `${body.slice(0, 36)}…` : body;
}

/** 从指令库拷贝标题/正文/分类到当前格（不保留绑定） */
function applyTileFromLibrary(tileId: string) {
  const cell = selectedCell.value;
  if (!cell || !tileId) return;
  if (tileId === '__clear__') {
    cell.body = '';
    cell.tileCategory = null;
    cell.tileCategoryColor = null;
    cell.tileId = null;
    return;
  }
  const tile = tileById.value.get(tileId);
  if (!tile) return;
  cell.title = tile.title;
  cell.body = (tile.body?.trim() || tile.title).trim();
  cell.tileCategory = tile.category_name;
  cell.tileCategoryColor = tile.category_color;
  cell.tileId = null;
}

function openTilePicker() {
  showTilePicker.value = true;
}

function onTilePicked(tileId: string) {
  applyTileFromLibrary(tileId);
  showTilePicker.value = false;
}

function getCell(col: number, row: number) {
  return cellByPos.value.get(`${col},${row}`);
}

function cellClass(col: number, row: number) {
  const cell = getCell(col, row);
  return {
    filled: !!cell,
    selected: selectedCellId.value === cell?.id,
    linking: linkFromId.value === cell?.id,
    dropTarget: dragOverKey.value === `${col},${row}`,
    dragging: dragCellId.value === cell?.id,
    defaultStart: startCellId.value === cell?.id,
    emphasized: Boolean(cell?.emphasized),
    [`tone-${cell ? cellTone(cell) : 'empty'}`]: true,
  };
}

const cellOptions = computed(() =>
  cells.value
    .map((c) => ({ id: c.id, seq: c.seq, title: c.title || '' }))
    .sort((a, b) => a.seq - b.seq),
);

/** 尚未标为起点的格子，供添加起点下拉 */
const nonStartOptions = computed(() =>
  cellOptions.value.filter((o) => !cells.value.find((c) => c.id === o.id)?.isStart),
);

/** 尚未标为结束格的格子 */
const nonEndOptions = computed(() =>
  cellOptions.value.filter((o) => !cells.value.find((c) => c.id === o.id)?.endMode),
);

/** 出口路径：能直连则直线，否则折线绕开卡片 */
const exitArrows = computed(() => {
  if (!cols.value || !rows.value) return [];
  const geomCells: GeomCell[] = cells.value.map((c) => ({
    col: c.col,
    row: c.row,
    emphasized: Boolean(c.emphasized),
  }));
  const byId = new Map(cells.value.map((c) => [c.id, c]));
  const exitCountFrom = new Map<string, number>();
  for (const e of exits.value) {
    exitCountFrom.set(e.fromCellId, (exitCountFrom.get(e.fromCellId) ?? 0) + 1);
  }
  return exits.value.flatMap((e) => {
    const from = byId.get(e.fromCellId);
    const to = byId.get(e.toCellId);
    if (!from || !to) return [];
    const points = routeExit(
      { col: from.col, row: from.row, emphasized: Boolean(from.emphasized) },
      { col: to.col, row: to.row, emphasized: Boolean(to.emphasized) },
      geomCells,
      cols.value,
      rows.value,
    );
    const labelAt = pathLabelPoint(points);
    const showLabel = (exitCountFrom.get(e.fromCellId) ?? 0) >= 2;
    return [
      {
        id: e.id,
        points: points.map((p) => `${p.x},${p.y}`).join(' '),
        label: showLabel ? e.label : '',
        midX: labelAt.x,
        midY: labelAt.y,
        highlight:
          selectedCellId.value === e.fromCellId || selectedCellId.value === e.toCellId,
      },
    ];
  });
});

function newCellId() {
  return `cell_${Math.random().toString(36).slice(2, 10)}`;
}

function newExitId() {
  return `exit_${Math.random().toString(36).slice(2, 10)}`;
}

async function load() {
  error.value = '';
  const [board, tileList, categoryList] = await Promise.all([
    api.getBoard(boardId.value),
    api.listTiles(),
    api.listCategories(),
  ]);
  name.value = board.name;
  cols.value = board.cols;
  rows.value = board.rows;
  visibility.value = board.visibility === 'public' ? 'public' : 'private';
  playMode.value = board.playMode === 'solo' ? 'solo' : 'multi';
  if (playMode.value === 'solo') visibility.value = 'private';
  startCellId.value = board.startCellId;
  boardDice.value =
    board.dice && isValidDiceSpec(board.dice) ? { ...board.dice } : { ...DEFAULT_DICE };
  cells.value = board.cells.map((c) => ({
    ...c,
    tileId: null,
    forkMode: c.forkMode ?? null,
    seq: c.seq,
    title: c.title ?? '',
    body: c.body ?? '',
    tileCategory: c.tileCategory ?? null,
    tileCategoryColor: c.tileCategoryColor ?? null,
    isStart: Boolean(c.isStart) || c.id === board.startCellId,
    endMode: c.endMode ?? null,
    emphasized: Boolean(c.emphasized),
    forkDice: c.forkDice && isValidDiceSpec(c.forkDice) ? { ...c.forkDice } : null,
  }));
  exits.value = board.exits.map((e) => ({
    ...e,
    faces: e.faces ?? [],
    isDefault: Boolean(e.isDefault),
  }));
  tiles.value = tileList;
  categories.value = categoryList;
  syncSeqDraft();
}

function syncSeqDraft() {
  seqDraft.value = selectedCell.value ? String(selectedCell.value.seq) : '';
}

function focusCellTab(id: string) {
  selectedCellId.value = id;
  configTab.value = 'cell';
  syncSeqDraft();
}

function toggleCell(col: number, row: number) {
  if (didDrag.value) {
    didDrag.value = false;
    return;
  }
  const key = `${col},${row}`;
  const existing = cellByPos.value.get(key);
  if (existing) {
    cells.value = cells.value.filter((c) => c.id !== existing.id);
    exits.value = exits.value.filter(
      (e) => e.fromCellId !== existing.id && e.toCellId !== existing.id,
    );
    if (startCellId.value === existing.id) startCellId.value = null;
    if (selectedCellId.value === existing.id) selectedCellId.value = null;
    if (linkFromId.value === existing.id) linkFromId.value = null;
    syncSeqDraft();
    return;
  }
  const id = newCellId();
  const seq = nextSeq(cells.value.map((c) => c.seq));
  cells.value.push({
    id,
    col,
    row,
    tileId: null,
    forkMode: null,
    seq,
    title: '',
    body: '',
    tileCategory: null,
    tileCategoryColor: null,
    isStart: false,
    endMode: null,
    emphasized: false,
    forkDice: null,
  });
  focusCellTab(id);
}

function selectCell(id: string, event: MouseEvent) {
  event.stopPropagation();
  if (didDrag.value) {
    didDrag.value = false;
    return;
  }
  if (linkFromId.value && linkFromId.value !== id) {
    exits.value.push({
      id: newExitId(),
      fromCellId: linkFromId.value,
      toCellId: id,
      label: '出口',
      faces: [],
      isDefault: false,
    });
    linkFromId.value = null;
    focusCellTab(id);
    message.value = '已添加出口';
    return;
  }
  focusCellTab(id);
}

function onDragStart(cellId: string, event: DragEvent) {
  dragCellId.value = cellId;
  didDrag.value = false;
  event.dataTransfer?.setData('text/plain', cellId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function onDragOverSlot(col: number, row: number, event: DragEvent) {
  if (!dragCellId.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dragOverKey.value = `${col},${row}`;
  didDrag.value = true;
}

function onDragLeaveSlot(col: number, row: number) {
  if (dragOverKey.value === `${col},${row}`) dragOverKey.value = null;
}

function onDropSlot(col: number, row: number, event: DragEvent) {
  event.preventDefault();
  const fromId = dragCellId.value ?? event.dataTransfer?.getData('text/plain');
  dragCellId.value = null;
  dragOverKey.value = null;
  if (!fromId) return;
  const moving = cells.value.find((c) => c.id === fromId);
  if (!moving) return;
  if (moving.col === col && moving.row === row) return;

  const occupant = cellByPos.value.get(`${col},${row}`);
  if (occupant && occupant.id !== fromId) {
    const oc = occupant.col;
    const or = occupant.row;
    occupant.col = moving.col;
    occupant.row = moving.row;
    moving.col = oc;
    moving.row = or;
  } else {
    moving.col = col;
    moving.row = row;
  }
  focusCellTab(fromId);
  message.value = '格子已移动';
  didDrag.value = true;
}

function onDragEnd() {
  dragCellId.value = null;
  dragOverKey.value = null;
}

function startLink() {
  if (!selectedCellId.value) return;
  linkFromId.value = selectedCellId.value;
  message.value = '再点目标格子以画出出口';
}

function addExit() {
  if (!selectedCellId.value) return;
  const target = cells.value
    .filter((c) => c.id !== selectedCellId.value)
    .sort((a, b) => a.seq - b.seq)[0];
  if (!target) {
    error.value = '至少再有一格才能添加出口';
    return;
  }
  exits.value.push({
    id: newExitId(),
    fromCellId: selectedCellId.value,
    toCellId: target.id,
    label: '出口',
    faces: [],
    isDefault: false,
  });
  message.value = '已添加出口，可用下拉改目标';
}

function addStart(id: string) {
  const cell = cells.value.find((c) => c.id === id);
  if (!cell) return;
  cell.isStart = true;
  if (!startCellId.value) startCellId.value = id;
  addStartPick.value = '';
  message.value = `已添加起点：${cellLabel(id)}`;
}

function removeStart(id: string) {
  const cell = cells.value.find((c) => c.id === id);
  if (!cell) return;
  cell.isStart = false;
  if (startCellId.value === id) {
    const other = cells.value.find((c) => c.isStart);
    startCellId.value = other?.id ?? null;
  }
}

function setDefaultStartById(id: string) {
  const cell = cells.value.find((c) => c.id === id);
  if (!cell) return;
  cell.isStart = true;
  startCellId.value = id;
  message.value = `默认起点：${cellLabel(id)}`;
}

/** 格子 Tab：快捷切换起点 */
function toggleStartOnSelected() {
  if (!selectedCell.value) return;
  if (selectedCell.value.isStart) {
    removeStart(selectedCell.value.id);
  } else {
    addStart(selectedCell.value.id);
  }
}

/** 格子 Tab：快捷设/取消终点（默认 direct，模式改到全局 Tab） */
function toggleEndOnSelected() {
  if (!selectedCell.value) return;
  if (selectedCell.value.endMode) {
    removeEnd(selectedCell.value.id);
  } else {
    addEnd(selectedCell.value.id, 'direct');
  }
}

/** 格子 Tab：快捷切换突出显示 */
function toggleEmphasizedOnSelected() {
  if (!selectedCell.value) return;
  selectedCell.value.emphasized = !selectedCell.value.emphasized;
}

function addEnd(id: string, mode: EndMode = 'direct') {
  const cell = cells.value.find((c) => c.id === id);
  if (!cell) return;
  cell.endMode = mode;
  addEndPick.value = '';
  message.value = `已添加结束格：${cellLabel(id)}`;
}

function removeEnd(id: string) {
  const cell = cells.value.find((c) => c.id === id);
  if (!cell) return;
  cell.endMode = null;
}

function setEndModeFor(id: string, mode: string) {
  const cell = cells.value.find((c) => c.id === id);
  if (!cell) return;
  if (!mode) {
    cell.endMode = null;
    return;
  }
  cell.endMode = mode as EndMode;
}

function onAddStartPick(id: string) {
  if (id) addStart(id);
}

function onAddEndPick(id: string) {
  if (id) addEnd(id, 'direct');
}

function removeExit(id: string) {
  exits.value = exits.value.filter((e) => e.id !== id);
}

function exitsFrom(cellId: string) {
  return exits.value.filter((e) => e.fromCellId === cellId);
}

function cellLabel(id: string) {
  const c = cells.value.find((x) => x.id === id);
  if (!c) return id;
  const t = c.title?.trim() || '未命名';
  return `${c.seq} · ${t}`;
}

function setForkMode(mode: string) {
  if (!selectedCell.value) return;
  selectedCell.value.forkMode = (mode || null) as ForkMode | null;
}

function applySeqEdit() {
  if (!selectedCell.value) return;
  const n = Number(seqDraft.value);
  if (!Number.isInteger(n) || n < 1) {
    error.value = '序号须为 ≥1 的整数';
    syncSeqDraft();
    return;
  }
  const result = reassignSeq(
    cells.value.map((c) => ({ id: c.id, seq: c.seq })),
    selectedCell.value.id,
    n,
  );
  if ('error' in result) {
    error.value = result.error;
    syncSeqDraft();
    return;
  }
  error.value = '';
  for (const c of cells.value) {
    const next = result.get(c.id);
    if (next != null) c.seq = next;
  }
  syncSeqDraft();
  message.value = '序号已更新';
}

function toggleFace(exitId: string, face: number) {
  const exit = exits.value.find((e) => e.id === exitId);
  if (!exit) return;
  const set = new Set(exit.faces ?? []);
  if (set.has(face)) set.delete(face);
  else set.add(face);
  exit.faces = [...set].sort((a, b) => a - b);
}

function hasFace(exitId: string, face: number) {
  const exit = exits.value.find((e) => e.id === exitId);
  return (exit?.faces ?? []).includes(face);
}

function setExitDefault(exitId: string, on: boolean) {
  for (const e of exits.value) {
    if (e.id === exitId) {
      e.isDefault = on;
      if (on) {
        // 选为默认后可不勾具体点数
      }
    } else if (on && e.fromCellId === exits.value.find((x) => x.id === exitId)?.fromCellId) {
      e.isDefault = false;
    }
  }
}

function setCellForkDiceSource(useGlobal: boolean) {
  if (!selectedCell.value) return;
  if (useGlobal) {
    selectedCell.value.forkDice = null;
  } else {
    selectedCell.value.forkDice = selectedCell.value.forkDice
      ? { ...selectedCell.value.forkDice }
      : { ...boardDice.value };
  }
}

function setCellForkDicePreset(key: string) {
  if (!selectedCell.value || key === 'custom') return;
  const found = DICE_PRESETS.find((p) => dicePresetKey(p.spec) === key);
  if (found) selectedCell.value.forkDice = { ...found.spec };
}

function faceCoverageHint(cellId: string): string | null {
  const cell = cells.value.find((c) => c.id === cellId);
  const mode = cell?.forkMode ?? 'player_choice';
  if (mode !== 'advance_die' && mode !== 'reroll_die') return null;
  const outs = exitsFrom(cellId);
  if (outs.length < 2) return null;
  const spec =
    mode === 'reroll_die' && cell?.forkDice && isValidDiceSpec(cell.forkDice)
      ? cell.forkDice
      : isValidDiceSpec(boardDice.value)
        ? boardDice.value
        : DEFAULT_DICE;
  const { min, max } = diceRange(spec);
  const defaults = outs.filter((e) => e.isDefault);
  if (defaults.length > 1) return '至多一个默认出口';
  const owner = new Map<number, string>();
  for (const e of outs) {
    for (const f of e.faces ?? []) {
      if (f < min || f > max) return `点数 ${f} 超出 ${formatDiceSpec(spec)} 范围 ${min}–${max}`;
      if (owner.has(f)) return `点数 ${f} 被多个出口占用`;
      owner.set(f, e.id);
    }
  }
  if (defaults.length === 0) {
    const missing: number[] = [];
    for (let f = min; f <= max; f++) {
      if (!owner.has(f)) missing.push(f);
    }
    if (missing.length) {
      return `未覆盖点数：${missing.join(', ')}（可勾选「默认」出口，或补全映射）`;
    }
  }
  return null;
}

async function save() {
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    if (!isValidDiceSpec(boardDice.value)) {
      error.value = `全局骰无效: ${boardDice.value.count}d${boardDice.value.sides}`;
      return;
    }
    await api.updateBoard(boardId.value, {
      name: name.value,
      cols: cols.value,
      rows: rows.value,
      startCellId: startCellId.value,
      visibility: playMode.value === 'solo' ? 'private' : visibility.value,
      playMode: playMode.value,
      dice: boardDice.value,
      cells: cells.value,
      exits: exits.value,
    });
    message.value = '已保存';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败';
  } finally {
    saving.value = false;
  }
}

/** 清空本盘格子与出口（不删指令库） */
function clearBoard() {
  if (!window.confirm('确定清空本盘全部格子与出口？指令库不会删除。未保存前可刷新还原。')) {
    return;
  }
  cells.value = [];
  exits.value = [];
  startCellId.value = null;
  selectedCellId.value = null;
  linkFromId.value = null;
  addStartPick.value = '';
  addEndPick.value = '';
  syncSeqDraft();
  message.value = '已清空本盘（记得保存）';
  error.value = '';
}

function openImport() {
  importText.value = '';
  importSource.value = 'blitzedout';
  showImport.value = true;
  error.value = '';
}

function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    importText.value = String(reader.result ?? '');
  };
  reader.onerror = () => {
    error.value = '读取文件失败';
  };
  reader.readAsText(file, 'utf-8');
  input.value = '';
}

/**
 * 将导入结果蛇形铺到当前盘面：只写格子文案（不入库指令）、清旧格、串联出口。
 * 首格起点，末格直接结束。
 */
async function applyImport() {
  importing.value = true;
  error.value = '';
  message.value = '';
  try {
    const imported = parseImport(importSource.value, importText.value);
    const capacity = checkGridCapacity(cols.value, rows.value, imported.length);
    if (!capacity.ok) {
      error.value = capacity.error;
      return;
    }

    const newCells: BoardDocument['cells'] = [];
    const newExits: BoardDocument['exits'] = [];
    for (let i = 0; i < imported.length; i++) {
      const item = imported[i]!;
      const title = item.title.slice(0, 80) || '未命名';
      const isBoundary = title === '开始' || title === '结束';
      const { col, row } = serpentinePos(i, cols.value);
      const id = newCellId();
      const isFirst = i === 0;
      const isLast = i === imported.length - 1;
      newCells.push({
        id,
        col,
        row,
        tileId: null,
        forkMode: null,
        seq: i + 1,
        title,
        body: isBoundary ? '' : (item.body || item.title).trim(),
        tileCategory: isBoundary ? null : title,
        tileCategoryColor: null,
        isStart: isFirst,
        endMode: isLast ? 'direct' : null,
        emphasized: false,
        forkDice: null,
      });
      if (i > 0) {
        newExits.push({
          id: newExitId(),
          fromCellId: newCells[i - 1]!.id,
          toCellId: id,
          label: '前进',
          faces: [],
          isDefault: false,
        });
      }
    }

    cells.value = newCells;
    exits.value = newExits;
    startCellId.value = newCells[0]?.id ?? null;
    selectedCellId.value = null;
    linkFromId.value = null;
    syncSeqDraft();
    showImport.value = false;
    message.value = `已导入 ${imported.length} 格（未写入指令库，记得保存）`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '导入失败';
  } finally {
    importing.value = false;
  }
}

onMounted(async () => {
  try {
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  }
});
</script>

<template>
  <div class="editor-page">
    <div class="editor-top row" style="justify-content: space-between">
      <div>
        <h1>编辑棋盘</h1>
        <p class="muted">点击空格添加；拖动换位；双击删除。右侧配置全局属性或选中格子。</p>
      </div>
      <div class="row">
        <button type="button" @click="router.push('/boards')">返回</button>
        <button type="button" class="danger" @click="clearBoard">清空</button>
        <button type="button" @click="openImport">导入</button>
        <RouterLink class="primary-link" :to="`/play/${boardId}`">开玩</RouterLink>
        <button class="primary" type="button" :disabled="saving" @click="save">保存</button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>

    <div class="editor-main">
      <div class="card board-panel">
        <div class="board-scroll">
          <div ref="boardStage" class="board-stage" :style="boardCssVars">
          <svg
            class="exit-layer"
            :viewBox="`0 0 ${boardPixelSize.width} ${boardPixelSize.height}`"
            :width="boardPixelSize.width"
            :height="boardPixelSize.height"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <marker
                id="exit-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#6a7388" />
              </marker>
              <marker
                id="exit-arrow-hi"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#ff8fc0" />
              </marker>
            </defs>
            <g v-for="a in exitArrows" :key="a.id">
              <polyline
                :points="a.points"
                fill="none"
                :stroke="a.highlight ? '#ff8fc0' : '#6a7388'"
                :stroke-width="a.highlight ? 3.5 : 2.5"
                :marker-end="a.highlight ? 'url(#exit-arrow-hi)' : 'url(#exit-arrow)'"
                stroke-linecap="round"
                stroke-linejoin="round"
                opacity="0.85"
              />
              <text
                v-if="a.label"
                :x="a.midX"
                :y="a.midY - 4"
                text-anchor="middle"
                fill="#d8e0f0"
                font-size="11"
              >
                {{ a.label }}
              </text>
            </g>
          </svg>
          <div class="board-grid">
            <template v-for="r in rows" :key="'r' + r">
              <button
                v-for="c in cols"
                :key="`${c - 1},${r - 1}`"
                type="button"
                class="cell"
                :class="[
                  cellClass(c - 1, r - 1),
                  { 'has-cat-color': !!cellTileColor(getCell(c - 1, r - 1)) },
                ]"
                :style="
                  cellTileColor(getCell(c - 1, r - 1))
                    ? { '--cat-color': cellTileColor(getCell(c - 1, r - 1)) }
                    : undefined
                "
                :draggable="!!getCell(c - 1, r - 1)"
                :title="getCell(c - 1, r - 1)?.title || undefined"
                @dragstart="getCell(c - 1, r - 1) && onDragStart(getCell(c - 1, r - 1)!.id, $event)"
                @dragover="onDragOverSlot(c - 1, r - 1, $event)"
                @dragleave="onDragLeaveSlot(c - 1, r - 1)"
                @drop="onDropSlot(c - 1, r - 1, $event)"
                @dragend="onDragEnd"
                @click="
                  getCell(c - 1, r - 1)
                    ? selectCell(getCell(c - 1, r - 1)!.id, $event)
                    : toggleCell(c - 1, r - 1)
                "
                @dblclick.prevent="getCell(c - 1, r - 1) && toggleCell(c - 1, r - 1)"
              >
                <template v-if="getCell(c - 1, r - 1)">
                  <div class="cell-card">
                    <div class="cell-head">
                      <span class="cell-head-text">{{
                        cellHeadText(getCell(c - 1, r - 1)!)
                      }}</span>
                      <span
                        v-if="startCellId === getCell(c - 1, r - 1)!.id"
                        class="cell-badge"
                        title="默认起点"
                        >★</span
                      >
                      <span
                        v-else-if="getCell(c - 1, r - 1)!.isStart"
                        class="cell-badge soft"
                        title="起点"
                        >起</span
                      >
                      <span
                        v-if="getCell(c - 1, r - 1)!.endMode"
                        class="cell-badge end"
                        title="结束格"
                        >终</span
                      >
                    </div>
                    <div class="cell-body">
                      {{
                        cellBodyText(getCell(c - 1, r - 1)!) ||
                        (getCell(c - 1, r - 1)!.endMode
                          ? getCell(c - 1, r - 1)!.endMode === 'bounce'
                            ? '残值后退'
                            : '直接结束'
                          : '空格')
                      }}
                    </div>
                  </div>
                </template>
                <span v-else class="cell-empty">＋</span>
              </button>
            </template>
          </div>
          </div>
        </div>
        <p class="board-hint muted">
          红起点 · 粉终点 · 指令按分类着色 · 行列过多时可在棋盘区内滚动
        </p>
      </div>

      <aside class="card stack config-panel">
        <div class="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            :class="{ active: configTab === 'global' }"
            :aria-selected="configTab === 'global'"
            @click="configTab = 'global'"
          >
            全局
          </button>
          <button
            type="button"
            role="tab"
            :class="{ active: configTab === 'cell' }"
            :aria-selected="configTab === 'cell'"
            @click="configTab = 'cell'"
          >
            格子
          </button>
        </div>

        <div v-if="configTab === 'global'" class="tab-body">
          <label>
            名称
            <input v-model="name" />
          </label>
          <label>
            模式
            <select v-model="playMode">
              <option value="multi">多人</option>
              <option value="solo">单人（不可公开）</option>
            </select>
          </label>
          <label>
            可见性
            <select v-model="visibility" :disabled="playMode === 'solo'">
              <option value="private">私有（仅自己）</option>
              <option value="public" :disabled="playMode === 'solo'">
                公开（大厅可见，他人可开房）
              </option>
            </select>
          </label>
          <div class="row">
            <label style="flex: 1">
              列
              <input v-model.number="cols" type="number" min="1" max="20" />
            </label>
            <label style="flex: 1">
              行
              <input v-model.number="rows" type="number" min="1" max="20" />
            </label>
          </div>

          <h3>全局骰子</h3>
          <p class="muted" style="margin: 0">前进始终用此骰（合计点数）</p>
          <label>
            预设
            <select v-model="boardDicePreset">
              <option v-for="p in DICE_PRESETS" :key="p.label" :value="p.label">{{ p.label }}</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <div class="row">
            <label style="flex: 1">
              个数
              <input v-model.number="boardDice.count" type="number" min="1" max="4" />
            </label>
            <label style="flex: 1">
              面数
              <input v-model.number="boardDice.sides" type="number" min="2" max="100" />
            </label>
          </div>
          <p class="muted" style="margin: 0; font-size: 0.85rem">{{ boardDiceRangeLabel }}</p>

          <h3>起点</h3>
          <p class="muted" style="margin: 0">
            共 {{ startCells.length }} 个
            <template v-if="startCellId"> · 默认 {{ cellLabel(startCellId) }}</template>
            <template v-else> · 未设默认</template>
          </p>
          <ul class="role-list">
            <li v-for="c in startCells" :key="c.id" :class="{ default: c.id === startCellId }">
              <span class="role-label">{{ cellLabel(c.id) }}</span>
              <div class="row role-actions">
                <button
                  type="button"
                  :disabled="c.id === startCellId"
                  @click="setDefaultStartById(c.id)"
                >
                  {{ c.id === startCellId ? '默认' : '设默认' }}
                </button>
                <button type="button" class="danger" @click="removeStart(c.id)">移除</button>
              </div>
            </li>
          </ul>
          <p v-if="!startCells.length" class="muted">暂无起点</p>
          <div v-if="nonStartOptions.length" class="add-row">
            <span class="muted">添加起点</span>
            <CellSearchSelect
              :model-value="addStartPick"
              :options="nonStartOptions"
              @update:model-value="onAddStartPick"
            />
          </div>

          <h3>结束格</h3>
          <p class="muted" style="margin: 0">共 {{ endCells.length }} 个</p>
          <ul class="role-list">
            <li v-for="c in endCells" :key="c.id">
              <span class="role-label">{{ cellLabel(c.id) }}</span>
              <div class="row role-actions">
                <select
                  :value="c.endMode ?? ''"
                  @change="
                    setEndModeFor(c.id, ($event.target as HTMLSelectElement).value)
                  "
                >
                  <option v-for="opt in END_OPTIONS" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
                <button type="button" class="danger" @click="removeEnd(c.id)">移除</button>
              </div>
            </li>
          </ul>
          <p v-if="!endCells.length" class="muted">暂无结束格（开局需要至少一个）</p>
          <div v-if="nonEndOptions.length" class="add-row">
            <span class="muted">添加结束格</span>
            <CellSearchSelect
              :model-value="addEndPick"
              :options="nonEndOptions"
              @update:model-value="onAddEndPick"
            />
          </div>
          <p class="muted" style="font-size: 0.8rem">
            直接结束：进入即结束；残值后退：有剩余步则沿本回合轨迹退回。
          </p>
        </div>

        <div v-else class="tab-body">
          <template v-if="selectedCell">
            <p class="muted">坐标 ({{ selectedCell.col }}, {{ selectedCell.row }})</p>
            <label>
              序号
              <input
                v-model="seqDraft"
                type="number"
                min="1"
                @keydown.enter.prevent="applySeqEdit"
                @blur="applySeqEdit"
              />
            </label>
            <label>
              标题
              <input v-model="selectedCell.title" placeholder="可选" />
            </label>
            <label>
              指令正文
              <textarea
                v-model="selectedCell.body"
                rows="4"
                placeholder="有正文时对局会弹出指令；可从下方指令库拷贝"
              />
            </label>
            <div class="stack" style="gap: 0.35rem">
              <span class="muted" style="font-size: 0.85rem">从指令库选用（拷贝到本格，不绑定）</span>
              <div class="row" style="flex-wrap: wrap; gap: 0.4rem">
                <button type="button" class="primary" @click="openTilePicker">从指令库选用</button>
                <button type="button" @click="applyTileFromLibrary('__clear__')">清除正文</button>
              </div>
            </div>
            <div class="row" style="flex-wrap: wrap">
              <button type="button" @click="toggleEmphasizedOnSelected">
                {{ selectedCell.emphasized ? '取消突出' : '设为突出' }}
              </button>
              <button type="button" @click="toggleStartOnSelected">
                {{ selectedCell.isStart ? '取消起点' : '设为起点' }}
              </button>
              <button
                v-if="selectedCell.isStart && selectedCell.id !== startCellId"
                type="button"
                @click="setDefaultStartById(selectedCell.id)"
              >
                设为默认起点
              </button>
              <button type="button" @click="toggleEndOnSelected">
                {{ selectedCell.endMode ? '取消终点' : '设为终点' }}
              </button>
            </div>
            <p v-if="selectedCell.endMode" class="muted" style="font-size: 0.8rem">
              当前结束模式：{{
                END_OPTIONS.find((o) => o.value === selectedCell!.endMode)?.label ??
                selectedCell!.endMode
              }}（可在「全局」Tab 修改）
            </p>
            <h3>从此格出发的出口</h3>
            <label v-if="selectedExitCount >= 2">
              出口模式
              <select
                :value="selectedCell.forkMode ?? 'player_choice'"
                @change="setForkMode(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="opt in FORK_OPTIONS" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </label>
            <p v-else-if="selectedExitCount === 1" class="muted">
              再添加一条出口后可配置出口模式（点数分叉 / 自选等）
            </p>
            <p v-if="selectedCell.forkMode === 'status'" class="muted">
              模式三本版仅预留，开局会被拒绝。
            </p>
            <template v-if="needsFaceMap && selectedCell.forkMode === 'reroll_die'">
              <label>
                分叉骰来源
                <select
                  :value="selectedCell.forkDice ? 'cell' : 'global'"
                  @change="
                    setCellForkDiceSource(
                      ($event.target as HTMLSelectElement).value === 'global',
                    )
                  "
                >
                  <option value="global">使用全局骰（{{ formatDiceSpec(boardDice) }}）</option>
                  <option value="cell">本格独立骰</option>
                </select>
              </label>
              <template v-if="selectedCell.forkDice">
                <label>
                  独立骰预设
                  <select
                    :value="
                      DICE_PRESETS.some(
                        (p) => dicePresetKey(p.spec) === dicePresetKey(selectedCell!.forkDice!),
                      )
                        ? dicePresetKey(selectedCell.forkDice)
                        : 'custom'
                    "
                    @change="setCellForkDicePreset(($event.target as HTMLSelectElement).value)"
                  >
                    <option v-for="p in DICE_PRESETS" :key="p.label" :value="p.label">
                      {{ p.label }}
                    </option>
                    <option value="custom">自定义</option>
                  </select>
                </label>
                <div class="row">
                  <label style="flex: 1">
                    个数
                    <input
                      v-model.number="selectedCell.forkDice.count"
                      type="number"
                      min="1"
                      max="4"
                    />
                  </label>
                  <label style="flex: 1">
                    面数
                    <input
                      v-model.number="selectedCell.forkDice.sides"
                      type="number"
                      min="2"
                      max="100"
                    />
                  </label>
                </div>
              </template>
            </template>
            <p v-if="needsFaceMap" class="muted" style="font-size: 0.85rem; margin: 0">
              映射骰 {{ formatDiceSpec(activeFaceDice) }} · 点数
              {{ diceRange(activeFaceDice).min }}–{{ diceRange(activeFaceDice).max }}
            </p>
            <p v-if="selectedCell && faceCoverageHint(selectedCell.id)" class="error">
              {{ faceCoverageHint(selectedCell.id) }}
            </p>
            <ul class="exit-list">
              <li v-for="e in exitsFrom(selectedCell.id)" :key="e.id" class="exit-item">
                <div class="row">
                  <input
                    v-if="selectedExitCount >= 2"
                    v-model="e.label"
                    style="width: 5rem"
                    placeholder="标签"
                  />
                  <CellSearchSelect
                    v-model="e.toCellId"
                    :options="cellOptions"
                    :exclude-id="selectedCell.id"
                  />
                  <button type="button" class="danger" @click="removeExit(e.id)">删</button>
                </div>
                <div v-if="needsFaceMap" class="faces row">
                  <label class="face">
                    <input
                      type="checkbox"
                      :checked="e.isDefault"
                      @change="
                        setExitDefault(e.id, ($event.target as HTMLInputElement).checked)
                      "
                    />
                    默认
                  </label>
                  <label v-for="f in faceChoices" :key="f" class="face">
                    <input
                      type="checkbox"
                      :checked="hasFace(e.id, f)"
                      @change="toggleFace(e.id, f)"
                    />
                    {{ f }}
                  </label>
                </div>
              </li>
            </ul>
            <p v-if="!exitsFrom(selectedCell.id).length" class="muted">暂无出口</p>
            <div class="row">
              <button type="button" class="primary" @click="addExit">添加出口</button>
              <button type="button" @click="startLink">画出口</button>
            </div>
          </template>
          <p v-else class="muted">点击左侧格子进行配置</p>
        </div>
      </aside>
    </div>

    <div v-if="showImport" class="modal-backdrop" @click.self="showImport = false">
      <div class="card modal stack import-modal">
        <h2>导入棋盘</h2>
        <label>
          来源
          <select v-model="importSource">
            <option v-for="s in IMPORT_SOURCES" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </label>
        <p class="muted" style="margin: 0; font-size: 0.85rem">
          将按当前 {{ cols }}×{{ rows }} 网格蛇形铺盘；容量不足会拒绝导入。导入会写入指令库，并替换本盘格子（需再保存）。
        </p>
        <label>
          粘贴导出文本
          <textarea v-model="importText" rows="12" placeholder="粘贴 BlitzedOut 导出内容…" />
        </label>
        <label>
          或选择文件
          <input type="file" accept=".txt,text/plain" @change="onImportFile" />
        </label>
        <div class="row" style="justify-content: flex-end">
          <button type="button" :disabled="importing" @click="showImport = false">取消</button>
          <button
            class="primary"
            type="button"
            :disabled="importing || !importText.trim()"
            @click="applyImport"
          >
            {{ importing ? '导入中…' : '确认导入' }}
          </button>
        </div>
      </div>
    </div>

    <TileLibraryPickerModal
      :open="showTilePicker"
      :tiles="tiles"
      :categories="categories"
      :default-play-mode="playMode"
      @close="showTilePicker = false"
      @select="onTilePicked"
    />
  </div>
</template>

<style scoped>
.ok {
  color: var(--ok);
}
.editor-page {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  height: 100%;
  min-height: 0;
}
.editor-top {
  flex-shrink: 0;
}
.editor-top h1 {
  margin-bottom: 0.15rem;
}
.editor-main {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 1rem;
  align-items: stretch;
}
.board-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.85rem;
  background: linear-gradient(160deg, #1a2230 0%, #121820 55%, #0e1218 100%);
  border-color: #2a3548;
}
.board-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.18);
}
.board-hint {
  flex-shrink: 0;
  margin: 0;
  font-size: 0.8rem;
}
.config-panel {
  width: min(380px, 36vw);
  flex-shrink: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
@media (max-width: 860px) {
  .editor-main {
    flex-direction: column;
  }
  .config-panel {
    width: 100%;
    max-height: 42vh;
  }
}
.tabs {
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  align-items: stretch;
  gap: 0.35rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.35rem;
}
.tabs button {
  flex: 1 1 0;
  width: 0;
  height: 2.5rem;
  min-height: 2.5rem;
  max-height: 2.5rem;
  box-sizing: border-box;
  padding: 0 0.75rem;
  margin: 0;
  background: transparent;
  border: 1px solid transparent;
  color: var(--muted, #cbb8d8);
  border-radius: 8px;
  white-space: nowrap;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  writing-mode: horizontal-tb;
}
.tabs button.active {
  color: var(--text);
  border-color: var(--border);
  background: #2a2038;
  font-weight: 700;
}
.tab-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: stretch;
  gap: 0.65rem;
}
.tab-body > * {
  flex: 0 0 auto;
}
.tab-body h3 {
  margin: 0.15rem 0 0;
  font-size: 0.95rem;
}
.tab-body .row {
  align-items: center;
}
.tab-body label {
  gap: 0.3rem;
}
.role-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.5rem;
}
.role-list li {
  display: grid;
  gap: 0.35rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #1a1220;
}
.role-list li.default {
  border-color: #6dffa8;
}
.role-label {
  font-weight: 600;
}
.role-actions {
  flex-wrap: wrap;
}
.role-actions select {
  flex: 1;
  min-width: 8rem;
}
.add-row {
  display: grid;
  gap: 0.35rem;
}
.board-stage {
  position: relative;
  width: max-content;
  box-sizing: border-box;
  padding: var(--pad, 36px);
}
.exit-layer {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  z-index: 2;
  overflow: visible;
}
.board-grid {
  display: grid;
  grid-template-columns: repeat(var(--cols), var(--slot-w));
  grid-auto-rows: var(--slot-h);
  gap: var(--gap, 36px);
  place-items: center;
  position: relative;
  z-index: 1;
  width: max-content;
}
.cell {
  width: var(--cell-w, 96px);
  height: var(--cell-h, 100.8px);
  padding: 0;
  border-radius: 12px;
  background: transparent;
  border: 1.5px dashed #3a4658;
  display: block;
  cursor: pointer;
  overflow: hidden;
  color: #fff;
  box-shadow: none;
  transition: transform 0.12s ease, box-shadow 0.12s ease, width 0.12s ease,
    height 0.12s ease;
}
.cell.emphasized {
  width: 100%;
  height: 100%;
}
.cell-empty {
  display: grid;
  place-items: center;
  height: 100%;
  color: #5a6a80;
  font-size: 1.25rem;
  font-weight: 300;
}
.cell.filled {
  border-style: solid;
  border-width: 2px;
  cursor: grab;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.45);
}
.cell.filled:active {
  cursor: grabbing;
}
.cell.filled:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.55);
}
.cell.selected {
  outline: 2px solid #e8c4ff;
  outline-offset: 2px;
}
.cell.linking {
  outline: 2px solid var(--accent-2);
  outline-offset: 2px;
}
.cell.dropTarget {
  outline: 2px dashed #9ad0ff;
  outline-offset: 2px;
}
.cell.dragging {
  opacity: 0.4;
}

/* 参考图分色卡片 */
.cell.tone-start {
  background: linear-gradient(165deg, #e07068 0%, #c44a42 55%, #a83832 100%);
  border-color: #ff9a92;
}
.cell.tone-end {
  background: linear-gradient(165deg, #d46a9e 0%, #a83d72 55%, #8a2f5c 100%);
  border-color: #ff8fc0;
}
.cell.tone-tile {
  background: linear-gradient(165deg, #4cb89a 0%, #2d8a6e 55%, #226a54 100%);
  border-color: #7dffc8;
}
.cell.tone-tile.has-cat-color {
  background: color-mix(in srgb, var(--cat-color) 55%, #1a2030);
  border-color: var(--cat-color);
}
.cell.tone-plain {
  background: linear-gradient(165deg, #5a6eb8 0%, #3d4a8a 55%, #2e3868 100%);
  border-color: #8aa0ff;
}
.cell.tone-empty {
  background: rgba(18, 24, 32, 0.55);
}

.cell.defaultStart.filled {
  box-shadow: 0 0 0 2px #6dffa8, 0 6px 16px rgba(0, 0, 0, 0.45);
}

.cell-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  text-align: left;
  pointer-events: none;
}
.cell-head {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.35rem 0.4rem 0.3rem;
  background: rgba(0, 0, 0, 0.28);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  min-height: 1.6rem;
}
.cell-head-text {
  flex: 1;
  min-width: 0;
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}
.cell-badge {
  flex-shrink: 0;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 0.58rem;
  font-weight: 800;
  background: #3dd68c;
  color: #0a2a18;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35);
}
.cell-badge.soft {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}
.cell-badge.end {
  background: #ff6b9d;
  color: #2a0a16;
}
.cell-body {
  flex: 1;
  padding: 0.4rem 0.45rem 0.45rem;
  font-size: 0.68rem;
  line-height: 1.35;
  opacity: 0.95;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}
.exit-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.75rem;
}
.exit-item {
  display: grid;
  gap: 0.35rem;
}
.faces {
  padding-left: 0.25rem;
}
.face {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--text);
  font-size: 0.85rem;
  width: auto;
}
.face input {
  width: auto;
}
.primary-link {
  display: inline-flex;
  align-items: center;
  padding: 0 1rem;
  height: 2.25rem;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #1a0f1f;
  font-weight: 700;
}
.import-modal {
  width: min(560px, 100%);
  max-height: min(90vh, 720px);
  overflow: auto;
}
.import-modal textarea {
  min-height: 12rem;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.85rem;
}
.import-modal input[type='file'] {
  height: auto;
  min-height: 0;
  padding: 0.4rem 0;
  background: transparent;
  border: none;
}
</style>
