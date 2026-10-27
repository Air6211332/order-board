<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  api,
  type BoardSummary,
  type PlayMode,
  type PublicBoardSummary,
  type PublicRoomSummary,
  type Visibility,
} from '../../api';
import { useAuthStore } from '../../stores/auth';

const STATUS_LABEL: Record<string, string> = {
  lobby: '大厅',
  playing: '对局中',
};

interface BoardRow {
  id: string;
  name: string;
  cols: number;
  rows: number;
  playMode: PlayMode;
  ownerUsername: string;
}

const router = useRouter();
const auth = useAuthStore();

const rooms = ref<PublicRoomSummary[]>([]);
const publicBoards = ref<PublicBoardSummary[]>([]);
const myBoards = ref<BoardSummary[]>([]);
const boardTab = ref<'mine' | 'public'>('mine');
const error = ref('');
const joinCode = ref('');
const joining = ref(false);
const creating = ref(false);

let pollTimer: ReturnType<typeof setInterval> | null = null;

const boardRows = computed<BoardRow[]>(() => {
  if (boardTab.value === 'public') {
    return publicBoards.value.map((b) => ({
      id: b.id,
      name: b.name,
      cols: b.cols,
      rows: b.rows,
      playMode: b.playMode ?? 'multi',
      ownerUsername: b.ownerUsername,
    }));
  }
  const me = auth.user?.username ?? '我';
  return myBoards.value.map((b) => ({
    id: b.id,
    name: b.name,
    cols: b.cols,
    rows: b.rows,
    playMode: b.playMode ?? 'multi',
    ownerUsername: me,
  }));
});

async function refresh() {
  error.value = '';
  try {
    const [r, pub, mine] = await Promise.all([
      api.listPublicRooms(),
      api.listPublicBoards(),
      api.listBoards(),
    ]);
    rooms.value = r;
    publicBoards.value = pub;
    myBoards.value = mine;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  }
}

async function enterRoom(code: string) {
  error.value = '';
  try {
    await api.joinRoom(code);
    await router.push({ name: 'room', params: { code } });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '进入失败';
  }
}

async function joinByCode() {
  const code = joinCode.value.trim().toUpperCase();
  if (!code) return;
  joining.value = true;
  try {
    await enterRoom(code);
  } finally {
    joining.value = false;
  }
}

async function openRoom(boardId: string, visibility: Visibility) {
  creating.value = true;
  error.value = '';
  try {
    const room = await api.createRoom(boardId, {
      displayName: auth.user?.username,
      visibility,
    });
    await router.push({ name: 'room', params: { code: room.code } });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '开房失败';
  } finally {
    creating.value = false;
  }
}

onMounted(() => {
  void refresh();
  pollTimer = setInterval(() => void refresh(), 8000);
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <div class="stack mobile-lobby">
    <h1>大厅</h1>
    <p class="muted" style="margin: 0">公开房间与快捷开房</p>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="card row join-card">
      <label class="join-label">
        房间码
        <input
          v-model="joinCode"
          class="touch-field"
          placeholder="例如 AB12CD"
          maxlength="8"
          @keyup.enter="joinByCode"
        />
      </label>
      <button
        class="primary touch-btn"
        type="button"
        :disabled="joining || !joinCode.trim()"
        @click="joinByCode"
      >
        加入
      </button>
    </div>

    <div class="card stack">
      <div class="row" style="justify-content: space-between">
        <h2>公开房间</h2>
        <button type="button" class="touch-btn" @click="refresh">刷新</button>
      </div>
      <p v-if="!rooms.length" class="muted">暂无公开房间</p>
      <article v-for="r in rooms" :key="r.code" class="room-card">
        <div>
          <strong>{{ r.code }}</strong>
          <div class="muted small">
            {{ r.boardName }} · {{ STATUS_LABEL[r.status] ?? r.status }} · {{ r.seatCount }}人 ·
            {{ r.hostUsername }}
          </div>
        </div>
        <button
          type="button"
          class="primary touch-btn"
          :disabled="r.status !== 'lobby'"
          @click="enterRoom(r.code)"
        >
          {{ r.status === 'lobby' ? '进入' : '进行中' }}
        </button>
      </article>
    </div>

    <div class="card stack">
      <div class="row tabs">
        <button
          type="button"
          class="touch-btn"
          :class="{ primary: boardTab === 'mine' }"
          @click="boardTab = 'mine'"
        >
          我的棋盘
        </button>
        <button
          type="button"
          class="touch-btn"
          :class="{ primary: boardTab === 'public' }"
          @click="boardTab = 'public'"
        >
          公开棋盘
        </button>
      </div>
      <p v-if="!boardRows.length" class="muted">暂无棋盘</p>
      <article v-for="b in boardRows" :key="b.id" class="board-card">
        <div>
          <strong>{{ b.name }}</strong>
          <div class="muted small">
            {{ b.cols }}×{{ b.rows }} · {{ b.playMode === 'solo' ? '单人' : '多人' }} ·
            {{ b.ownerUsername }}
          </div>
        </div>
        <div class="row actions">
          <button
            type="button"
            class="primary touch-btn"
            :disabled="creating"
            @click="openRoom(b.id, b.playMode === 'solo' ? 'private' : 'public')"
          >
            开房
          </button>
          <button type="button" class="touch-btn" @click="router.push(`/play/${b.id}`)">
            快开
          </button>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.mobile-lobby h1 {
  margin-bottom: 0;
}

.join-card {
  align-items: flex-end;
}

.join-label {
  flex: 1;
  min-width: 8rem;
}

.touch-btn {
  min-height: 44px;
}

.touch-field {
  min-height: 44px;
}

.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.room-card,
.board-card {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.85rem 0;
  border-top: 1px solid var(--border);
}

.room-card:first-of-type,
.board-card:first-of-type {
  border-top: none;
  padding-top: 0;
}

.small {
  font-size: 0.8rem;
  margin-top: 0.2rem;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  width: 100%;
}
</style>
