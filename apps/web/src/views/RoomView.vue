<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { GameState } from '@order-board/rules';
import { api, type RoomDto, type SeatRole } from '../api';
import { avatarDataUrl, randomAvatarSeed } from '../avatar';
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
/** 虚空入座卡草稿 */
const draftName = ref('');
const draftRole = ref<SeatRole | ''>('');
const draftAvatarSeed = ref(randomAvatarSeed());
const canvasHost = ref<HTMLElement | null>(null);
/** 正在加载头像的座位 id；ghost 表示虚空卡 */
const avatarLoading = ref<Record<string, boolean>>({});

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

/** 多人且未满座时显示虚空入座卡 */
const showGhostSeat = computed(() => {
  if (!room.value || isSolo.value) return false;
  return room.value.seats.length < 6;
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

function canEditSeat(seatUserId: string): boolean {
  return Boolean(isHost.value || (auth.user && seatUserId === auth.user.id));
}

function isAvatarLoading(seatId: string): boolean {
  return Boolean(avatarLoading.value[seatId]);
}

function setAvatarLoading(seatId: string, loading: boolean) {
  avatarLoading.value = { ...avatarLoading.value, [seatId]: loading };
}

function onAvatarImgLoad(seatId: string) {
  setAvatarLoading(seatId, false);
}

function onAvatarImgError(seatId: string) {
  setAvatarLoading(seatId, false);
}

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

async function rerollAvatar(seatId: string) {
  if (isAvatarLoading(seatId)) return;
  error.value = '';
  setAvatarLoading(seatId, true);
  try {
    room.value = await api.setSeatAvatarSeed(
      roomCode.value,
      seatId,
      randomAvatarSeed(),
    );
    // 加载态保持到 <img> @load / @error
  } catch (e) {
    setAvatarLoading(seatId, false);
    error.value = e instanceof Error ? e.message : '更新头像失败';
  }
}

function roleLabel(role: SeatRole | null): string {
  if (role === 'dominant') return '支配者';
  if (role === 'submissive') return '顺从者';
  return '未指定';
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

function rerollDraftAvatar() {
  if (isAvatarLoading('ghost')) return;
  setAvatarLoading('ghost', true);
  draftAvatarSeed.value = randomAvatarSeed();
}

function resetGhostDraft() {
  draftName.value = '';
  draftRole.value = '';
  draftAvatarSeed.value = randomAvatarSeed();
}

async function addSeat() {
  if (!showGhostSeat.value) return;
  const name =
    draftName.value.trim() || `玩家${(room.value?.seats.length ?? 0) + 1}`;
  const role: SeatRole | null =
    draftRole.value === 'dominant' || draftRole.value === 'submissive'
      ? draftRole.value
      : null;
  send({
    type: 'add_seat',
    roomCode: roomCode.value,
    displayName: name,
    role,
    avatarSeed: draftAvatarSeed.value,
  });
  resetGhostDraft();
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
      <div class="card stack lobby-seats">
        <div class="lobby-header row" style="justify-content: space-between; flex-wrap: wrap">
          <h2>大厅座位</h2>
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
        <p class="muted">
          悬停头像可重随机 · 角色用于指令占位符。
          <template v-if="isSolo">单人模式仅一个座位。</template>
        </p>
        <div class="seat-grid">
          <article v-for="s in room.seats" :key="s.id" class="seat-card">
            <button
              type="button"
              class="seat-corner danger"
              :disabled="room.seats.length <= 1 || !canEditSeat(s.userId)"
              title="退座"
              @click="removeSeat(s.id)"
            >
              退座
            </button>
            <button
              type="button"
              class="avatar-wrap"
              :class="{ loading: isAvatarLoading(s.id) }"
              :disabled="!canEditSeat(s.userId) || isAvatarLoading(s.id)"
              :title="isAvatarLoading(s.id) ? '头像加载中…' : '点击重随机头像'"
              @click="rerollAvatar(s.id)"
            >
              <img
                class="avatar-img"
                :src="avatarDataUrl(s.avatarSeed)"
                :alt="s.displayName"
                width="96"
                height="96"
                @load="onAvatarImgLoad(s.id)"
                @error="onAvatarImgError(s.id)"
              />
              <span
                v-if="isAvatarLoading(s.id)"
                class="avatar-loading"
                aria-live="polite"
              >
                加载中
              </span>
              <span v-else class="avatar-reroll" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                  <path
                    d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7c2.76 0 5 2.24 5 5a5 5 0 0 1-8.9 3.1L6.2 16.6A7.96 7.96 0 0 0 20 12c0-2.21-.9-4.21-2.35-5.65zM6 12c0-2.76 2.24-5 5-5v3l5-5-5-5v3a8 8 0 0 0-6.8 12.6l1.9-1.5A5 5 0 0 1 6 12z"
                  />
                </svg>
              </span>
            </button>
            <div class="seat-meta">
              <span class="seat-name">
                {{ s.displayName }}
                <span v-if="s.userId === auth.user?.id" class="muted">（你）</span>
                <span v-if="s.userId === room.hostUserId" class="muted">· 房主</span>
              </span>
              <select
                class="seat-role"
                :value="s.role ?? ''"
                :disabled="!canEditSeat(s.userId)"
                :title="roleLabel(s.role)"
                @change="
                  changeSeatRole(s.id, ($event.target as HTMLSelectElement).value)
                "
              >
                <option value="">未指定</option>
                <option value="dominant">支配者</option>
                <option value="submissive">顺从者</option>
              </select>
            </div>
          </article>

          <article v-if="showGhostSeat" class="seat-card seat-card-ghost">
            <button
              type="button"
              class="seat-corner primary"
              title="入座"
              @click="addSeat"
            >
              入座
            </button>
            <button
              type="button"
              class="avatar-wrap"
              :class="{ loading: isAvatarLoading('ghost') }"
              :disabled="isAvatarLoading('ghost')"
              :title="isAvatarLoading('ghost') ? '头像加载中…' : '点击重随机头像'"
              @click="rerollDraftAvatar"
            >
              <img
                class="avatar-img"
                :src="avatarDataUrl(draftAvatarSeed)"
                alt="新座位头像"
                width="96"
                height="96"
                @load="onAvatarImgLoad('ghost')"
                @error="onAvatarImgError('ghost')"
              />
              <span
                v-if="isAvatarLoading('ghost')"
                class="avatar-loading"
                aria-live="polite"
              >
                加载中
              </span>
              <span v-else class="avatar-reroll" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                  <path
                    d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7c2.76 0 5 2.24 5 5a5 5 0 0 1-8.9 3.1L6.2 16.6A7.96 7.96 0 0 0 20 12c0-2.21-.9-4.21-2.35-5.65zM6 12c0-2.76 2.24-5 5-5v3l5-5-5-5v3a8 8 0 0 0-6.8 12.6l1.9-1.5A5 5 0 0 1 6 12z"
                  />
                </svg>
              </span>
            </button>
            <div class="seat-meta">
              <input
                v-model="draftName"
                class="seat-name-input"
                placeholder="玩家名"
                maxlength="32"
                @keyup.enter="addSeat"
              />
              <select
                v-model="draftRole"
                class="seat-role"
                :title="roleLabel(draftRole || null)"
              >
                <option value="">未指定</option>
                <option value="dominant">支配者</option>
                <option value="submissive">顺从者</option>
              </select>
            </div>
          </article>
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
.lobby-seats {
  max-width: 720px;
}
.lobby-header {
  align-items: center;
  gap: 0.75rem;
}
.lobby-header h2 {
  margin: 0;
}
.seat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 1rem;
}
.seat-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  padding: 1rem 0.75rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-muted, rgba(0, 0, 0, 0.02));
}
.seat-card-ghost {
  border-style: dashed;
  background: transparent;
}
.seat-corner {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  padding: 0.15rem 0.45rem;
  font-size: 0.75rem;
  height: auto;
  min-height: 0;
  z-index: 2;
}
.seat-name-input {
  width: 100%;
  max-width: 8.5rem;
  text-align: center;
  font-weight: 600;
  font-size: 0.9rem;
  height: 2rem;
  min-height: 2rem;
  padding: 0 0.4rem;
}
.avatar-wrap {
  position: relative;
  width: 96px;
  height: 96px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  overflow: hidden;
}
.avatar-wrap:disabled {
  cursor: default;
}
.avatar-wrap.loading {
  cursor: wait;
}
.avatar-img {
  display: block;
  width: 96px;
  height: 96px;
  border-radius: 50%;
  object-fit: cover;
}
.avatar-wrap.loading .avatar-img {
  opacity: 0.45;
}
.avatar-reroll,
.avatar-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 16, 24, 0.55);
  color: #fff;
  pointer-events: none;
}
.avatar-reroll {
  opacity: 0;
  transition: opacity 0.15s ease;
}
.avatar-wrap:not(:disabled):hover .avatar-reroll {
  opacity: 1;
}
.avatar-loading {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.seat-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.9rem;
  width: 100%;
}
.seat-name {
  font-weight: 600;
  text-align: center;
}
.seat-role {
  max-width: 6.5rem;
  font-size: 0.85rem;
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
