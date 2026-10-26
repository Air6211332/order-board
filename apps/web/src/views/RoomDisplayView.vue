<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { GameState } from '@order-board/rules';
import { api, type RoomDto } from '../api';
import { resolveOrderBody } from '../resolveOrderBody';
import { RoomSocket, type ServerMessage } from '../roomWs';

const PHASE_LABEL: Record<string, string> = {
  pick_start: '选起点',
  roll: '掷骰',
  choose_exit: '选出口',
  order: '执行指令',
  ended: '已结束',
};

const route = useRoute();
const roomCode = computed(() => String(route.params.code).toUpperCase());

const room = ref<RoomDto | null>(null);
const state = ref<GameState | null>(null);
const error = ref('');
const wsStatus = ref<'connecting' | 'open' | 'closed'>('connecting');
const isFullscreen = ref(false);

let socket: RoomSocket | null = null;

const currentPlayer = computed(() => {
  if (!state.value) return null;
  return state.value.players[state.value.currentPlayerIndex] ?? null;
});

/** 是否有待执行指令（主视觉切换依据） */
const hasPendingOrder = computed(
  () => state.value?.phase === 'order' && Boolean(state.value.pendingOrder),
);

const diceHint = computed(() => {
  if (!state.value) return '';
  const parts: string[] = [];
  if (state.value.lastRoll != null) parts.push(`前进骰 ${state.value.lastRoll}`);
  if (state.value.lastBranchRoll != null) parts.push(`分叉骰 ${state.value.lastBranchRoll}`);
  return parts.join(' · ');
});

const resolvedOrderBody = computed(() => {
  const order = state.value?.pendingOrder;
  if (!order || !room.value) return '';
  return resolveOrderBody(
    order.tile.body,
    room.value.seats,
    currentPlayer.value?.name ?? '玩家',
    room.value.playMode ?? 'multi',
  );
});

/** 大厅 / 无局时的状态文案 */
const lobbyStatusLabel = computed(() => {
  if (!room.value) return '加载中…';
  if (room.value.status === 'lobby') return '大厅等待中';
  if (room.value.status === 'ended') return '对局已结束';
  return '对局中';
});

const phaseLabel = computed(() => {
  if (!state.value) return lobbyStatusLabel.value;
  if (state.value.phase === 'ended') return '全员已到达终点';
  return PHASE_LABEL[state.value.phase] ?? state.value.phase;
});

function handleMessage(msg: ServerMessage) {
  if (msg.type === 'error') {
    error.value = String(msg.error ?? '错误');
    return;
  }
  if (msg.type === 'room_updated' && msg.room) {
    error.value = '';
    room.value = msg.room as RoomDto;
    if ('state' in msg) {
      state.value = (msg.state as GameState | null | undefined) ?? null;
    }
    return;
  }
  if (msg.type === 'game_started') {
    error.value = '';
    room.value = msg.room as RoomDto;
    state.value = msg.state as GameState;
    return;
  }
  if (msg.type === 'state') {
    error.value = '';
    state.value = msg.state as GameState;
  }
}

async function enterFullscreen() {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement) {
      await el.requestFullscreen();
    }
  } catch {
    error.value = '无法进入全屏，请检查浏览器权限';
  }
}

function onFullscreenChange() {
  isFullscreen.value = Boolean(document.fullscreenElement);
}

onMounted(async () => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
  error.value = '';
  try {
    // 只读：HTTP 快照 + WS join_room 订阅，不发 join / 游戏意图
    const data = await api.getRoom(roomCode.value);
    room.value = data.room;
    state.value = data.state;
    socket = new RoomSocket({
      onMessage: handleMessage,
      onStatus: (s) => {
        wsStatus.value = s;
      },
    });
    socket.connect();
    socket.send({ type: 'join_room', roomCode: roomCode.value });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载大屏失败';
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  socket?.send({ type: 'leave' });
  socket?.close();
  socket = null;
});
</script>

<template>
  <div class="display">
    <header class="display-bar">
      <div class="display-meta">
        <span class="room-code">房间 {{ roomCode }}</span>
        <span class="muted">
          {{ room?.boardName ?? '…' }}
          · WS {{ wsStatus === 'open' ? '已连接' : wsStatus === 'connecting' ? '连接中' : '断开' }}
        </span>
      </div>
      <button
        v-if="!isFullscreen"
        type="button"
        class="primary fullscreen-btn"
        @click="enterFullscreen"
      >
        进入全屏
      </button>
      <span v-else class="muted fullscreen-hint">Esc 退出全屏</span>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <!-- 主视觉：有指令时内容占满；否则突出当前人与阶段 -->
    <main class="display-main">
      <template v-if="hasPendingOrder && state?.pendingOrder">
        <p class="eyebrow">
          {{ currentPlayer?.name ?? '—' }} · 执行中
        </p>
        <p
          class="kind-label"
          :style="
            state.pendingOrder.tile.categoryColor
              ? { color: state.pendingOrder.tile.categoryColor }
              : undefined
          "
        >
          {{ state.pendingOrder.tile.category }}
        </p>
        <h1 class="order-title">{{ state.pendingOrder.tile.title }}</h1>
        <p class="order-body">{{ resolvedOrderBody }}</p>
      </template>

      <template v-else-if="state">
        <p v-if="state.phase !== 'ended'" class="hero-name">
          {{ currentPlayer?.name ?? '—' }}
        </p>
        <p class="hero-phase">{{ phaseLabel }}</p>
        <p v-if="diceHint" class="hero-dice">{{ diceHint }}</p>
      </template>

      <template v-else>
        <p class="hero-name">{{ lobbyStatusLabel }}</p>
        <p v-if="room?.boardName" class="hero-phase">{{ room.boardName }}</p>
      </template>
    </main>

    <!-- 次要：玩家列表 -->
    <footer class="display-footer">
      <ul v-if="state?.players?.length" class="player-row">
        <li
          v-for="p in state.players"
          :key="p.id"
          :class="{ finished: p.finished, current: p.id === currentPlayer?.id }"
        >
          {{ p.name }}
          <span v-if="p.finished" class="muted"> · 已结束</span>
        </li>
      </ul>
      <ul v-else-if="room?.seats?.length" class="player-row">
        <li v-for="s in room.seats" :key="s.id">{{ s.displayName }}</li>
      </ul>
    </footer>
  </div>
</template>

<style scoped>
.display {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 1.7rem);
  height: 100%;
  gap: 1rem;
  padding: 0.5rem 0.75rem 1rem;
  box-sizing: border-box;
}

.display-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.display-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem 1rem;
}

.room-code {
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.fullscreen-btn {
  height: 2.5rem;
  font-size: 1rem;
  padding: 0 1.25rem;
}

.fullscreen-hint {
  font-size: 0.9rem;
}

.display-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 1rem 1.5rem;
  min-height: 0;
}

.eyebrow {
  margin: 0 0 1rem;
  font-size: clamp(0.95rem, 2vw, 1.25rem);
  color: var(--muted);
  letter-spacing: 0.06em;
}

.kind-label {
  margin: 0 0 0.75rem;
  font-size: clamp(1.25rem, 3.5vw, 2rem);
  font-weight: 700;
  letter-spacing: 0.12em;
}

.order-title {
  margin: 0 0 1.25rem;
  font-size: clamp(2.25rem, 8vw, 5.5rem);
  line-height: 1.15;
  font-weight: 800;
  max-width: 18em;
}

.order-body {
  margin: 0;
  white-space: pre-wrap;
  font-size: clamp(1.15rem, 3.2vw, 2.1rem);
  line-height: 1.55;
  color: color-mix(in srgb, var(--text) 92%, transparent);
  max-width: 28em;
}

.hero-name {
  margin: 0 0 0.75rem;
  font-size: clamp(3rem, 12vw, 7.5rem);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: 0.02em;
}

.hero-phase {
  margin: 0;
  font-size: clamp(1.5rem, 4.5vw, 2.75rem);
  color: var(--accent-2);
  font-weight: 600;
}

.hero-dice {
  margin: 0.85rem 0 0;
  font-size: clamp(1.1rem, 3vw, 1.75rem);
  color: var(--muted);
}

.display-footer {
  padding-top: 0.25rem;
}

.player-row {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.65rem 1.5rem;
  font-size: clamp(0.95rem, 2vw, 1.2rem);
}

.player-row li.finished {
  opacity: 0.45;
  text-decoration: line-through;
}

.player-row li.current:not(.finished) {
  font-weight: 700;
  color: var(--accent-2);
}
</style>
