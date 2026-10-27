<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  api,
  type BoardSummary,
  type PlayMode,
  type PublicBoardSummary,
  type PublicRoomSummary,
  type Visibility,
} from '../api';
import { useAuthStore } from '../stores/auth';

const STATUS_LABEL: Record<string, string> = {
  lobby: '大厅',
  playing: '对局中',
};

/** 右侧列表统一行结构 */
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
  <div class="stack lobby">
    <div class="row" style="justify-content: space-between; flex-wrap: wrap">
      <div>
        <h1>大厅</h1>
        <p class="muted">公开房间与棋盘 · 私有房请用房间码或链接</p>
      </div>
      <RouterLink to="/boards">管理我的棋盘</RouterLink>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="lobby-grid">
      <div class="lobby-col stack">
        <div class="card row join-card" style="flex-wrap: wrap; align-items: flex-end; gap: 0.75rem">
          <label style="flex: 1; min-width: 10rem">
            房间码
            <input
              v-model="joinCode"
              placeholder="例如 AB12CD"
              maxlength="8"
              @keyup.enter="joinByCode"
            />
          </label>
          <button
            class="primary"
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
            <button type="button" @click="refresh">刷新</button>
          </div>
          <p v-if="!rooms.length" class="muted">暂无公开房间</p>
          <table v-else>
            <thead>
              <tr>
                <th>房间码</th>
                <th>棋盘</th>
                <th>状态</th>
                <th>人数</th>
                <th>房主</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rooms" :key="r.code">
                <td><strong>{{ r.code }}</strong></td>
                <td>{{ r.boardName }}</td>
                <td class="muted">{{ STATUS_LABEL[r.status] ?? r.status }}</td>
                <td class="muted">{{ r.seatCount }}</td>
                <td class="muted">{{ r.hostUsername }}</td>
                <td>
                  <button
                    type="button"
                    class="primary"
                    :disabled="r.status !== 'lobby'"
                    @click="enterRoom(r.code)"
                  >
                    {{ r.status === 'lobby' ? '进入' : '进行中' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="lobby-col card stack create-panel">
        <h2>快捷开房</h2>
        <div class="board-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            :class="{ active: boardTab === 'mine' }"
            :aria-selected="boardTab === 'mine'"
            @click="boardTab = 'mine'"
          >
            我的棋盘
          </button>
          <button
            type="button"
            role="tab"
            :class="{ active: boardTab === 'public' }"
            :aria-selected="boardTab === 'public'"
            @click="boardTab = 'public'"
          >
            公开棋盘
          </button>
        </div>

        <p v-if="!boardRows.length" class="muted">
          <template v-if="boardTab === 'mine'">
            还没有棋盘。
            <RouterLink to="/boards">去棋盘页新建</RouterLink>
          </template>
          <template v-else>暂无公开棋盘 · 可在棋盘页设为公开</template>
        </p>
        <div v-else class="board-cards">
          <article v-for="b in boardRows" :key="b.id" class="board-card">
            <h3 class="board-card-name">{{ b.name }}</h3>
            <p class="board-card-meta muted">
              {{ b.playMode === 'solo' ? '单人' : '多人' }}
              · {{ b.cols }}×{{ b.rows }}
              · {{ b.ownerUsername }}
            </p>
            <div class="row open-actions">
              <button
                v-if="b.playMode !== 'solo'"
                type="button"
                class="primary"
                :disabled="creating"
                @click="openRoom(b.id, 'public')"
              >
                公开开房
              </button>
              <button type="button" :disabled="creating" @click="openRoom(b.id, 'private')">
                私有开房
              </button>
            </div>
          </article>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lobby-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 1rem;
  align-items: start;
}

.lobby-col {
  min-width: 0;
}

.create-panel h2 {
  margin-bottom: 0.5rem;
}

.board-tabs {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}

.board-tabs button {
  flex: 1;
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.board-tabs button.active {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  border-color: var(--accent);
  color: var(--text);
  font-weight: 600;
}

.board-cards {
  display: grid;
  gap: 0.65rem;
}

.board-card {
  display: grid;
  gap: 0.4rem;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
}

.board-card-name {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.board-card-meta {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.35;
}

.open-actions {
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.15rem;
}

@media (max-width: 960px) {
  .lobby-grid {
    grid-template-columns: 1fr;
  }
}
</style>
