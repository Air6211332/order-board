<script setup lang="ts">
import { computed } from 'vue';
import type { Cell, GameState, Player } from '@order-board/rules';
import { avatarDataUrl } from '../../avatar';

const props = withDefaults(
  defineProps<{
    state: GameState;
    /** 视角玩家；缺省为当前回合玩家 */
    focusPlayerId?: string | null;
    /** 前后各取几格（按 seq） */
    windowSize?: number;
  }>(),
  { focusPlayerId: null, windowSize: 3 },
);

const sortedCells = computed(() =>
  [...props.state.board.cells].sort((a, b) => a.seq - b.seq),
);

const focusPlayer = computed((): Player | null => {
  if (props.focusPlayerId) {
    return props.state.players.find((p) => p.id === props.focusPlayerId) ?? null;
  }
  return props.state.players[props.state.currentPlayerIndex] ?? null;
});

const windowCells = computed(() => {
  const cells = sortedCells.value;
  if (!cells.length) return [] as Cell[];
  const focusId = focusPlayer.value?.cellId;
  let idx = focusId ? cells.findIndex((c) => c.id === focusId) : 0;
  if (idx < 0) idx = 0;
  const n = props.windowSize;
  const from = Math.max(0, idx - n);
  const to = Math.min(cells.length - 1, idx + n);
  return cells.slice(from, to + 1);
});

function playersOn(cellId: string): Player[] {
  return props.state.players.filter((p) => p.cellId === cellId && !p.finished);
}

function cellTitle(cell: Cell): string {
  return cell.title?.trim() || (cell.tile?.title ?? '空格');
}

function isCurrent(cellId: string): boolean {
  return focusPlayer.value?.cellId === cellId;
}
</script>

<template>
  <div class="strip stack">
    <p class="muted strip-hint">
      按序号展示当前格前后 {{ windowSize }} 格（非完整棋盘）
    </p>
    <article
      v-for="cell in windowCells"
      :key="cell.id"
      class="cell-card"
      :class="{
        current: isCurrent(cell.id),
        end: Boolean(cell.endMode),
        start: state.board.startCellIds?.includes(cell.id),
      }"
    >
      <div class="cell-head row">
        <span class="seq">#{{ cell.seq }}</span>
        <strong class="title">{{ cellTitle(cell) }}</strong>
        <span v-if="cell.endMode" class="tag">终点</span>
        <span v-if="state.board.startCellIds?.includes(cell.id)" class="tag">起点</span>
      </div>
      <p v-if="cell.tile" class="tile-line muted">
        <span
          v-if="cell.tile.category"
          class="cat"
          :style="cell.tile.categoryColor ? { color: cell.tile.categoryColor } : undefined"
        >
          {{ cell.tile.category }}
        </span>
        {{ cell.tile.title }}
      </p>
      <div v-if="playersOn(cell.id).length" class="tokens row">
        <span
          v-for="p in playersOn(cell.id)"
          :key="p.id"
          class="token"
          :title="p.name"
        >
          <img
            v-if="p.avatarSeed"
            class="token-avatar"
            :src="avatarDataUrl(p.avatarSeed)"
            :alt="p.name"
            width="28"
            height="28"
          />
          <span v-else class="token-dot" />
          <span class="token-name">{{ p.name }}</span>
        </span>
      </div>
    </article>
  </div>
</template>

<style scoped>
.strip-hint {
  margin: 0;
  font-size: 0.8rem;
}

.cell-card {
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 0.85rem 1rem;
  background: var(--panel);
}

.cell-card.current {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
  background: color-mix(in srgb, var(--panel) 70%, var(--accent) 12%);
}

.cell-card.end {
  border-style: dashed;
}

.cell-head {
  gap: 0.5rem;
  align-items: baseline;
}

.seq {
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  font-size: 0.85rem;
}

.title {
  flex: 1;
  min-width: 0;
}

.tag {
  font-size: 0.72rem;
  color: var(--accent-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
}

.tile-line {
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
}

.cat {
  margin-right: 0.35rem;
}

.tokens {
  margin-top: 0.55rem;
  gap: 0.5rem;
}

.token {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-height: 32px;
  padding: 0.15rem 0.45rem 0.15rem 0.15rem;
  border-radius: 999px;
  background: var(--panel-2);
  font-size: 0.8rem;
}

.token-avatar {
  border-radius: 50%;
  display: block;
}

.token-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent);
}

.token-name {
  max-width: 5.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
