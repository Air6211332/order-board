<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { GameState } from '@order-board/rules';
import { api, type RoomDto, type SeatRole } from '../api';
import { BoardScene, createGame } from '../game/BoardScene';
import { resolveOrderBody } from '../resolveOrderBody';
import { RoomSocket, type ServerMessage } from '../roomWs';
import { useAuthStore } from '../stores/auth';
import type Phaser from 'phaser';

const PHASE_LABEL: Record<string, string> = {
  pick_start: '选起点',
  roll: '掷骰',
  choose_exit: '选出口',
  order: '执行指令',
  ended: '已结束',
};

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const roomCode = computed(() => String(route.params.code).toUpperCase());

const room = ref<RoomDto | null>(null);
const state = ref<GameState | null>(null);
const error = ref('');
const wsStatus = ref<'connecting' | 'open' | 'closed'>('connecting');
const newSeatName = ref('');
const canvasHost = ref<HTMLElement | null>(null);

let game: Phaser.Game | null = null;
let socket: RoomSocket | null = null;

const isHost = computed(() => room.value && auth.user && room.value.hostUserId === auth.user.id);

const mySeatIds = computed(() => {
  if (!room.value || !auth.user) return new Set<string>();
  return new Set(room.value.seats.filter((s) => s.userId === auth.user!.id).map((s) => s.id));
});

const currentPlayer = computed(() => {
  if (!state.value) return null;
  return state.value.players[state.value.currentPlayerIndex] ?? null;
});

/** 是否由我控制该玩家（seatId 匹配，或按座位顺序兜底） */
function isMyPlayer(playerId: string, playerIndex: number): boolean {
  if (!auth.user || !room.value) return false;
  if (mySeatIds.value.has(playerId)) return true;
  const seat = room.value.seats[playerIndex];
  return Boolean(seat && seat.userId === auth.user.id);
}

const canControl = computed(() => {
  if (!state.value || !currentPlayer.value) return false;
  return isMyPlayer(currentPlayer.value.id, state.value.currentPlayerIndex);
});

const startOptions = computed(() => {
  if (!state.value) return [];
  const board = state.value.board;
  const ids = board.startCellIds?.length ? board.startCellIds : [board.startCellId];
  return ids.map((id) => {
    const cell = board.cells.find((c) => c.id === id);
    const title = cell?.title?.trim() || '起点';
    return { id, label: `${cell?.seq ?? '?'} · ${title}` };
  });
});

const diceHint = computed(() => {
  if (!state.value) return '';
  const parts: string[] = [];
  if (state.value.lastRoll != null) parts.push(`前进骰 ${state.value.lastRoll}`);
  if (state.value.lastBranchRoll != null) parts.push(`分叉骰 ${state.value.lastBranchRoll}`);
  return parts.join(' · ');
});

const isSolo = computed(() => room.value?.playMode === 'solo');

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

async function changeSeatRole(seatId: string, raw: string) {
  error.value = '';
  try {
    const role: SeatRole | null =
      raw === 'dominant' || raw === 'submissive' ? raw : null;
    room.value = await api.setSeatRole(roomCode.value, seatId, role);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '设置角色失败';
  }
}

function syncScene() {
  if (!game || !state.value) return;
  const scene = game.scene.getScene('BoardScene') as BoardScene;
  if (scene?.sys?.isActive()) scene.syncState(state.value);
}

async function ensureGameCanvas() {
  if (!state.value || game) return;
  await nextTick();
  if (!canvasHost.value) return;
  game = createGame(canvasHost.value, state.value.board, {
    onExitChosen: (exitId) => {
      if (!canControl.value || state.value?.phase !== 'choose_exit') return;
      socket?.send({ type: 'choose_exit', roomCode: roomCode.value, exitId });
    },
    onStartCellChosen: (cellId) => {
      if (!canControl.value || state.value?.phase !== 'pick_start') return;
      socket?.send({ type: 'pick_start', roomCode: roomCode.value, cellId });
    },
  });
  game.events.once('ready', () => syncScene());
  setTimeout(syncScene, 100);
}

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
      if (state.value) void ensureGameCanvas().then(syncScene);
    }
    return;
  }
  if (msg.type === 'game_started') {
    error.value = '';
    room.value = msg.room as RoomDto;
    state.value = msg.state as GameState;
    void ensureGameCanvas().then(syncScene);
    return;
  }
  if (msg.type === 'state') {
    error.value = '';
    state.value = msg.state as GameState;
    void ensureGameCanvas().then(syncScene);
  }
}

function send(intent: Parameters<RoomSocket['send']>[0]) {
  error.value = '';
  socket?.send(intent);
}

async function addSeat() {
  const name = newSeatName.value.trim() || `玩家${(room.value?.seats.length ?? 0) + 1}`;
  send({ type: 'add_seat', roomCode: roomCode.value, displayName: name });
  newSeatName.value = '';
}

function removeSeat(seatId: string) {
  send({ type: 'remove_seat', roomCode: roomCode.value, seatId });
}

function startGame() {
  send({ type: 'start_game', roomCode: roomCode.value });
}

function onRoll() {
  if (!canControl.value) return;
  send({ type: 'roll', roomCode: roomCode.value });
}

function onPickStart(cellId: string) {
  if (!canControl.value) return;
  send({ type: 'pick_start', roomCode: roomCode.value, cellId });
}

function onChooseExit(exitId: string) {
  if (!canControl.value) return;
  send({ type: 'choose_exit', roomCode: roomCode.value, exitId });
}

function onConfirmOrder() {
  if (!canControl.value) return;
  send({ type: 'confirm_order', roomCode: roomCode.value });
}

/** 新窗口打开只读大屏 */
function openDisplay() {
  window.open(`/room/${roomCode.value}/display`, '_blank', 'noopener');
}

watch(
  () => state.value?.phase,
  (phase) => {
    if (phase === 'ended') {
      /* 保留画布展示终局 */
    }
  },
);

onMounted(async () => {
  error.value = '';
  try {
    // 先 HTTP 拉快照（含已开始对局的持久化 state），再 WS 订阅/重连
    const data = await api.getRoom(roomCode.value);
    room.value = data.room;
    state.value = data.state;
    const joined = await api.joinRoom(roomCode.value);
    room.value = joined.room;
    if (joined.state) state.value = joined.state;
    socket = new RoomSocket({
      onMessage: handleMessage,
      onStatus: (s) => {
        wsStatus.value = s;
      },
    });
    socket.connect();
    socket.send({ type: 'join_room', roomCode: roomCode.value });
    if (state.value) await ensureGameCanvas();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '进入房间失败';
  }
});

onBeforeUnmount(() => {
  socket?.send({ type: 'leave' });
  socket?.close();
  socket = null;
  game?.destroy(true);
  game = null;
});
</script>

<template>
  <div class="stack">
    <div class="row" style="justify-content: space-between; flex-wrap: wrap">
      <div>
        <h1>房间 {{ roomCode }}</h1>
        <p class="muted">
          {{ room?.boardName ?? '…' }}
          ·
          <template v-if="room?.playMode === 'solo'">单人</template>
          <template v-else>多人</template>
          ·
          <template v-if="room?.visibility === 'private'">私有</template>
          <template v-else>公开</template>
          ·
          <template v-if="room?.status === 'lobby'">大厅</template>
          <template v-else-if="room?.status === 'playing'">对局中</template>
          <template v-else>已结束</template>
          · WS {{ wsStatus === 'open' ? '已连接' : wsStatus === 'connecting' ? '连接中' : '断开' }}
        </p>
      </div>
      <div class="row">
        <button type="button" class="primary" @click="openDisplay">打开大屏</button>
        <button type="button" @click="router.push('/')">返回</button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="room?.status === 'lobby'">
      <div class="card stack" style="max-width: 560px">
        <h2>大厅座位</h2>
        <p class="muted">
          为座位指定支配者/顺从者，指令正文中的占位符会在对局时替换。
          <template v-if="isSolo">单人模式仅一个座位。</template>
          <template v-else>同用户可占多个座位。</template>
        </p>
        <ul class="seat-list">
          <li v-for="s in room.seats" :key="s.id" class="seat-row">
            <div class="row" style="flex-wrap: wrap; gap: 0.5rem; align-items: center; flex: 1">
              <span>
                {{ s.displayName }}
                <span class="muted" v-if="s.userId === auth.user?.id">（你）</span>
                <span class="muted" v-if="s.userId === room.hostUserId">· 房主</span>
              </span>
              <select
                :value="s.role ?? ''"
                :disabled="!isHost && s.userId !== auth.user?.id"
                @change="
                  changeSeatRole(
                    s.id,
                    ($event.target as HTMLSelectElement).value,
                  )
                "
              >
                <option value="">未指定角色</option>
                <option value="dominant">支配者</option>
                <option value="submissive">顺从者</option>
              </select>
            </div>
            <button
              type="button"
              class="danger"
              :disabled="room.seats.length <= 1 || (!isHost && s.userId !== auth.user?.id)"
              @click="removeSeat(s.id)"
            >
              退座
            </button>
          </li>
        </ul>
        <div class="row">
          <input
            v-if="!isSolo"
            v-model="newSeatName"
            placeholder="座位显示名"
            @keyup.enter="addSeat"
          />
          <button
            v-if="!isSolo"
            type="button"
            :disabled="(room.seats.length ?? 0) >= 6"
            @click="addSeat"
          >
            加座
          </button>
          <button
            v-if="isHost"
            class="primary"
            type="button"
            :disabled="!room.seats.length"
            @click="startGame"
          >
            开始对局
          </button>
        </div>
      </div>
    </template>

    <template v-else-if="state">
      <div class="card row" style="justify-content: space-between; flex-wrap: wrap">
        <div>
          <template v-if="state.phase === 'ended'">
            <strong>全员已到达终点</strong>
          </template>
          <template v-else>
            当前：<strong>{{ currentPlayer?.name }}</strong>
            <span class="muted"> · {{ PHASE_LABEL[state.phase] ?? state.phase }}</span>
            <span v-if="diceHint" class="muted"> · {{ diceHint }}</span>
            <span v-if="!canControl" class="muted"> · 等待对方操作</span>
          </template>
        </div>
        <button
          class="primary"
          type="button"
          :disabled="state.phase !== 'roll' || !canControl"
          @click="onRoll"
        >
          掷骰
        </button>
      </div>

      <ul class="player-list card">
        <li
          v-for="(p, i) in state.players"
          :key="p.id"
          :class="{ finished: p.finished, current: p.id === currentPlayer?.id }"
        >
          {{ p.name }}
          <span v-if="isMyPlayer(p.id, i)" class="muted">（你）</span>
          <span v-if="p.finished" class="muted">已结束</span>
        </li>
      </ul>

      <div ref="canvasHost" class="phaser-host card" />

      <div v-if="state.phase === 'pick_start'" class="card stack">
        <p>
          <strong>{{ currentPlayer?.name }}</strong>
          请选择起点
          <span v-if="!canControl" class="muted">（非你控制）</span>
        </p>
        <div class="row" style="flex-wrap: wrap">
          <button
            v-for="opt in startOptions"
            :key="opt.id"
            type="button"
            :disabled="!canControl"
            :class="currentPlayer?.cellId === opt.id ? 'primary' : ''"
            @click="onPickStart(opt.id)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div v-if="state.phase === 'choose_exit'" class="card">
        <p>请在棋盘上点选出口，或点下方按钮：</p>
        <div class="row">
          <button
            v-for="e in state.pendingChoice?.exits ?? []"
            :key="e.id"
            type="button"
            class="primary"
            :disabled="!canControl"
            @click="onChooseExit(e.id)"
          >
            {{ e.label }}
          </button>
        </div>
      </div>
    </template>

    <div v-if="state?.phase === 'order' && state.pendingOrder" class="modal-backdrop">
      <div class="card modal stack">
        <p
          class="tile-category"
          :style="
            state.pendingOrder.tile.categoryColor
              ? { color: state.pendingOrder.tile.categoryColor }
              : undefined
          "
        >
          {{ state.pendingOrder.tile.category }}
        </p>
        <h2>{{ state.pendingOrder.tile.title }}</h2>
        <p style="white-space: pre-wrap">{{ resolvedOrderBody }}</p>
        <p class="muted">必须执行。确认后换下一位。</p>
        <button class="primary" type="button" :disabled="!canControl" @click="onConfirmOrder">
          已执行
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.phaser-host {
  min-height: 280px;
  padding: 0.5rem;
  overflow: hidden;
}
.phaser-host :deep(canvas) {
  border-radius: 12px;
  max-width: 100%;
}
.player-list,
.seat-list {
  list-style: none;
  margin: 0;
  padding: 0.75rem 1rem;
}
.player-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
}
.seat-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.seat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.player-list li.finished {
  opacity: 0.45;
  text-decoration: line-through;
}
.player-list li.current:not(.finished) {
  font-weight: 700;
  color: var(--accent-2);
}
</style>
